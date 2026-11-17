# Raster travel times + click-for-route — design

Date: 2026-11-18 · Status: approved in brainstorming, pending spec review

## Goal

Replace the bundled polygon isochrones (`src/assets/poly.json`) with per-window raster travel-time grids,
and let the user click any point to see the fastest public-transport route to the Perth CBD and its timings.
The site stays fully static (GitHub Pages, no routing server); everything is precomputed by the MOTIS pipeline.

### Success criteria

- Map colours come from the grid's **median** travel time, as today, with shorelines as accurate as the current
  water-clipped polygons.
- User can pick a **day** (Weekday / Saturday / Sunday) and a **1-hour arrive-by window** (06–07 … 21–22).
- Clicking any point shows the **fastest** route in that window (walk → transit legs → walk) with times, plus the
  window's **typical** (median) time, e.g. "Best 38 min · typical 46 min".
- Changing day/hour with a route open re-resolves the same point.
- First load ≲ 500 KB of data; repo growth of ~10–20 MB is acceptable.

### Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Hosting | Static only |
| Time windows | 1 h arrive-by blocks, 06:00–22:00 (16 per day) |
| Days | Weekday (next Wednesday), Saturday, Sunday → 48 windows |
| Map colour vs route | Colour = median of the window; route = fastest in the window; panel shows both |
| Architecture | Per-window lazily loaded files, client-side contouring (option 1 of 3) |
| Grid encoding | gzipped binary planes (not PNG — canvas colour management/premultiplied alpha can corrupt values) |

### Out of scope

Shareable route URLs, destinations other than the CBD, depart-at mode, real street geometry for walk legs.

## 1. Pipeline (`data_gen/pipeline.py`)

**Days/windows.** Service dates: the next Wednesday, Saturday and Sunday inside the GTFS validity. Per day, 16
windows; window `HH` has 12 arrival samples `HH:00, HH:05 … HH:55` (no sample shared between windows).

**Per window**, reusing the current two-pass method:

1. Transit leg: one MOTIS `one-to-all` arrive-by query per sample → minutes from each stop to the CBD.
2. Access leg: walking minutes grid-cell → stop. Time-independent, computed **once per run** and reused by all
   48 windows. Only cells within `--walkable-within` (75 m) of a walkable way are considered (existing mask).
3. Combine per sample: `total(cell, t) = min(direct walk, min_stop walk(cell, stop) + transit(stop, t))`, and
   **track the argmin** (winning stop, or "direct walk") instead of discarding it.
4. Per cell output: `median` over samples (map colour), `fastest` = min over samples, plus the fastest sample's
   index, boarding stop and walk minutes.

**Itineraries.** Collect unique `(stop, sample)` pairs referenced by the grid; for each, request a MOTIS
arrive-by journey plan stop → CBD at that sample time. Keep per leg: mode, line short name, headsign, from/to
stop index, departure/arrival times, and the leg geometry (MOTIS encoded polyline). Identical polylines are
deduplicated within the window.

**Consistency.** The plan's own times are what the UI shows. Log, and record in `index.json`, the share of cells
where plan duration + walk differs from the grid's `fastest` by > 5 min; warn (not fail) above 5 %. Pairs with no
plan are recorded as missing; the run continues.

**Failure.** A window with zero reachable cells fails the run (GTFS not valid for the date).

**Stage layout.** `prepare` / `masks` unchanged. `route` gains `--days` and `--hours` and writes the files in §2
straight to `data/results/web/`; the old `isochrones` stage is removed. Copy step:
`cp -r data/results/web/* ../public/data/`.

## 2. Data format (`public/data/`, committed, fetched at runtime)

| File | Content | Loaded |
|---|---|---|
| `index.json` | `{version, generated, grid: {width, height, minLon, minLat, spacing}, days: [{key, label, date}], hours: [6…21], mismatchRate: {"weekday-08": 0.02, …}}` | startup |
| `water.json` | Simplified water + sea polygons (GeoJSON, 5-dp coords) | startup |
| `stops.json` | `[[name, lat, lon], …]`; array index = stop index used everywhere | first click |
| `{day}-{HH}.grid.bin.gz` | Header + planes, row-major (row 0 = south), see below | on window select |
| `{day}-{HH}.routes.json` | `{samples: ["08:00",…], paths: ["<polyline>",…], trips: {"<stop>:<sample>": {depart, arrive, legs: [{mode, line, headsign, from, to, depart, arrive, path}]}}}` | first click in window |

**Grid binary** (little-endian, gzip): header `magic "PMG1"`, `u16 version`, `u32 width`, `u32 height`, then planes
of `width × height`:

| Plane | Type | Meaning | Sentinels |
|---|---|---|---|
| median | u8 | minutes | 255 = unreachable |
| fastest | u8 | minutes | 255 = unreachable |
| sample | u8 | index into `samples` | 255 = n/a |
| walk | u8 | minutes walked to boarding stop (or total if direct walk) | 255 = n/a |
| stop | u16 | stop index | `0xFFFF` = none, `0xFFFE` = direct walk |

Header width/height must equal `index.json.grid`; otherwise the client refuses the file.

Removed: `src/assets/poly.json` and its static import.

## 3. Map rendering and controls (web)

**`src/lib/grid.ts`** — fetch + `DecompressionStream('gzip')` + header validation → `{median, fastest, sample,
walk: Uint8Array, stop: Uint16Array}`. Cache `Map<"day-HH", Promise<Grid>>`; prefetch adjacent hours. Pure
helpers: `cellAt(lat, lng)` → index or `null` outside the grid.

**`src/lib/contours.ts` (Web Worker)** — `d3-contour` over `median` (unreachable → large value) at the current
band thresholds (15…85 step 5); transform contour vertices `(x, y)` (d3-contour puts cell `i`'s centre at
`i + 0.5`) to `lng = minLon + (x − 0.5)·spacing`, `lat = minLat + (y − 0.5)·spacing`, matching the pipeline's
`round((lon − minLon) / spacing)` indexing; clip each band against `water.json` with `polyclip-ts`. Output: existing `Band[]`
(`MultiPolygon` positions). Fallback if the worker errors or clipping is too slow: unclipped contours on the main
thread (water cells are already unreachable → shoreline error ≲ 50 m). **First implementation task: measure
clip time for one window; pick the fallback as default if > ~300 ms.**

**`TravelTimeMap`** — takes `bands` as a prop instead of importing `BANDS`; keeps the current all-bands-mounted,
largest-first rendering in the translucent pane. Band popups are removed (route panel replaces them).

**`ControlCard`** — adds a Weekday/Saturday/Sunday segmented control and an hour slider labelled
"Arrive 08:00–09:00" (default 08). Existing minutes slider and legend unchanged. While a window loads, the previous
bands stay and a small spinner shows; on error, an inline message with Retry (which evicts the cache entry).

## 4. Click-for-route

1. Map click → `cellAt`. Outside grid → "Outside the mapped area". `fastest == 255` → "No public transport route
   within 2 h (max 15 min walk to a stop)".
2. Otherwise read `median, fastest, sample, walk, stop`; lazy-load `stops.json` and the window's `routes.json`;
   look up `trips["stop:sample"]`. `stop == 0xFFFE` → direct walk.

**Map overlay (own pane above bands):** pin at click; dashed straight walk line to the boarding stop; each transit
leg as its decoded polyline, coloured by mode (train / bus / ferry); dots at board/transfer/alight stops; dashed
final walk to the CBD marker. Pan to fit only if the route is partly off-screen.

**Panel** (replaces slider content while open; existing mobile bottom sheet on small screens):

```
Best 38 min · typical 46 min          ✕
Leave 07:22 → arrive 08:00 (Weekday)
🚶 Walk 6 min to Warwick Stn Platform 2
🚆 Joondalup line → Elizabeth Quay   07:28 – 07:51
🚶 Walk 4 min to Perth CBD
```

"Leave" = first transit departure − walk minutes. Direct-walk cells show "Walk N min". Missing trip → both times
plus "Route details unavailable". Changing day/hour re-resolves the same point. ✕, Esc, or clicking an unreachable
cell closes; a new click replaces.

## 5. Error handling and testing

**Errors** — load/decode failure: keep previous window, inline message + Retry. Worker failure: main-thread
unclipped fallback, console log. Header/version mismatch: error message, nothing drawn. Pipeline: hard fail on a
window with no reachable cells; mismatch-rate warning as in §1.

**Pipeline tests (pytest, new `data_gen/tests/`)** — argmin tracking on a synthetic grid (stop, sample, walk match
a brute-force minimum, including direct-walk wins); grid binary write/read round-trip incl. sentinels; route and
polyline dedup; ocean majority-vote on a synthetic coastline. MOTIS is mocked; full runs stay manual.

**Web tests (vitest)** — grid decode (gzip, header validation, sentinels); `cellAt` incl. edges; contours from a
hand-made grid (nesting, unreachable handling, water clipping); trip lookup; route panel rendering for transit,
direct walk, unreachable and missing trip; day/hour controls.

**E2E (Playwright, manual script)** — load, change hour, click a Joondalup point, assert the route panel; refresh
`doc/` screenshots.

## Estimates to confirm on the first generated window

Grid ≈ 100–250 KB gz, routes ≈ 100–300 KB, a few thousand plan queries (seconds), 1–2 min per window,
~1 h for all 48; repo total 10–20 MB.
