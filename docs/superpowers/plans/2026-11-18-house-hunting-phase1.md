# House Hunting Phase 1 — Address Search, Property Report, Intake Areas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste an address (or click) → see the route to the CBD plus the public primary/secondary school whose local intake area covers it; pick schools to limit the travel-time map to their intake areas.

**Architecture:** A new pipeline stage `schools` fetches DET-024 school points, downloads every metro public school's DoE intake GeoPDF in one fast parallel pass, extracts georeferenced boundary polygons, and writes `schools.json`, `intake.json` (GeoJSON) and `intake.bin` (per travel-time-grid-cell school indices). The web app loads those once; the property report looks the clicked cell up in `intake.bin`; the school picker builds a cell mask that the contour step treats as unreachable outside the chosen intake areas.

**Tech Stack:** Python 3.12 (uv), PyMuPDF, pyproj, shapely, requests; React 19, react-leaflet 5, Vitest; Nominatim.

**Spec:** `docs/superpowers/specs/2026-11-18-house-hunting-design.md` (phase 1). Proof of concept: `data_gen/intake/*.py`.

## Global Constraints

- Coverage = `GRID_BBOX` (`data_gen/pipeline.py:73`); grid = `GridMeta` from `public/data/index.json` (spacing 0.001°, row 0 south).
- Schools: `sector == "GOVERNMENT"` only. Level: primary if `lowyear` ∈ {PKG, KIN, PPR, Y01–Y06}; secondary if `highyear` ∈ {Y07–Y12} and the school teaches ≥ Y07; K–12 schools are both.
- Intake map URL: `https://www.det.wa.edu.au/schoolsonline/school_file_download?schoolID=<code>&fileType=INTAKE_MAP0<n>&yearID=_NA`, n ∈ {1, 2}. A non-PDF response (no `%PDF` magic) = no map.
- Download: **fast, one-off** — 8 concurrent, 3 retries with backoff, skip files already cached in `DATA/input/intake/`.
- DoE intake data is CC BY 4.0: attribution "Local intake areas © Department of Education WA, CC BY 4.0, derived from DoE intake maps". Never ship the UBD basemap raster.
- Every school row in the UI carries exactly: "Approximate — from DoE maps; check the official lookup if near a boundary." and links to `https://www.det.wa.edu.au/schoolsonline/home.do`.
- Nominatim: search on submit only (no autocomplete), `countrycodes=au`, `viewbox` = GRID_BBOX, `bounded=1`, `limit=5`, attribution "Search © OpenStreetMap contributors (Nominatim)".
- Pipeline files stay gzipped-but-not-`.gz`-named, like `*.grid.bin`.

## Review Focus

1. A point inside two schools' main intake rings (overlap from drawing error) → deterministic answer (lowest school index wins) and the overlap is counted per school in `intake_qa.csv` for manual review. (Task 3 `test_rasterise_overlap_counts`.)
2. A school with no intake PDF (education support centres, specialist schools) → no crash, listed as "no intake map" in QA, not selectable in the picker. (Task 2 test.)
3. Address search outside the mapped area or with zero results → clear message, map does not move. (Task 7 test.)
4. Picker selects a school whose intake area lies outside the grid → map shows nothing reachable and says so, rather than silently showing the full map. (Task 6 test.)
5. Intake files failing to load → route panel still works; schools section shows "School data unavailable". (Task 8 test.)

---

### Task 1: GeoPDF intake extraction module

**Files:**
- Create: `data_gen/intake.py` (replaces the PoC `data_gen/intake/` directory — delete it in this task)
- Create fixtures: `data_gen/tests/fixtures/intake_5464.pdf` (Wembley PS, already committed), `data_gen/tests/fixtures/intake_5464.geojson` (PoC output, already committed)
- Modify: `data_gen/data/pyproject.toml` (add `pymupdf>=1.24`, `pyproj>=3.6`)
- Test: `data_gen/tests/test_intake.py`

**Interfaces:**
- Produces:
  - `georef(doc: pymupdf.Document) -> Callable[[float, float], tuple[float, float]]` — page user-space (x, y with y measured from the top, as PyMuPDF drawings report) → (lon, lat) WGS84. Affine least-squares fit of the `/VP … /Measure /GEO` GPTS/LPTS corners in EPSG:28350; raises `ValueError("not a GeoPDF")` if absent.
  - `boundary_rings(pdf: Path) -> list[shapely.Polygon]` — closed rings from drawings whose layer name contains `intake` (case-insensitive, excluding `legend`) or whose stroke ≈ (0, 0.149, 0.451) with > 20 items; drops rings < 4 points (hatching); returns WGS84 polygons, `buffer(0)`-fixed.
  - `select_intake(rings: list[Polygon], school: tuple[float, float]) -> tuple[Polygon | None, list[Polygon]]` — main = the smallest ring containing the school (lon, lat), else the ring nearest to the school within 2 km, else None; optional = rings that overlap main's boundary by < 50 % of their area and are not main (i.e. attached annexes). Rings fully disjoint from main are neighbours → discarded.

- [ ] **Step 1: Write failing tests** in `test_intake.py`:
  - `test_georef_residual`: fit on fixture; transforming the four LPTS corners reproduces GPTS within 1 m.
  - `test_boundary_matches_poc`: `unary_union(boundary_rings(fixture))` vs `intake_5464.geojson` IoU > 0.98.
  - `test_select_intake_wembley`: with school point = the fixture geojson's representative point, main area (EPSG:7850) is 2.1 km² ± 0.2.
  - `test_select_intake_picks_smallest_containing`: synthetic nested squares 10 km / 1 km around (0,0) → main is the 1 km one.
  - `test_not_geopdf`: a plain one-page PDF made with `pymupdf.open()` + `new_page()` raises `ValueError`.
- [ ] **Step 2:** Run `cd data_gen/data && uv run --group dev pytest ../tests/test_intake.py -q` → FAIL (module missing).
- [ ] **Step 3:** Implement the three functions in `data_gen/intake.py`, porting `data_gen/intake/extract.py` (note it flips y with `H - y`; keep that).
- [ ] **Step 4:** Run the tests → PASS.
- [ ] **Step 5:** `git rm -r data_gen/intake`, commit `feat(data): extract intake areas from DoE GeoPDFs`.

### Task 2: School list and fast intake-map download

**Files:**
- Create: `data_gen/schools.py`
- Test: `data_gen/tests/test_schools.py`

**Interfaces:**
- Consumes: `BBox`, `GRID_BBOX`, `INPUT`, `log` from `pipeline.py`.
- Produces:
  - `SLIP_SCHOOLS = "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Education/MapServer/13/query"`
  - `@dataclass School: code: str; name: str; primary: bool; secondary: bool; lat: float; lon: float`
  - `fetch_schools(bbox: BBox, session=requests) -> list[School]` — pages with `resultOffset` until `exceededTransferLimit` is false; keeps GOVERNMENT schools inside bbox; title-cases `schoolname`; levels per Global Constraints; drops schools that are neither level.
  - `download_maps(codes: list[str], dest: Path, workers: int = 8, session=None) -> dict[str, list[Path]]` — per code, the PDFs that exist (`<code>_1.pdf`, `<code>_2.pdf`); cached files are not re-fetched; non-PDF bodies are not saved; 3 retries with 1/2/4 s backoff on connection errors and 5xx.

- [ ] **Step 1: Write failing tests** with a fake session object (`.get(url, params, timeout)` returning canned JSON/bytes):
  - `test_fetch_schools_pages`: two pages (first `exceededTransferLimit: true`) → both pages' schools returned; second request has `resultOffset` = page-1 length.
  - `test_levels`: PKG–Y06 → primary only; Y07–Y12 → secondary only; KIN–Y12 → both; NON-GOVERNMENT dropped; outside bbox dropped.
  - `test_download_skips_cached_and_non_pdf`: code A has cached `A_1.pdf` (no request made), code B returns HTML for map 1 and `%PDF…` for map 2 → `{"A": [A_1.pdf], "B": [B_2.pdf]}`.
  - `test_download_retries_5xx`: 503, 503, PDF → saved, 3 calls.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement in `data_gen/schools.py` (`concurrent.futures.ThreadPoolExecutor(workers)`, one `requests.Session` per thread when `session` is None).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(data): fetch public schools and download intake maps in parallel`.

### Task 3: `schools` pipeline stage — web outputs

**Files:**
- Modify: `data_gen/schools.py`, `data_gen/pipeline.py` (`main()`: register subcommand `schools` with `--force`, `--workers` default 8)
- Modify: `data_gen/README.md` (stage, output formats, licence)
- Test: `data_gen/tests/test_schools.py`

**Interfaces:**
- Consumes: Task 1 functions, Task 2 `School`, `fetch_schools`, `download_maps`; `grid_meta`, `WEB`, `write_json` from `pipeline.py`.
- Produces (in `WEB`, i.e. `data_gen/data/results/web/`):
  - `schools.json`: `{"asOf": "<YYYY-MM-DD>", "source": "...", "schools": [[code, name, levels, lat, lon, hasIntake]]}` where `levels` ∈ `"P" | "S" | "PS"`; array index = school index used everywhere else.
  - `intake.json`: FeatureCollection; feature properties `{"i": <school index>, "kind": "main" | "optional"}`; geometry simplified 5 m in EPSG:7850, coordinates rounded to 5 dp.
  - `intake.bin` (gzipped): magic `PMI1`, u16 version 1, u32 width, u32 height, then two little-endian u16 planes `primary`, `secondary` (school index, `0xFFFF` none) for each grid cell centre inside that level's main ring.
  - `intake_qa.csv` in `RESULTS`: `code,name,maps,rings,main_found,area_km2,overlaps` for review.
  - `encode_intake(primary: np.ndarray, secondary: np.ndarray, meta: GridMeta) -> bytes` / `decode_intake(b: bytes) -> tuple[np.ndarray, np.ndarray]`
  - `rasterise(meta: GridMeta, polys: list[tuple[int, Polygon]]) -> tuple[np.ndarray, int]` — u16 plane + count of cells claimed twice (first claim wins; uses `shapely.contains_xy` on cell centres `minLon + ix*spacing`, `minLat + iy*spacing`).

- [ ] **Step 1: Write failing tests:** `test_intake_bin_roundtrip`; `test_rasterise_square` (toy grid minLon = minLat = 0, spacing 0.001, 20×20; square from -0.0005 to 0.0095 on both axes → exactly 100 cells = index, rest `0xFFFF`); `test_rasterise_overlap_counts` (two overlapping squares → overlap count = shared cells, first index wins); `test_stage_writes_outputs` (monkeypatch `fetch_schools`/`download_maps` to return one school with the Task 1 fixture → all four files exist, `schools.json` row `hasIntake` true, `intake.bin` has ≥ 1 cell = 0 in primary plane).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `schools_stage(args)`; P and S rasterised separately using each school's main ring per its levels (K–12 school's map counts for both). Log totals: schools, with maps, main found, overlaps.
- [ ] **Step 4:** Run → PASS. Also run the full pipeline suite: `cd data_gen/data && uv run --group dev pytest ../tests -q` → all pass.
- [ ] **Step 5:** Commit `feat(data): schools stage writes schools, intake polygons and per-cell intake grid`.

### Task 4: Web data access for schools

**Files:**
- Create: `src/lib/schools.ts`
- Test: `src/lib/__tests__/schools.test.ts`

**Interfaces:**
- Consumes: `fetchJson`, `dataUrl`, `cellAt`, `GridMeta` from `src/lib/grid.ts` (export `gunzip` from `grid.ts` for reuse).
- Produces:
  - `interface School {index: number; code: string; name: string; primary: boolean; secondary: boolean; lat: number; lon: number; hasIntake: boolean}`
  - `interface SchoolData {asOf: string; schools: School[]; intake: {primary: Uint16Array; secondary: Uint16Array}; areas: IntakeFeature[]}` with `IntakeFeature = {i: number; kind: 'main' | 'optional'; positions: [number, number][][][]}` (Leaflet lat,lng order)
  - `loadSchoolData(meta: GridMeta): Promise<SchoolData>` — cached; failed load evicted.
  - `decodeIntake(buf: ArrayBuffer, meta: GridMeta): Promise<{primary: Uint16Array; secondary: Uint16Array}>` — throws on bad magic/size like `decodeGrid`.
  - `intakeAt(data: SchoolData, meta: GridMeta, lat: number, lng: number): {primary: School | null; secondary: School | null} | null` — null outside grid.
  - `intakeMask(data: SchoolData, selected: number[]): Uint8Array | null` — 1 where the cell's primary or secondary index is in `selected`; null when `selected` is empty.
  - `NO_SCHOOL = 0xffff`

- [ ] **Step 1: Write failing tests:** decode roundtrip from a hand-built buffer (gzipped with `CompressionStream` in test, and raw); bad magic throws; `intakeAt` returns the right schools / null outside; `intakeMask` empty → null, selection of a secondary marks its cells only.
- [ ] **Step 2:** `npm test -- schools` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(web): load schools and per-cell intake grid`.

### Task 5: Property report panel

**Files:**
- Create: `src/components/report/PropertyReport.tsx`, `src/components/report/SchoolsSection.tsx`
- Modify: `src/App.tsx` (render `PropertyReport` in `ControlCard` instead of bare `RoutePanel`)
- Test: `src/components/report/__tests__/PropertyReport.test.tsx`

**Interfaces:**
- Consumes: `RoutePanel` (unchanged props), Task 4 `School`, `intakeAt`.
- Produces:
  - `PropertyReport({title, route, schools, onClose})` where `title: string` (address label, or `"-31.95123, 115.86021"`), `route: ClickedRoute`, `schools: {primary: School | null; secondary: School | null} | 'loading' | 'error' | null`.
  - `SchoolsSection({schools, asOf})` — heading "Schools"; rows "Primary: <name>" / "Secondary: <name>" or "No public <level> intake area here"; the exact caveat sentence and official-lookup link from Global Constraints; "As of <asOf>" in muted text; `'error'` → "School data unavailable".

- [ ] **Step 1: Write failing tests:** title rendered as heading; both school names shown; missing level shows "No public secondary intake area here"; caveat text exact; link href exact; `'error'` shows "School data unavailable" and the route still renders; Escape still closes (delegated to RoutePanel).
- [ ] **Step 2:** `npm test -- PropertyReport` → FAIL.
- [ ] **Step 3:** Implement; in `App.tsx` load `loadSchoolData(index.grid)` once after the index loads, compute `intakeAt` for `route.point`.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat(web): property report with intake schools`.

### Task 6: School picker limits the map to intake areas

**Files:**
- Create: `src/components/panel/SchoolPicker.tsx`, `src/components/map/IntakeLayer.tsx`
- Modify: `src/lib/contours.ts` (`buildBands(grid, thresholds, water, mask?: Uint8Array | null)`: cells with `mask[i] === 0` treated as unreachable), `src/lib/contours.worker.ts` (pass `mask`), `src/lib/useWindowData.ts` (`useWindowData(index, day, hour, mask, deps)`; band cache key includes a mask id — use a `WeakMap<Uint8Array, number>` id), `src/components/panel/ControlCard.tsx` (render picker below the day toggle), `src/components/map/TravelTimeMap.tsx` (children slot already exists — add `IntakeLayer` there from `App.tsx`), `src/App.tsx`
- Test: `src/lib/__tests__/contours.test.ts`, `src/lib/__tests__/useWindowData.test.tsx`, `src/components/panel/__tests__/SchoolPicker.test.tsx`

**Interfaces:**
- Consumes: Task 4 `SchoolData`, `intakeMask`.
- Produces:
  - `SchoolPicker({schools, selected, onChange})` — text filter over schools with `hasIntake`, results show name + "Primary"/"Secondary"/"K–12", max 8 shown; selected shown as removable chips; `selected: number[]` of school indices.
  - `IntakeLayer({areas, selected, highlight})` — draws main rings for `selected` ∪ `highlight` (the clicked point's schools) as 2 px outlines `#0f766e`; optional rings dashed (`dashArray: '4 4'`) with 10 % fill; non-interactive; own pane z-index 360.

- [ ] **Step 1: Write failing tests:** `buildBands` with mask covering the left half of a uniform 10-minute grid → bands only cover x < half; mask change triggers recompute and a different cache entry in `useWindowData`; picker filters by text, adds/removes chips, omits schools without intake; selected school with intake entirely outside the grid → card shows "Selected intake areas are outside the mapped area".
- [ ] **Step 2:** `npm test` → new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat(web): pick schools to limit the map to their intake areas`.

### Task 7: Address search

**Files:**
- Create: `src/lib/geocode.ts`, `src/components/panel/AddressSearch.tsx`
- Modify: `src/components/map/TravelTimeMap.tsx` (prop `focus?: [number, number] | null` → `map.flyTo(focus, 16)` when it changes), `src/App.tsx` (search result → `setClicked`, `setFocus`, report title = result label), `src/components/panel/ControlCard.tsx` (search box at top)
- Test: `src/lib/__tests__/geocode.test.ts`, `src/components/panel/__tests__/AddressSearch.test.tsx`

**Interfaces:**
- Produces:
  - `interface Place {label: string; lat: number; lng: number}`
  - `geocode(q: string, opts?: {signal?: AbortSignal; fetch?: typeof fetch}): Promise<Place[]>` — GET `https://nominatim.openstreetmap.org/search?format=jsonv2&q=…&countrycodes=au&viewbox=115.679169,-31.725200,116.060099,-32.301063&bounded=1&limit=5`; label = `display_name` up to the postcode.
  - `AddressSearch({onSelect})` — form; submit on Enter/button only; one result → select it immediately; several → list; zero → "No match in the mapped area"; error → "Search unavailable"; attribution line under the box.

- [ ] **Step 1: Write failing tests:** URL contains every pinned param; label trimming; typing does not call fetch; submit calls once; zero results message and `onSelect` not called; single result auto-selects.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat(web): address search snaps to the grid and opens the property report`.

### Task 8: Real data run, e2e, docs

**Files:**
- Modify: `scripts/e2e-route.py` (search "Wembley Primary School" or a fixed street address → report shows "Primary: Wembley Primary School"), `README.md` (feature section + attributions: DoE CC BY 4.0, DET-024 CC BY-NC 4.0, Nominatim/OSM), `public/data/` (copy `schools.json`, `intake.json`, `intake.bin`)

- [ ] **Step 1:** Run the stage: `cd data_gen && docker compose run --rm route python pipeline.py schools` (or `cd data_gen/data && DATA_DIR=. uv run python ../pipeline.py schools` if the grid meta is available locally). Expected log: ~420–450 metro public schools, > 95 % with a main ring.
- [ ] **Step 2:** Review `intake_qa.csv`: list schools with `main_found = false` or `overlaps > 0`; spot-check 5 polygons against the DoE PDFs. Note results in the commit message.
- [ ] **Step 3:** Copy the three web files to `public/data/`; `npm run build` succeeds; `npx vite preview --port 4789` + `uv run --with playwright==1.58.0 python scripts/e2e-route.py` → PASS.
- [ ] **Step 4:** Commit `data: metro intake areas; docs and e2e for address search and schools`; push.
