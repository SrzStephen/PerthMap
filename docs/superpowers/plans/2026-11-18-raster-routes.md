# Raster Travel Times + Click-for-Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bundled polygon isochrones with per-window raster grids (3 days × 16 one-hour arrive-by windows), contoured in the browser, and show the fastest route + timings for any clicked point.

**Architecture:** The MOTIS pipeline (`data_gen/pipeline.py`) writes per-window gzipped grid planes + route tables and shared `index/stops/water` files into `public/data/`. The web app lazily fetches a window, contours its median plane with `d3-contour` in a Web Worker (clipped to water with `polyclip-ts`), and resolves clicks against the grid's fastest-stop plane and the window's route table.

**Tech Stack:** Python 3.12 + numpy/pandas/geopandas + MOTIS 2.11.4 (Docker); React 19, Vite, react-leaflet 5, Tailwind 4, Radix Slider, Vitest + Testing Library; new: `d3-contour`, `polyclip-ts`, `pytest`.

**Spec:** `docs/superpowers/specs/2026-11-18-raster-routes-design.md`

## Global Constraints

- Static hosting only; data lives in `public/data/` and is fetched at runtime (never imported/bundled).
- Days: keys `weekday` (next Wednesday), `saturday`, `sunday` (next of each, Perth time, never today). Labels "Weekday", "Saturday", "Sunday".
- Hours: 6…21; window `HH` arrival samples `HH:00, HH:05 … HH:55` (12). File stem `{day}-{HH}` with zero-padded `HH` (e.g. `weekday-08`).
- Map colour = per-cell **median** over samples; route = per-cell **fastest** sample.
- Grid binary: gzip of `"PMG1"` + `u16 version=1` + `u32 width` + `u32 height` (little-endian), then planes in order `median u8, fastest u8, sample u8, walk u8, stop u16`; row 0 = south (`minLat`). Sentinels: u8 `255` = n/a/unreachable; stop `0xFFFF` = none, `0xFFFE` = direct walk.
- Cell index: `ix = round((lon − minLon)/spacing)`, `iy = round((lat − minLat)/spacing)`, `i = iy·width + ix`.
- Band thresholds: 15…85 step 5. Defaults: day `weekday`, hour `8`, minutes `45`.
- MOTIS: `/api/v6/one-to-all` (existing) and `/api/v5/plan` with `fromPlace=<stopId>`, `toPlace=<lat,lon of WORK>`, `arriveBy=true`, `numItineraries=1`; leg geometry is a precision-**6** encoded polyline at `leg.legGeometry.points`; times are UTC ISO strings → store as Perth local `"HH:MM"` (UTC+8, no DST).
- MOTIS stop ids are `transperth_<gtfs stop_id>`; global stop index = row order of GTFS `stops.txt` sorted by `stop_id` (string sort).
- Copy: hour label `Arrive HH:00–HH+1:00`; panel header `Best {b} min · typical {t} min`; `Leave HH:MM → arrive HH:MM ({Day})`; messages "Outside the mapped area", "No public transport route within 2 h (max 15 min walk to a stop)", "Route details unavailable", load error "Couldn't load {Day} {HH}:00 data" + "Retry".
- Gates at the end of every code task: `npm run lint`, `npm test`, `npm run build` (web) and `cd data_gen/data && uv run --group dev pytest ../tests -q` (pipeline) all pass.
- Commit after each task; push the branch `worktree-isochrone-accuracy`.

## Review Focus

1. **Click on the grid boundary or just outside it** — the last column/row resolves to a cell; one spacing beyond returns `null` → "Outside the mapped area", no crash. (Task 6 test `cellAt edges`.)
2. **Early Sunday window with almost no service** — a window with few/no reachable cells renders an empty map and clicks say "No public transport route…"; pipeline fails only when *zero* cells are reachable. (Task 5 test `zero reachable fails`, Task 7 test `all unreachable gives no bands`.)
3. **Fast slider scrubbing** — responses for an older window arriving after a newer one must not replace the newer bands. (Task 8 test `stale window load is ignored`.)
4. **UTC → Perth time** — a leg at `2026-11-24T22:53:00Z` shows `06:53`, including the date rollover. (Task 3 test `times are perth local`.)
5. **Legs whose endpoints aren't GTFS stops** (plan START/END places, unknown ids) — stored as index `-1` and shown as "your stop"/"Perth CBD" instead of crashing. (Task 3 test `unknown stop ids map to -1`, Task 10 test `walk-to-cbd leg label`.)

---

### Task 1: Per-sample argmin combine (pipeline)

**Files:**
- Modify: `data_gen/pipeline.py` (replace the inline "3. combine" block in `route`)
- Modify: `data_gen/data/pyproject.toml` (add `[dependency-groups] dev = ["pytest>=8.3"]`), `data_gen/data/uv.lock`
- Create: `data_gen/tests/conftest.py` (prepend `data_gen/` to `sys.path`), `data_gen/tests/test_combine.py`

**Interfaces:**
- Produces:
  - `DIRECT = -2`, `NONE = -1` (module constants)
  - `combine(n_cells: int, g_idx: np.ndarray, g_stop: np.ndarray, g_walk: np.ndarray, stop_minutes: np.ndarray, w_idx: np.ndarray, w_min: np.ndarray) -> Combined` where `stop_minutes` is `(n_stops, n_samples)` float (NaN = unreachable) and `Combined` is a frozen dataclass of three `(n_samples, n_cells)` arrays: `total: float` (NaN unreachable), `stop: int32` (`NONE`/`DIRECT`/stop row), `walk: float`.
  - `summarise(c: Combined) -> Summary` dataclass of `(n_cells,)` arrays: `median: float`, `fastest: float`, `sample: int16` (−1 n/a), `stop: int32`, `walk: float`.

- [ ] **Step 1: Write failing tests** in `test_combine.py`:
  - `test_picks_min_stop_per_sample`: 2 cells, 2 stops, 2 samples; cell 0 reachable via stop 0 (walk 5, transit [10, 30]) and stop 1 (walk 2, transit [20, 12]) → `total[:,0] == [15, 14]`, `stop[:,0] == [0, 1]`, `walk[:,0] == [5, 2]`.
  - `test_direct_walk_wins`: cell 1 also in `w_idx` with `w_min=9` beating transit → `stop[:,1] == DIRECT`, `walk == 9`.
  - `test_unreachable_cell`: cell with no entries → `total` NaN, `stop == NONE`; `summarise` gives `fastest` NaN, `sample == -1`.
  - `test_summarise_fastest_sample`: totals `[[15],[14]]` → `median == 14.5`, `fastest == 14`, `sample == 1`, `stop`/`walk` taken from sample 1.
  - `test_matches_brute_force`: random 50 cells × 8 stops × 4 samples (seeded) vs a Python triple loop.
- [ ] **Step 2:** `cd data_gen/data && uv run --group dev pytest ../tests -q` → FAIL (`combine` undefined).
- [ ] **Step 3: Implement** `combine`/`summarise`. Per sample `j`: `t = g_walk + stop_minutes[g_stop, j]`; drop NaN; `order = np.lexsort((t, g_idx))`; first occurrence per cell via `np.unique(g_idx[order], return_index=True)`; then compare with direct walk (`w_idx`, `w_min`) and overwrite where smaller. `summarise` uses `np.nanmedian`/`np.nanargmin` with all-NaN columns handled explicitly (no warnings). Rewire `route` to use them (behaviour of `travel_time` columns unchanged for now).
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** Commit `feat(data): track winning stop per cell and sample`.

### Task 2: Grid binary + stop table (pipeline)

**Files:**
- Modify: `data_gen/pipeline.py`
- Create: `data_gen/tests/test_grid_io.py`

**Interfaces:**
- Consumes: `Summary` (Task 1).
- Produces:
  - `GridMeta` dataclass `(width: int, height: int, min_lon: float, min_lat: float, spacing: float)`; `grid_meta(spacing) -> GridMeta` matching `make_grid` (width = `len(np.arange(min_lon, max_lon, spacing))`).
  - `encode_grid(s: Summary, cells: np.ndarray, meta: GridMeta, stop_index: np.ndarray) -> bytes` — `cells` are flat cell indices of the routed (walkable) grid rows; `stop_index` maps stop row → global stop index. Returns gzip bytes (format in Global Constraints). Minutes `round` and clip to 0…254.
  - `decode_grid(b: bytes) -> dict[str, np.ndarray]` (test helper, also used by Task 5 checks).
  - `load_stops(gtfs_zip: Path) -> tuple[pd.DataFrame, dict[str, int]]` — sorted by `stop_id`; dict maps MOTIS id `transperth_<stop_id>` → index.

- [ ] **Step 1: Write failing tests:** `test_roundtrip_with_sentinels` (unreachable → 255/`0xFFFF`, direct → `0xFFFE`, values > 254 clipped); `test_header` (`b[:4]` after gunzip == `b"PMG1"`, version 1, width/height); `test_row0_is_south` (cell at `min_lat` lands in row 0); `test_load_stops_sorted_ids` (tiny zip with stops `"20","100","3"` → order `"100","20","3"`, key `"transperth_3"` → 2).
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3: Implement** with `struct.pack("<4sHII", ...)` + planes `.tobytes()` (stop plane `astype("<u2")`), `gzip.compress(..., 9)`.
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** Commit `feat(data): grid binary encoder and GTFS stop table`.

### Task 3: Itineraries from MOTIS plans (pipeline)

**Files:**
- Modify: `data_gen/pipeline.py` (`Motis.plan`, new functions)
- Create: `data_gen/tests/fixtures/plan_joondalup.json` (save a real `/api/v5/plan` response: from `transperth_99871` arrive-by `2026-11-25T08:00+08:00`), `data_gen/tests/test_routes.py`

**Interfaces:**
- Produces:
  - `Motis.plan(stop_id: str, arrive: datetime) -> dict | None` (first itinerary or `None`).
  - `trip_from_plan(it: dict, stop_ids: dict[str, int], paths: PathTable) -> dict` → `{"depart": "HH:MM", "arrive": "HH:MM", "legs": [{"mode", "line", "headsign", "from", "to", "depart", "arrive", "path"}]}`; `line` = `displayName` or `""`; `from`/`to` = global stop index or `-1`; `path` = index into `PathTable`.
  - `PathTable` with `add(points: str) -> int` (dedup) and `.items: list[str]`.
  - `build_routes(pairs: Iterable[tuple[int, int]], plan: Callable[[int, int], dict | None], stop_ids, samples: list[str]) -> tuple[dict, int]` → (`{"samples", "paths", "trips": {"<stop>:<sample>": trip}}`, missing count). Keys use **global** stop index.

- [ ] **Step 1: Write failing tests** against the fixture: `test_trip_shape` (3 legs, modes `WALK, REGIONAL_RAIL, WALK`, line `"Yanchep Line"`, headsign `"Elizabeth Quay Stn"`); `test_times_are_perth_local` (first leg depart `"06:53"`, trip arrive `"07:42"`); `test_unknown_stop_ids_map_to_minus1` (START → `-1`); `test_paths_dedup` (two identical trips → `len(paths)` unchanged); `test_missing_plan_counted` (`plan` returns `None` for one pair → absent key, missing == 1).
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3: Implement.** `Motis.plan` GETs `/api/v5/plan` with params in Global Constraints, timeout 60 s, returns `None` on empty itineraries. Convert times with `datetime.fromisoformat(...).astimezone(PERTH).strftime("%H:%M")`.
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** Commit `feat(data): itineraries from MOTIS plan with shared paths`.

### Task 4: Testable sea classification (pipeline)

**Files:**
- Modify: `data_gen/pipeline.py` (`ocean_polygons`)
- Create: `data_gen/tests/test_masks.py`

**Interfaces:**
- Produces: `sea_pieces(frame: Polygon, coast: Sequence[LineString]) -> list[Polygon]` (polygonize + right-hand majority vote; `ocean_polygons` becomes osmium I/O + this).

- [ ] **Step 1: Failing test** `test_right_side_is_sea`: frame `box(0,0,10,10)`, coastline `LineString([(5,-1),(5,11)])` (heading north → sea on the east) → one piece with `bounds[0] == 5`; reversed line → sea on the west.
- [ ] **Step 2:** FAIL. **Step 3:** extract function. **Step 4:** PASS + rerun `docker compose run --rm --no-deps -v <main data>/input:/data/input route masks --force` and confirm CBD/Fremantle are not water (probe script from earlier session).
- [ ] **Step 5:** Commit `refactor(data): pure sea classification with test`.

### Task 5: Multi-window `route` stage writing web files (pipeline)

**Files:**
- Modify: `data_gen/pipeline.py` (`route`, CLI; delete `isochrones`, `band_polygons`, `plasma_r`, `_PLASMA`), `data_gen/README.md`, `data_gen/docker-compose.yml` (drop `isochrones` service)
- Create: `data_gen/tests/test_route_stage.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces (in `data/results/web/`): `index.json` `{version: 1, generated, grid: {width, height, minLon, minLat, spacing}, days: [{key, label, date}], hours: [6..21], mismatchRate: {"weekday-08": float}}`; `stops.json` `[[name, lat, lon], …]` (5-dp); `water.json` (water parquet, `simplify(spacing/10)`, 5-dp GeoJSON MultiPolygon FeatureCollection); `{day}-{HH}.grid.bin.gz`; `{day}-{HH}.routes.json` (compact separators).
- CLI: `route --days weekday,saturday,sunday --hours 6-21` (defaults all); `service_dates(today: date) -> dict[str, date]`.

- [ ] **Step 1: Failing tests:** `test_service_dates` (today Wed 2026-11-18 → weekday 2026-11-25, saturday 11-21, sunday 11-22); `test_zero_reachable_fails` (`run_window` with a stub whose one-to-all returns no stops → `SystemExit`); `test_mismatch_rate` (`mismatch_rate(fastest, trip_minutes)` with 1 of 4 differing by > 5 → 0.25).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** Structure: compute walkable grid + access leg **once** (independent of time; collect access over the union of stops seen across all windows — run every window's one-to-all first, then walking for the union of stops), then per window: combine → summarise → `encode_grid`; unique `(stop, sample)` pairs where `stop >= 0` → `build_routes` using a thread pool (`--workers`); mismatch = |`fastest` − (`walk` + trip duration from stop departure to arrival)| > 5 min; log warning if > 0.05. Write shared files once. Remove the CSV/poly outputs.
- [ ] **Step 4:** pytest → PASS. Then real run for one window against MOTIS: `docker compose run --rm --no-deps -v <main>/input:/data/input -e MOTIS_URL=http://motis:8080 route route --days weekday --hours 8` (MOTIS container `perthmap-motis-iso` on `data_gen_default`). Record grid/routes sizes, plan count and wall time in the commit message; check mismatch rate ≤ 0.05.
- [ ] **Step 5:** Update README stages table + copy step `cp -r data/results/web/. ../public/data/`. Commit `feat(data): multi-window route stage writing web data`.

### Task 6: Grid loading in the browser

**Files:**
- Create: `src/lib/grid.ts`, `src/lib/__tests__/grid.test.ts` (`// @vitest-environment node` — needs `DecompressionStream`)

**Interfaces:**
- Produces:
  - `type DayKey = 'weekday' | 'saturday' | 'sunday'`
  - `interface GridMeta { width: number; height: number; minLon: number; minLat: number; spacing: number }`
  - `interface DataIndex { version: number; generated: string; grid: GridMeta; days: {key: DayKey; label: string; date: string}[]; hours: number[] }`
  - `interface Grid { meta: GridMeta; median: Uint8Array; fastest: Uint8Array; sample: Uint8Array; walk: Uint8Array; stop: Uint16Array }`
  - `const UNREACHABLE = 255, NO_STOP = 0xffff, DIRECT_WALK = 0xfffe`
  - `windowKey(day: DayKey, hour: number): string` → `"weekday-08"`
  - `decodeGrid(gz: ArrayBuffer, meta: GridMeta): Promise<Grid>` — throws `Error('grid format')` on bad magic/version, `Error('grid size')` on width/height mismatch.
  - `cellAt(meta: GridMeta, lat: number, lng: number): number | null`
  - `loadIndex(): Promise<DataIndex>`, `loadGrid(index: DataIndex, key: string): Promise<Grid>` (cached by key; rejected promises evicted), `evictGrid(key: string): void`. Base URL `${import.meta.env.BASE_URL}data/`.

- [ ] **Step 1: Failing tests:** build fixtures with `node:zlib.gzipSync`. `decodes planes` (2×2 grid, stop plane little-endian u16 incl. `0xfffe`); `rejects bad magic`; `rejects size mismatch`; `cellAt edges` (min corner → 0; last column/row → `width*height-1`; one spacing beyond max → `null`; below min → `null`); `windowKey pads hour`; `failed load is evicted` (mock `fetch` reject then resolve → second call succeeds).
- [ ] **Step 2:** `npx vitest run src/lib/__tests__/grid.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Decompress via `new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()`; read header with `DataView` (little-endian); planes via `subarray`/`new Uint16Array(buf.slice(...))`.
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(web): grid loader and cell lookup`.

### Task 7: Contours + water clip (+ measurement)

**Files:**
- Modify: `package.json` (add `d3-contour`, `@types/d3-contour`, `polyclip-ts`)
- Create: `src/lib/contours.ts`, `src/lib/contours.worker.ts`, `src/lib/__tests__/contours.test.ts`, `scripts/measure-clip.ts`
- Modify: `src/lib/bands.ts` (add `export const THRESHOLDS = [15, 20, …, 85]`)

**Interfaces:**
- Consumes: `Grid`, `GridMeta` (Task 6); `Band` (`src/lib/bands.ts`, positions `[lat,lng][][][]`).
- Produces:
  - `type LngLatMultiPolygon = number[][][][]` (GeoJSON order)
  - `buildBands(grid: Grid, thresholds: number[], water: LngLatMultiPolygon | null): Band[]` — largest time first; empty bands omitted.
  - `waterFromGeoJSON(fc: unknown): LngLatMultiPolygon`
  - `export const CLIP_WATER: boolean` — default set by Step 5.
  - Worker protocol: post `{id: number, grid: Grid, thresholds: number[], water: LngLatMultiPolygon | null}` → reply `{id: number, bands: Band[]}` or `{id: number, error: string}`.

- [ ] **Step 1: Failing tests** (hand-made 6×6 grid, meta spacing 1, min 0,0): `nesting` (band 20 area ⊇ band 15 area via a simple shoelace area helper on outer rings); `vertex transform` (a single reachable cell's contour lies within ±1 spacing of its centre lat/lng); `all unreachable gives no bands`; `water clip removes area` (water square covering half the grid → band area roughly halves); `largest first`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Implement.** Values: `median === 255 ? 1e4 : median` into a `Float64Array`; `contours().size([width, height]).thresholds(t)` — d3 contours enclose `value >= threshold`, so contour the negated plane at `-(t - 0.5)` (minutes are integers, so this encloses exactly `median < t`); map vertex `(x, y)` → `[lat, lng] = [minLat + (y − 0.5)·spacing, minLon + (x − 0.5)·spacing]`; clip with `polyclip-ts` `difference(band, water)` in lng/lat order before swapping. Worker file just wraps `buildBands`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5: Measure.** `npx vite-node scripts/measure-clip.ts public/data/weekday-08.grid.bin.gz public/data/water.json` prints ms for contour-only and contour+clip (needs Task 5 output copied to `public/data/`). If clip total > 300 ms set `CLIP_WATER = false`, else `true`; note the numbers in the commit message.
- [ ] **Step 6:** Commit `feat(web): client-side contours with water clipping`.

### Task 8: Window data hook

**Files:**
- Create: `src/lib/useWindowData.ts`, `src/lib/__tests__/useWindowData.test.tsx`

**Interfaces:**
- Consumes: Tasks 6, 7.
- Produces: `useWindowData(index: DataIndex | null, day: DayKey, hour: number, deps?: {loadGrid, computeBands, loadWater}) → {grid: Grid | null; bands: Band[]; status: 'loading' | 'ready' | 'error'; retry: () => void}`. `computeBands` defaults to the worker (falls back to main-thread `buildBands` if `typeof Worker === 'undefined'` or the worker errors); prefetches `hour ± 1` grids after ready. Previous `grid`/`bands` are kept while loading and on error.

- [ ] **Step 1: Failing tests** with injected deps: `loads then ready`; `keeps previous bands while loading`; `stale window load is ignored` (request 08 then 09; resolve 09 first then 08 → bands stay 09's); `error then retry` (retry calls `evictGrid` and reloads); `prefetches neighbours`.
- [ ] **Step 2:** FAIL. **Step 3:** implement (request id guard). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): window data hook with worker contours`.

### Task 9: Day/hour controls, map wiring, remove poly.json

**Files:**
- Modify: `src/components/panel/ControlCard.tsx`, `src/components/panel/__tests__/ControlCard.test.tsx`, `src/components/map/TravelTimeMap.tsx`, its two tests, `src/App.tsx`
- Delete: `src/assets/poly.json`, `src/lib/data.ts`
- Create: `src/components/panel/DayToggle.tsx`

**Interfaces:**
- Consumes: Task 8, `THRESHOLDS`.
- Produces:
  - `ControlCard` props add `days: DataIndex['days']`, `day`, `onDayChange(day: DayKey)`, `hours: number[]`, `hour`, `onHourChange(h: number)`, `status: 'loading'|'ready'|'error'`, `onRetry()`, and `children?: ReactNode` (route panel slot used in Task 11; when present it replaces the slider block). `times` now = `THRESHOLDS`.
  - `TravelTimeMap` props `{minutes: number; bands: Band[]; onMapClick?: (lat: number, lng: number) => void; children?: ReactNode}`; band `<Popup>` removed.
  - `App` owns `index` (via `loadIndex`), `day`, `hour`, `minutes`.

- [ ] **Step 1: Failing tests:** DayToggle renders 3 radio buttons (`role="radio"`, names Weekday/Saturday/Sunday) and calls `onDayChange('saturday')`; hour slider aria-label "Arrival hour", label text `Arrive 08:00–09:00`, ArrowRight → `onHourChange(9)`; status `error` shows "Couldn't load Weekday 08:00 data" and Retry calls `onRetry`; `loading` shows an element with `role="status"`; TravelTimeMap renders one path per band from props and calls `onMapClick` on map click.
- [ ] **Step 2:** FAIL. **Step 3:** implement; delete `poly.json`/`data.ts`; App shows the map with no bands until the index loads. **Step 4:** all gates pass (`npm run lint && npm test && npm run build`), and `npm run dev` shows bands for weekday-08 with `public/data` from Task 5.
- [ ] **Step 5:** Commit `feat(web): day and hour controls on raster data`.

### Task 10: Route resolution

**Files:**
- Create: `src/lib/route.ts`, `src/lib/polyline.ts`, `src/lib/__tests__/route.test.ts`, `src/lib/__tests__/polyline.test.ts`

**Interfaces:**
- Consumes: `Grid`, `cellAt`, sentinels (Task 6).
- Produces:
  - `decodePolyline(s: string, precision = 6): [number, number][]` (`[lat, lng]`)
  - `interface Leg { mode: string; line: string; headsign: string; from: number; to: number; depart: string; arrive: string; path: number }`, `interface Trip { depart: string; arrive: string; legs: Leg[] }`, `interface Routes { samples: string[]; paths: string[]; trips: Record<string, Trip> }`, `type Stops = [string, number, number][]`
  - `type RouteResult = {kind: 'outside'} | {kind: 'unreachable'} | {kind: 'walk'; best: number; typical: number} | {kind: 'missing'; best: number; typical: number} | {kind: 'transit'; best: number; typical: number; walk: number; leave: string; arrive: string; boardStop: number; trip: Trip}`
  - `resolveRoute(grid: Grid, lat: number, lng: number, routes: Routes): RouteResult` (`typical` = median; median `255` with fastest set → typical = best)
  - `leaveTime(firstDepart: string, walkMin: number): string` (wraps past midnight)
  - `legLabel(leg: Leg, stops: Stops, isLast: boolean): string` — `-1` endpoints → "your stop" / "Perth CBD".
  - `loadStops(): Promise<Stops>`, `loadRoutes(key: string): Promise<Routes>` (cached like `loadGrid`).

- [ ] **Step 1: Failing tests:** polyline decodes the fixture string from Task 3's leg 1 to a first point ≈ `[-31.7449, 115.7675]`; `resolveRoute` kinds `outside` / `unreachable` / `walk` (`0xfffe`) / `missing` (no trip key) / `transit` (key `"12:3"`, `leave` = first transit leg depart − walk); `leaveTime('00:04', 6) === '23:58'`; `walk-to-cbd leg label` (WALK leg with `to: -1`, last → "Walk 9 min to Perth CBD").
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(web): resolve clicked point to fastest route`.

### Task 11: Route panel + map overlay

**Files:**
- Create: `src/components/route/RoutePanel.tsx`, `src/components/route/RouteOverlay.tsx`, `src/components/route/__tests__/RoutePanel.test.tsx`, `src/components/route/__tests__/RouteOverlay.test.tsx`
- Modify: `src/App.tsx`, `src/components/map/TravelTimeMap.tsx` (add `route` pane, zIndex 400)

**Interfaces:**
- Consumes: Tasks 9, 10.
- Produces: `RoutePanel({result: RouteResult; dayLabel: string; stops: Stops | null; onClose: () => void})`; `RouteOverlay({point: [number, number]; result: RouteResult; routes: Routes | null; stops: Stops | null})`. `App` holds `clicked: [lat, lng] | null`; re-resolves when `day`/`hour`/grid changes; Esc and ✕ clear; a new click (including an unreachable or outside cell, which shows its message) replaces the current result.

- [ ] **Step 1: Failing tests:** panel for each `RouteResult` kind shows the exact copy from Global Constraints (e.g. transit: "Best 38 min · typical 46 min", "Leave 07:22 → arrive 08:00 (Weekday)", one row per leg); ✕ button (aria-label "Close route") and Escape call `onClose`; overlay renders a dashed walk polyline (`dashArray` set) from point to board stop plus one polyline per transit leg coloured by mode (`RAIL`/`REGIONAL_RAIL`/`SUBWAY` train colour, `BUS`, `FERRY`, other → bus colour) and nothing for `outside`/`unreachable`.
- [ ] **Step 2:** FAIL. **Step 3:** implement; pan only when the route bounds aren't contained in the map bounds (`map.getBounds().contains`). **Step 4:** all gates pass.
- [ ] **Step 5:** Commit `feat(web): click any point to see its fastest route`.

### Task 12: Full data run, E2E check, docs

**Files:**
- Create/replace: `public/data/*` (48 windows + shared files), `scripts/e2e-route.py` (Playwright, uses the cached Chromium at `~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`)
- Modify: `README.md`, `doc/img.png`, `doc/img-mobile.png`, `.github/workflows/deploy.yml` only if the build needs it (it shouldn't — `public/` is copied by Vite)

- [ ] **Step 1:** Run all 48 windows (`route` with defaults; expect ~1 h). Copy to `public/data/`. Record total size (`du -sh public/data`) and per-window mismatch rates; any window > 0.05 is listed in the commit message.
- [ ] **Step 2:** `npm run build && npx vite preview --port 4789`; run `uv run --with playwright==1.58.0 python scripts/e2e-route.py` which: loads, switches to Saturday and hour 10, waits for `role="status"` to disappear, clicks Joondalup (`-31.745, 115.77`), asserts text "Best" and a leg row, then presses Escape and asserts the panel closed; saves desktop/mobile screenshots to `doc/`.
- [ ] **Step 3:** README: update "Data" section for the new outputs and the 3-day/16-hour model.
- [ ] **Step 4:** Commit `feat: generate all windows, e2e check, docs`; push.
