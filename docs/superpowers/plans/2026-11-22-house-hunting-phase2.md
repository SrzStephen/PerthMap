# House Hunting Phase 2 — Hazards & Noise, Attribute Grid, Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a point → see its bushfire, acid-sulfate, traffic, road/rail-noise and powerline facts; tick filters
("not bushfire prone", "≥ 200 m from powerlines", …) to limit the travel-time map to cells that pass; show each layer
on the map.

**Architecture:** A new pipeline stage `hazards` fetches SLIP/Main Roads layers and OSM power and road lines,
rasterises them onto the travel-time grid and writes one self-describing attribute file (`attrs.bin`, `PMA1`) plus a
`layers.json` manifest — public fields to `web/`, personal-use fields to `web/local/`. The web app decodes both
(local only when `VITE_LOCAL_LAYERS=1`), builds a pass mask from active filters, ANDs it with the phase 1 intake mask
and hands it to the existing `buildBands(…, mask)`. Area layers are drawn from the grid itself (no large vectors);
line layers ship as small simplified GeoJSON.

**Tech Stack:** Python 3.12 (uv), geopandas, shapely 2 (`STRtree`, `contains_xy`), requests, osmium (Docker image);
React 19, react-leaflet 5, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-house-hunting-design.md` (phase 2). Builds on phase 1
(`docs/superpowers/plans/2026-11-18-house-hunting-phase1.md`).

**Scope decision:** phase 4 of the spec owns ANEF, flood, contaminated/odour, zones, R-codes and lots. Phase 2 =
bushfire (public), traffic volumes (public), OSM powerlines/substations (public), acid sulfate (local), SPP 5.4 noise
corridors (local), and the local-build plumbing those two need.

## Global Constraints

- Grid = `GridMeta` of `public/data/index.json` (381 × 576, spacing 0.001°, row 0 south); reuse `schools.web_grid_meta()`. A cell's value is taken at its centre `(min_lon + ix·s, min_lat + iy·s)`.
- Metric work in EPSG:7850 (as phase 1).
- SLIP base: `https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/<svc>/MapServer/<id>/query`, `f=geojson`, `outSR=4326`, envelope = `GRID_BBOX`, paged by `resultOffset` until `exceededTransferLimit` is false.
- Layers (id → source → build):
  - `bushfire` → `Bush_Fire_Prone_Areas/23` (OBRM-026), CC BY 4.0 → public
  - `traffic` → `https://gisservices.mainroads.wa.gov.au/arcgis/rest/services/OpenData/RoadAssets_DataPortal/MapServer/27` (Traffic Digest, count sites), CC BY 4.0 → public
  - `power` → OSM `power=line` ways + `power=substation` (nodes/ways), ODbL → public
  - `acid` → `Soil_Risk_Map/3` (DWER-055) → local
  - `noise` → `Property_and_Planning/100` (DPLH-057, polygons) → local
- Local files never reach the public site: pipeline writes them to `web/local/`, they are copied to `public/data/local/` (git-ignored), the app reads them only when `import.meta.env.VITE_LOCAL_LAYERS === '1'`, and a non-local `vite build` deletes `dist/data/local`.
- Local-only rows in a public build say "<Title>: local build only" and link to PlanWA `https://espatial.dplh.wa.gov.au/PlanWA/Index.html?viewer=PlanWA`.
- Every report row shows its source id and "as of <date>" from `layers.json`.
- Pipeline web files stay gzipped-but-not-`.gz`-named (like `intake.bin`).

### Fields (`attrs.bin`)

| field | dtype | meaning | file |
|---|---|---|---|
| `bushfire` | u8 | 1 inside a designated bushfire prone area | public |
| `power_m` | u16 | metres to nearest OSM power line or substation, capped 5000 | public |
| `traffic_k` | u8 | busiest counted road within 200 m, thousand vehicles/day (Mon–Sun), floor, cap 255; 0 none | public |
| `acid` | u8 | 0 none, 1 "High to moderate risk" (`risk_class` 1), 2 "Moderate to low risk" (2) | local |
| `noise` | u8 | 0 none, else 1-based index into `NOISE_TYPES` (overlaps: lowest code wins) | local |

`NOISE_TYPES = ["Strategic freight and/or major traffic route", "Other significant freight/traffic route", "Freight railway", "Metropolitan passenger railway", "Proposed strategic freight route", "Proposed metropolitan passenger railway"]` (SPP 5.4 `feature_type`).

### Filters

| id | label | passes | thresholds (default) | local |
|---|---|---|---|---|
| `bushfire` | Not bushfire prone | `v == 0` | — | no |
| `power` | Away from powerlines | `v >= t` m | 100, 200, 500 (200) | no |
| `traffic` | No busy road within 200 m | `v < t` k/day | 10, 20, 40 (20) | no |
| `acid` | No high acid sulfate risk | `v != 1` | — | yes |
| `noise` | Outside road/rail noise areas | `v == 0` | — | yes |

## Review Focus

1. A local build where `public/data/local/` is missing or stale → public layers and filters still work; local rows say "Local data not found — run the hazards stage". (Task 3 `local attrs missing`; Task 6 row test.)
2. Filters (alone or with a school selection) exclude every cell → card says "No mapped area passes the selected filters" instead of a silently empty map. (Task 4 test.)
3. A SLIP/ArcGIS response that is HTTP 200 with an `{"error": …}` body, or an empty first page → stage raises; it never writes an all-zero layer. (Task 1 `test_fetch_error_body`, `test_fetch_empty_raises`.)
4. `attrs.bin` whose width/height no longer match `index.json` (grid regenerated) → decode throws, the data counts as unavailable, the route panel still works. (Task 3 test.)
5. A public `npm run build` with `public/data/local/` present on disk → `dist/data/local` does not exist. (Task 7 test.)

---

### Task 1: Attribute grid primitives (pipeline)

**Files:**
- Create: `data_gen/attrs.py`
- Test: `data_gen/tests/test_attrs.py`

**Interfaces:**
- Consumes: `GridMeta`, `BBox`, `GRID_BBOX` from `pipeline.py`.
- Produces:
  - `ATTRS_MAGIC, ATTRS_VERSION = b"PMA1", 1`
  - `encode_attrs(fields: dict[str, np.ndarray], meta: GridMeta) -> bytes` — gzip(level 9) of: magic, `<H` version, `<I` width, `<I` height, `<H` n; per field `<B` name length, ASCII name, `<B` dtype (1 = u8, 2 = u16); zero byte pad to an even offset; then each plane little-endian in order. Raises `ValueError` if a plane's length ≠ w·h or dtype is not u8/u16.
  - `decode_attrs(b: bytes) -> tuple[tuple[int, int], dict[str, np.ndarray]]`
  - `cell_centres(meta: GridMeta) -> tuple[np.ndarray, np.ndarray]` — flat lon, lat arrays (row-major, row 0 south).
  - `inside_code(meta, coded: list[tuple[int, BaseGeometry]]) -> np.ndarray[u8]` — code of the polygon holding each centre; lowest code wins on overlap; 0 outside. Bbox-prefilter per polygon, then `shapely.contains_xy`.
  - `distance_m(meta, geoms_m: list[BaseGeometry], cap: int) -> np.ndarray[u16]` — metres (rounded) from each centre (projected to EPSG:7850) to the nearest geometry, `cap` if none within cap. `STRtree.query_nearest(..., max_distance=cap, return_distance=True)`.
  - `max_within(meta, valued_m: list[tuple[int, BaseGeometry]], radius: float) -> np.ndarray[u8]` — largest value of any geometry within `radius` m of the centre, 0 if none; values clipped to 255. `STRtree.query(points, predicate="dwithin", distance=radius)` + `np.maximum.at`.
  - `fetch_arcgis(url: str, bbox: BBox, out_fields: str = "*", session=requests) -> list[dict]` — GeoJSON features, paged; raises `RuntimeError` on an `error` body or zero features.

- [ ] **Step 1: Write failing tests** (toy meta: `GridMeta(20, 20, 0.0, 0.0, 0.001)` for planar helpers; for metric helpers use `GridMeta(20, 20, 115.86, -31.95, 0.001)`):
  - `test_roundtrip`: `bushfire` u8 + `power_m` u16 → decode gives equal arrays, `(20, 20)`; odd-length names exercise the pad.
  - `test_encode_rejects_bad_plane`: length 399 → `ValueError`; float32 → `ValueError`.
  - `test_inside_code_overlap`: square A (code 2) x,y ∈ [-0.0005, 0.0095], square B (code 1) x,y ∈ [0.0045, 0.0145] → shared cells = 1, A-only cells = 2, total nonzero = 100 + 100 − 25.
  - `test_distance_cap`: a point geometry at the centre of cell (10, 10) in EPSG:7850 → that cell 0, neighbour east ≈ 95 m (±5), far corner = cap when cap = 300.
  - `test_max_within`: two lines through cell (5, 5) with values 12 and 30 and one with 300 far away → (5, 5) = 30, far cells 0, a cell beside the 300 line = 255.
  - `test_fetch_pages`: fake session, page 1 `exceededTransferLimit: true` (2 feats) then page 2 (1 feat) → 3 features; second call's `resultOffset` = 2; params include `outSR=4326`, `f=geojson`, `geometryType=esriGeometryEnvelope`.
  - `test_fetch_error_body`: `{"error": {"code": 400}}` → `RuntimeError`.
  - `test_fetch_empty_raises`: `{"features": []}` → `RuntimeError`.
- [ ] **Step 2:** `cd data_gen/data && uv run --group dev pytest ../tests/test_attrs.py -q` → FAIL (module missing).
- [ ] **Step 3:** Implement `data_gen/attrs.py`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(data): attribute grid format and rasterising helpers`.

### Task 2: `hazards` pipeline stage

**Files:**
- Create: `data_gen/hazards.py`
- Modify: `data_gen/pipeline.py` (`main()`: subcommand `hazards`, lazy import like `schools`), `data_gen/Dockerfile` (COPY `attrs.py hazards.py`), `data_gen/README.md` (stage row, `attrs.bin`/`layers.json`/`powerlines.json`/`traffic.json` formats, local files, licences)
- Test: `data_gen/tests/test_hazards.py`

**Interfaces:**
- Consumes: Task 1; `osm_layer`, `INPUT`, `WEB`, `GRID_BBOX`, `write_json`, `log` from `pipeline.py`; `web_grid_meta` from `schools.py`.
- Produces:
  - `latest_sites(features: list[dict]) -> list[tuple[float, float, int]]` — `(lon, lat, aadt)` per `SITE_NO`, newest `TRAFFIC_YEAR` (string sort, e.g. `"2023/24"`), `aadt = MON_SUN`; sites without `MON_SUN` dropped.
  - `road_volumes(roads: gpd.GeoDataFrame, sites: gpd.GeoDataFrame, snap_m=60, reach_m=2000) -> np.ndarray[int]` — both in EPSG:7850; `roads` has `name` (may be null), `sites` has `aadt`. Each site anchors to its nearest road within `snap_m` (else ignored) and takes that road's name. A road's volume = aadt of the nearest anchored site with the same non-null name within `reach_m`; an unnamed road only gets sites anchored to itself; else 0.
  - `build(web: Path, meta: GridMeta, fetch=fetch_arcgis, osm=osm_layer) -> None` — writes
    - `web/attrs.bin` (`bushfire`, `power_m`, `traffic_k`), `web/layers.json`, `web/powerlines.json` (power lines, 10 m simplified, 5 dp; substations as `Point` at their representative point; props `{kind: "line" | "substation"}`), `web/traffic.json` (roads with volume ≥ 5000, merged per (name, k) with `linemerge`, 10 m simplified, props `{k: thousands}`);
    - `web/local/attrs.bin` (`acid`, `noise`), `web/local/layers.json`.
  - `layers.json`: `{"layers": [{"id", "field", "title", "source", "licence", "url", "asOf", "local"}]}` — `source` = the dataset id (`OBRM-026`, `Main Roads Traffic Digest`, `OpenStreetMap`, `DWER-055`, `DPLH-057`), `asOf` = run date.
  - OSM filters: roads `w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link` (linestring); power `w/power=line` (linestring) and `nwr/power=substation` (point + polygon), source `INPUT / "perth.osm.pbf"`.
  - `hazards_stage(args)` — `build(WEB, web_grid_meta())`; logs counts per layer and the share of cells flagged per field.

- [ ] **Step 1: Write failing tests:**
  - `test_latest_sites`: same `SITE_NO` with `2021/22` (5000) and `2023/24` (7000) → one site, 7000; missing `MON_SUN` dropped.
  - `test_road_volumes`: collinear "Canning Hwy" segments at 0–1 km, 1–2 km, 2.6–4 km and a parallel unnamed segment 500 m away; one site at 0.5 km on segment 1 (aadt 40000) and one site 100 m from every road (aadt 99000, ignored) → volumes `[40000, 40000, 0, 0]` (segment 3's nearest point is 2.1 km away, beyond `reach_m`).
  - `test_build_writes_outputs`: fake `fetch` keyed by URL (bushfire square over the toy grid's west half, acid class 1 square, one noise polygon with `feature_type` "Freight railway", two traffic sites) and fake `osm` returning tiny GeoDataFrames → all six files exist; public `attrs.bin` fields are exactly `{bushfire, power_m, traffic_k}`, local exactly `{acid, noise}`; noise cells = 3; `layers.json` ids `{bushfire, traffic, power}` all `local: false`.
- [ ] **Step 2:** `uv run --group dev pytest ../tests/test_hazards.py -q` → FAIL.
- [ ] **Step 3:** Implement; register the subcommand; update Dockerfile and README.
- [ ] **Step 4:** Whole suite: `uv run --group dev pytest ../tests -q` → PASS.
- [ ] **Step 5:** Commit `feat(data): hazards stage writes public and local attribute grids and line layers`.

### Task 3: Web attribute data and filter masks

**Files:**
- Create: `src/lib/attrs.ts`, `src/lib/filters.ts`, `src/lib/local.ts`
- Modify: `src/vite-env.d.ts` (`VITE_LOCAL_LAYERS?: string`)
- Test: `src/lib/__tests__/attrs.test.ts`, `src/lib/__tests__/filters.test.ts`

**Interfaces:**
- Consumes: `gunzip`, `dataUrl`, `fetchJson`, `cellAt`, `GridMeta` from `grid.ts`.
- Produces:
  - `local.ts`: `export const LOCAL_LAYERS = import.meta.env.VITE_LOCAL_LAYERS === '1'`; `export const PLANWA = 'https://espatial.dplh.wa.gov.au/PlanWA/Index.html?viewer=PlanWA'`.
  - `attrs.ts`:
    - `type Plane = Uint8Array | Uint16Array`
    - `interface LayerInfo {id: string; field: string; title: string; source: string; licence: string; url: string; asOf: string; local: boolean}`
    - `interface AttrData {fields: Record<string, Plane>; layers: LayerInfo[]; localStatus: 'off' | 'ok' | 'missing'}`
    - `decodeAttrs(body: ArrayBuffer, meta: GridMeta): Promise<Record<string, Plane>>` — throws `'attrs format'` / `'attrs size'`.
    - `loadAttrs(meta: GridMeta, local = LOCAL_LAYERS): Promise<AttrData>` — cached, failed load evicted; public `attrs.bin` + `layers.json` required; when `local`, `local/attrs.bin` + `local/layers.json` merged in, any failure → `localStatus: 'missing'` (logged, not thrown).
    - `attrsAt(data: AttrData, meta: GridMeta, lat: number, lng: number): Record<string, number> | null`
  - `filters.ts`:
    - `interface FilterDef {id: string; field: string; label: string; thresholds?: number[]; unit?: string; defaultThreshold?: number; passes: (v: number, t: number) => boolean}`
    - `FILTERS: FilterDef[]` — the Filters table above, in that order.
    - `type ActiveFilters = Record<string, number>` — filter id → threshold (0 for threshold-less filters).
    - `availableFilters(data: AttrData): FilterDef[]` — those whose field is loaded.
    - `filterMask(data: AttrData, active: ActiveFilters): Uint8Array | null` — 1 where every active, available filter passes; null when none active.
    - `andMasks(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null` — null-aware AND (returns the non-null one unchanged).

- [ ] **Step 1: Write failing tests:**
  - attrs: decode a hand-built buffer (u8 + u16 field, odd name length; raw and gzipped via `CompressionStream`); wrong magic → throws; width mismatch → throws `attrs size`; `loadAttrs` with mocked `fetch`: public ok + local 404 → `localStatus: 'missing'`, public fields present (**local attrs missing**); `local=false` → never requests `local/…`, `localStatus: 'off'`; public 404 → rejects, and a second call retries.
  - filters: `power` at 200 passes 200 not 199; `traffic` at 20 passes 19 not 20; `acid` passes 0 and 2, fails 1; two filters AND; `filterMask(…, {})` → null; filter whose field isn't loaded is ignored and not in `availableFilters`; `andMasks(null, m) === m`; `andMasks(a, b)` elementwise.
- [ ] **Step 2:** `npm test -- attrs filters` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(web): load attribute grids and build filter masks`.

### Task 4: Filter panel limits the map

**Files:**
- Create: `src/components/panel/FilterPanel.tsx`
- Modify: `src/App.tsx` (load attrs after index like schools; `active` state; `mask = andMasks(intakeMask(...), filterMask(...))`; the "empty" message moves from `SchoolPicker`'s `empty` prop to one App-level line), `src/components/panel/SchoolPicker.tsx` (keep `empty` prop but App passes it only when no filter is active)
- Test: `src/components/panel/__tests__/FilterPanel.test.tsx`, `src/__tests__/App.filters.test.tsx` (or extend an existing App-level test if present)

**Interfaces:**
- Consumes: Task 3 `AttrData`, `FILTERS`, `availableFilters`, `ActiveFilters`.
- Produces:
  - `FilterPanel({filters, active, onChange, shown, onShownChange, layers})` — disclosure titled "Hazards & noise" (collapsed by default, shows "(<n> on)" when filters are active); one row per `LayerInfo` that has a loaded field: checkbox with the filter label (if a `FilterDef` exists), a `<select aria-label="<label> threshold">` for thresholds (e.g. "200 m", "20k/day"), and a toggle button `aria-pressed` `aria-label="Show <title>"`. `shown: string[]` of layer ids.
  - App shows, under the filters, `"No mapped area passes the selected filters"` when the combined mask has no 1 and any filter is active (school-only empty keeps phase 1 text).

- [ ] **Step 1: Write failing tests:** ticking "Not bushfire prone" calls `onChange({bushfire: 0})`; ticking "Away from powerlines" uses 200; changing its select to 500 → `{power: 500}`; unticking removes the key; local filters absent when their field is not loaded; "Show Bushfire prone areas" toggles `onShownChange(['bushfire'])`; App with all-bushfire attrs + bushfire filter → the exact empty message.
- [ ] **Step 2:** `npm test -- FilterPanel App` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → all PASS.
- [ ] **Step 5:** Commit `feat(web): hazard and noise filters limit the travel-time map`.

### Task 5: Map layers

**Files:**
- Create: `src/components/map/AttrRasterLayer.tsx`, `src/components/map/LineLayer.tsx`, `src/lib/raster.ts`
- Modify: `src/App.tsx` (render shown layers inside `TravelTimeMap`), `src/index.css` (`.pixelated { image-rendering: pixelated; }`)
- Test: `src/lib/__tests__/raster.test.ts`, `src/components/map/__tests__/LineLayer.test.tsx`

**Interfaces:**
- Consumes: Task 3 `Plane`, `GridMeta`; `dataUrl`, `fetchJson`.
- Produces:
  - `raster.ts`: `rasterPixels(values: Plane, meta: GridMeta, colour: (v: number) => [number, number, number, number] | null): Uint8ClampedArray` — RGBA, width × height, canvas row 0 = grid's **north** row; `rasterBounds(meta): [[number, number], [number, number]]` = `[[minLat − s/2, minLon − s/2], [minLat + (h − ½)s, minLon + (w − ½)s]]`.
  - `LAYER_STYLES: Record<string, (v: number) => RGBA | null>` — `bushfire` 1 → `#ea580c` α 110; `acid` 1 → `#a16207` α 120, 2 → α 60; `noise` >0 → `#7c3aed` α 100; `traffic_k` ≥ 10 → `#dc2626` α scaled 60–160 by value up to 60 (raster of the 200 m band).
  - `AttrRasterLayer({values, meta, colour})` — paints to an offscreen canvas once per `values`, `ImageOverlay` with `className="pixelated"`, opacity 1, own pane z-index 350, non-interactive.
  - `LineLayer({file, colour})` — fetches `powerlines.json` / `traffic.json` on first mount (cached per file), draws `Polyline`s (weight 2) and substations as `CircleMarker` radius 4; traffic weight 1.5 + k/20 capped 5. Load failure → renders nothing, logs.
  - Layer ids → renderer: `bushfire`, `acid`, `noise` → raster of their field; `traffic` → `LineLayer traffic.json` in `#dc2626`; `power` → `LineLayer powerlines.json` in `#1d4ed8`.

- [ ] **Step 1: Write failing tests:** `rasterPixels` on a 2 × 3 grid with value 1 only at row 0 (south) col 1 → coloured pixel at canvas row 2, col 1, all else α 0; `rasterBounds` exact numbers for the toy meta; `LineLayer` with mocked fetch of one LineString + one substation renders one polyline and one circle (use the existing leaflet test setup from `TravelTimeMap.leaflet.test.tsx`).
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(web): show hazard and noise layers on the map`.

### Task 6: Property report — hazards, noise & nuisances

**Files:**
- Create: `src/components/report/HazardsSection.tsx`
- Modify: `src/components/report/PropertyReport.tsx` (prop `attrs: AttrsState`, rendered after Schools), `src/App.tsx` (also in the bike-mode report)
- Test: `src/components/report/__tests__/HazardsSection.test.tsx`

**Interfaces:**
- Consumes: Task 3 `AttrData`, `attrsAt`, `LOCAL_LAYERS`, `PLANWA`.
- Produces:
  - `type AttrsState = {values: Record<string, number>; data: AttrData} | 'loading' | 'error' | null`
  - `HazardsSection({attrs, local})` — two sections, "Hazards" (bushfire, acid) and "Noise & nuisances" (traffic, noise, power), rows in that order. Copy (exact):
    - bushfire: `Bushfire prone area` / `Not bushfire prone`
    - acid: `Acid sulfate soils: high to moderate risk` / `Acid sulfate soils: moderate to low risk` / `Acid sulfate soils: no mapped risk`
    - traffic: `Busiest road within 200 m: ~<k>,000 vehicles/day` / `No counted busy road within 200 m`
    - noise: `In a road/rail noise area (<NOISE_TYPES[v-1]>)` / `Outside road/rail noise areas`
    - power: `Powerline or substation <n> m away` (n rounded to 10) / `No powerline or substation within 5 km` at the cap
    - layer absent, public build: `<title>: local build only` + link "PlanWA" → `PLANWA`
    - layer absent, local build with `localStatus: 'missing'`: `<title>: Local data not found — run the hazards stage`
    - under each row, muted: `<source> · as of <asOf>`
    - `'error'` → `Hazard data unavailable`; `'loading'` → `Loading hazards…`
  - Titles for absent local layers come from a constant `LOCAL_TITLES = {acid: 'Acid sulfate soils', noise: 'Road/rail noise areas'}`.

- [ ] **Step 1: Write failing tests:** each copy line above from a fabricated `AttrData`; public build without `acid` → "Acid sulfate soils: local build only" with exact link href; local missing → the "Local data not found" line; source/as-of line present; `'error'` text; PropertyReport still renders the route when attrs is `'error'`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat(web): property report hazards and noise rows`.

### Task 7: Local build plumbing, real data run, e2e, docs

**Files:**
- Create: `scripts/strip-local.ts` (exports `stripLocal(distDir: string, local: boolean): boolean`), `scripts/__tests__/strip-local.test.ts` (`// @vitest-environment node`)
- Modify: `vite.config.ts` (plugin `closeBundle` → `stripLocal('dist', env.VITE_LOCAL_LAYERS === '1')`), `.gitignore` (`public/data/local/`), `package.json` (`"dev:local": "VITE_LOCAL_LAYERS=1 vite"`, `"build:local": "VITE_LOCAL_LAYERS=1 vite build"`), `src/components/panel/ControlCard.tsx` footer (add "bushfire OBRM-026, traffic © Main Roads WA (CC BY 4.0)"), `README.md` (feature + attributions + local build how-to), `scripts/e2e-route.py` (report shows a "Hazards" heading; ticking "Not bushfire prone" keeps the map rendering), `public/data/` (copy public outputs)

- [ ] **Step 1: Write failing test:** temp dir with `data/local/attrs.bin` and `data/attrs.bin` → `stripLocal(dir, false)` removes `data/local` only and returns true; `stripLocal(dir, true)` leaves it and returns false; missing dir → false, no throw.
- [ ] **Step 2:** → FAIL; implement; → PASS.
- [ ] **Step 3:** Run the stage: `cd data_gen && docker compose run --rm --build --no-deps prepare hazards` (needs `data/input/perth.osm.pbf`). Check the log: bushfire share plausible (hills/edges, ~15–35 % of cells), traffic roads ≥ 5k matched for > 70 % of count sites, noise polygons are trigger-distance buffers (spot-check: Kwinana Fwy band ≈ 300 m each side).
- [ ] **Step 4:** Copy `attrs.bin layers.json powerlines.json traffic.json` to `public/data/`, `local/*` to `public/data/local/`; `npm run lint && npm test && npm run build` → `dist/data/local` absent; `npm run build:local` → present.
- [ ] **Step 5:** `npx vite preview --port 4789` + `uv run --with playwright==1.58.0 python scripts/e2e-route.py` → PASS.
- [ ] **Step 6:** Commit `data: hazards and noise layers; local build; docs and e2e`; push.
