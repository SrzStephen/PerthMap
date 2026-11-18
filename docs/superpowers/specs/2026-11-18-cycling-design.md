# Cycling travel times + ride routes — design

Date: 2026-11-18 · Status: approved in brainstorming, pending spec review

## Goal

Add a **Bike** mode beside the existing public-transport map: shade everywhere you can ride to the Perth CBD
within the selected minutes, at a speed the user picks, and let a click show the ride's street path, distance and
elevation profile. The site stays fully static; everything is precomputed with the same MOTIS instance.

### Success criteria

- A **Transit / Bike** toggle. Bike mode replaces day/hour with a **speed** choice: 12 · 15 · 20 · 25 km/h
  (default 15); the minutes slider and legend are shared.
- Bike bands come from one time-independent grid and rescale exactly with speed (no regeneration per speed).
- Clicking a point in Bike mode shows ride time and distance at the chosen speed, the real street path, and an
  elevation profile with total climb/descent.
- Switching back to Transit restores the previous day/hour; transit behaviour is unchanged.
- Extra data ≲ 3 MB in the repo; Bike assets are fetched only when Bike is first selected / first clicked.

### Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| What "cycling" means | Ride the whole way (no bike + transit) |
| Route on click | Real path, precomputed per ~500 m block; clicks snap to their block's path |
| Speed | User-selectable presets; grid stores reference-speed seconds (≡ distance) and the client rescales |
| Elevation | Profile only (informational); hills do **not** change ride times |
| Elevation source | SRTM tiles from the AWS Open Data terrain tiles (`skadi`), median-filtered, bridges interpolated |

### Verified in brainstorming (MOTIS 2.11.4, current index)

- BIKE `one-to-many` returns durations only; they equal `/api/v5/plan` direct BIKE leg durations to the second.
- Bike speed is constant: three rides (Murdoch, Wembley, Joondalup) gave 15.07–15.11 km/h, so
  `distance = duration × refSpeed`. The pipeline measures `refSpeedKmh` from plan `distance / duration` rather
  than hard-coding it.
- Direct street routing is capped at `street_routing_max_direct_seconds: 7200` (≈ 30 km at 15 km/h); the grid's
  corners are ~40 km from the CBD.
- Plan legs carry `steps`, each with a `polyline` and `toOsmNode`; no elevation is returned (no DEM loaded).
- SRTM tiles S32E115, S33E115, S32E116, S33E116 are downloadable without auth (3–10 MB gz each).

### Out of scope

Bike + transit, hill- or traffic-light-aware ride times (MOTIS `elevationCosts`), depart-at, shareable URLs,
hover-linking the profile to the map, a LiDAR DEM.

## 1. Pipeline (`data_gen/pipeline.py`)

**Config.** `prepare` writes `street_routing_max_direct_seconds: 10800` (45 km at 15 km/h) and downloads the four
SRTM tiles to `data/input/srtm/` (skipped if present). Bike routing is time-independent, so it needs no
re-import beyond the config change; the existing index is reused.

**New `bike` stage** (`docker compose run --rm route bike`), independent of `route`:

1. **Grid times.** The same grid and walkable mask as `route` (`make_grid`, `walkable`, `--snap 100`). Batched
   `POST /api/v1/one-to-many` with `mode: BIKE`, `arriveBy: true`, `one` = CBD, `many` = cells in chunks below
   `onetomany_max_many`, `max: 10800`. Result: seconds per cell (NaN = unreachable).
2. **Representative cells.** Partition the grid into blocks of `--bike-block 5` × 5 cells (~500 m). In each block
   with any reachable cell, pick the reachable cell nearest the block centre. Every cell in a block points at its
   block's representative; blocks with no reachable cell get none.
3. **Paths.** One `/api/v5/plan` per representative: `fromPlace` = cell, `toPlace` = CBD, `directModes=BIKE`,
   `transitModes=` (empty), `maxDirectTime=10800`. Keep `direct[0].legs[0]`: `duration`, `distance`, `steps`.
   `refSpeedKmh` = median of `distance / duration × 3.6` over all plans.
4. **Segments.** Each step is a segment keyed by `(previous step's toOsmNode, toOsmNode)` (the first step of a path
   has no previous node and is keyed by `(None, toOsmNode, start cell)`, i.e. never shared). Identical keys are
   stored once, so rides converging on the city share their common streets. A path is its ordered list of segment
   ids. Segment geometry is simplified to ~5 m and encoded (precision 5), as for transit shapes.
5. **Elevation.**
   - *Raster.* Load the SRTM tiles (`.hgt`: big-endian `int16`, square, row 0 = north, −32768 = void) into one
     array covering the grid bbox; fill voids from the mean of valid 3×3 neighbours; apply a 5×5 median filter
     (numpy `sliding_window_view`, ~150 m) to remove single-pixel spikes from trees and buildings.
   - *Sampling.* Per path (unsimplified geometry, all its steps concatenated), sample every 50 m by bilinear
     interpolation, always including each segment's end vertex. Samples inside `water.parquet` polygons (bridges:
     SRTM records the water surface) are replaced by linear interpolation between the nearest land samples
     before and after along the path.
   - *Storage.* A segment's heights are taken from the first path that registers it and reused by later paths
     (its samples are the path's samples from the segment's start to its end vertex). Metres, rounded to integers.
   - *Totals.* Per path, ascent/descent from the concatenated profile with 2 m hysteresis (wiggles under 2 m
     ignored).
6. **Consistency.** Share of representatives whose plan duration differs from their own grid seconds by > 120 s;
   logged, written to `index.json`, warning above 5 %. A representative with no plan is recorded as missing; the
   run continues. Zero reachable cells fails the run.

**Size target.** Measure `bike.routes.json` gzipped on the first run. If it exceeds 2 MB, apply a tree encoding:
store `next` per segment where every path through it continues identically, and cut path lists at the first such
segment. Not built unless needed.

## 2. Data format (`public/data/`)

| File | Content | Loaded |
|---|---|---|
| `index.json` | gains `bike: {refSpeedKmh, mismatchRate, missingRate}` (absent = no bike data; the toggle is hidden) | startup |
| `bike.grid.bin` | gzip of `"PMB1"`, `u16` version, `u32` width, `u32` height (LE), then planes `seconds: u16` (`0xFFFF` = unreachable) and `path: u16` (`0xFFFF` = none). Row 0 = south. Width/height must equal `index.json.grid`. | Bike first selected |
| `bike.routes.json` | `{refSpeedKmh, shapes: ["<polyline>", …], elev: [[h0, Δ1, Δ2, …], …], paths: [[seconds, metres, ascent, descent, [segment…]], …]}`; `shapes[i]` and `elev[i]` describe segment `i`; `elev` is metres at 50 m spacing (last gap shorter), first value absolute, the rest deltas | first Bike click |

Seconds are at `refSpeedKmh`. A cell's distance is `seconds × refSpeedKmh / 3.6` metres.

## 3. Web

**`src/lib/bike.ts` (new)**
- `loadBike(index)`: fetch + `DecompressionStream('gzip')` + magic/version/size validation → `{seconds:
  Uint16Array, path: Uint16Array}`. Cached promise; `evictBike()` for Retry.
- `bikeMinutes(bike, speedKmh, refSpeedKmh): Grid`: per cell `round(seconds × refSpeedKmh / speedKmh / 60)`,
  clamped to 254, `0xFFFF` → 255 (`UNREACHABLE`). Returns a `Grid`-shaped object (only `median` and `fastest`
  are meaningful) so `buildBands`, the worker and `TravelTimeMap` are unchanged.
- `loadBikeRoutes()`, `bikeRideAt(bike, routes, lat, lng, speed)` → `{kind: 'outside' | 'unreachable' |
  'missing' | 'ride', minutes, metres, path?}` with path geometry, profile and ascent/descent decoded.

**`useWindowData`** — generalised to a `view`: `{mode: 'transit', day, hour}` or `{mode: 'bike', speed}`. Keys
`weekday-08` and `bike@15`; band cache per key. Existing behaviour holds: previous bands stay while loading,
spinner, Retry evicts.

**`ControlCard`** — a Transit / Bike segmented control at the top (same style as `DayToggle`). In Bike mode the
day toggle and hour slider are replaced by a speed segmented control `12 · 15 · 20 · 25 km/h`, subtitled
"leisurely · commuter · fit · e-bike". App keeps day/hour state while in Bike mode.

**Click (Bike mode)** — `useClickedRoute` dispatches on mode. Time and distance come from the **clicked cell's**
own grid value; geometry and profile come from its block's representative path.

Overlay (`RouteOverlay`): pin at the click; dashed connector to the path's start; the path in `MODE_COLORS.BIKE`
(green, `#16a34a`); CBD marker.

Panel (`RoutePanel`, bike variant):

```
Ride 34 min · 11.2 km at 15 km/h       ✕
[ elevation profile, ~280×64 inline SVG area chart, distance on x ]
↑ 85 m  ↓ 40 m
```

The profile is a plain SVG path (no chart library), y-axis labelled min/max metres, scaled to the path's own
range with a 20 m minimum span so flat rides read as flat. Changing speed re-resolves the open panel. Messages:
outside → "Outside the mapped area"; unreachable → "No bike route within 3 h"; missing path → time and distance
plus "Route details unavailable".

## 4. Errors and testing

**Errors** — Bike grid load/decode failure: keep the previous bands, inline message + Retry. Header mismatch: error,
nothing drawn. `index.json` without `bike`: toggle hidden. SRTM tile missing for part of a path: profile omitted
for that segment's path (panel shows time, distance, map path only); the run logs the count.

**Pipeline (pytest, MOTIS mocked)** — bike grid encode/decode round-trip incl. sentinels; representative choice
(nearest reachable to centre, empty blocks); segment keying and sharing (two paths with a common suffix share
segments, first steps never shared); HGT bilinear sampling on a synthetic tile incl. void fill; median filter
removes a spike; water samples interpolated across a synthetic river; ascent/descent with hysteresis; `refSpeedKmh` from plans;
mismatch rate.

**Web (vitest)** — bike decode and header validation; `bikeMinutes` scaling, rounding, clamping and sentinel;
`bikeRideAt` for outside / unreachable / missing / ride; elevation delta decoding; mode toggle and speed control
(day/hour restored); bike `RoutePanel` incl. profile rendering and the flat-ride minimum span.

**E2E (`scripts/e2e-route.py`)** — switch to Bike, choose 25 km/h, click a Joondalup point, assert the ride panel
and profile; add a `doc/bike.png` screenshot and a README section.

## Estimates to confirm on the first run

~150k reachable cells → ~2 one-to-many calls of ≤ 100k; ~5k plan queries (minutes); `bike.grid.bin` ≈ 150–250
KB gz; `bike.routes.json` ≈ 1–2 MB gz; stage runtime ≲ 15 min.
