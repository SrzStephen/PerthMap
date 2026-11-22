# About
Generates the travel-time data shown on the map (`public/data/`), using the
[MOTIS](https://github.com/motis-project/motis) public-transport router, all in Docker.

# How
```sh
cd data_gen
docker compose up --build route      # prepare -> MOTIS import -> MOTIS server -> route (~1 h for all windows)
cp -r data/results/web/. ../public/data/
docker compose down
```

| Stage | Container | What it does |
|---|---|---|
| `prepare` | pipeline | Crops the Geofabrik Australia extract to Perth with `osmium`, downloads the current Transperth GTFS, writes `data/motis/config.yml`, then runs `masks` |
| `masks` | pipeline | Extracts walkable ways and water areas (lakes, rivers, and the sea from the coastline) → `data/input/walkways.parquet`, `water.parquet` |
| `motis-import` | `ghcr.io/motis-project/motis` | Builds the street + timetable index in `data/motis/index` |
| `motis` | `ghcr.io/motis-project/motis` | Serves the API (and a web UI at http://localhost:8080 for spot checks) |
| `route` | pipeline | Travel times and fastest routes for every window → `data/results/web/` |

Drop an existing `australia-latest.osm.pbf` into `data/input/` to skip the ~900 MB download.

## Windows
Three service days — the next **Wednesday** (labelled *Weekday*), **Saturday** and **Sunday** — each with 16
one-hour *arrive-by* windows, 06:00–07:00 … 21:00–22:00. Window `HH` samples arrivals at `HH:00, HH:05 … HH:55`.
Limit a run with `--days weekday --hours 7-9`; `index.json` keeps the mismatch rates of windows from earlier runs.

## How travel times are computed
Rather than planning one journey per grid point, `route` does:

1. **Transit leg** – one MOTIS `one-to-all` arrive-by search from the destination per arrival sample. This gives,
   for every stop, how long before the arrival time you need to leave it.
2. **Walking leg** – one batched `one-to-many` walking query per reachable stop to the walkable grid points
   around it (max 15 min walk). Time-independent, so computed once for all windows.
3. **Combine** – each grid point takes the best stop (walk + transit), or walking directly, per sample, keeping
   which stop won. The map colour is the **median** over the window's samples; the route panel shows the
   **fastest** sample.
4. **Itineraries** – one `/api/v5/plan` arrive-by journey from each (stop, sample) the grid uses. MOTIS returns
   several journeys; the one leaving latest while still arriving on time is kept, matching step 1.

## Output (`data/results/web/` → `public/data/`)
| File | Content |
|---|---|
| `index.json` | grid size/origin/spacing, days with their dates, hours, per-window mismatch rate (`null` = nothing to compare) and missing-trip rate |
| `water.json` | simplified water + sea polygons (GeoJSON) the web app clips bands with |
| `stops.json` | `[[name, lat, lon], …]` — every GTFS stop, sorted by `stop_id`; the index is the stop number |
| `{day}-{HH}.grid.bin` | gzip of `"PMG1"`, `u16` version, `u32` width, `u32` height (little-endian), then per cell: median, fastest, sample, walk minutes (`u8`, 255 = n/a) and stop number (`u16`, `0xFFFF` none, `0xFFFE` walk directly). Row 0 is the south edge. |
| `{day}-{HH}.routes.json` | `{samples, lines, shapes, trips}`: `lines` = `[mode, line, headsign]`; `shapes` = encoded polylines (precision 5, ~5 m simplified) shared by legs; `trips["<stop>:<sample>"]` = `[depart, arrive, legs]` with times in minutes since midnight (Perth) and each leg `[line, from stop, to stop, depart, arrive, shape, i0, i1]` (stop `-1` = not a GTFS stop; geometry = shape vertices `i0..i1`) |

The run warns when more than 5 % of cells' planned trip differs from the grid time by over 5 minutes.

### Accuracy guards
- **Walkable grid only.** Grid points further than `--walkable-within` (75 m) from a walkable OSM way are dropped
  before routing. MOTIS snaps far-off points (e.g. mid-river) to the nearest path without charging for the
  distance, which used to give river cells the travel time of the bank.
- **Clipped to land.** The web app cuts bands by `water.json`, so no colour is painted over water.

To rebuild just the masks on an existing setup: `docker compose run --rm --no-deps route masks --force`.

## Bike
```sh
docker compose run --rm route bike   # after `route` (it adds to index.json); ~15 min
```
Time-independent, so one grid for all days. `prepare` also downloads four SRTM elevation tiles
([AWS Open Data terrain tiles](https://registry.opendata.aws/terrain-tiles/), no login) to `data/input/srtm/`
and lets MOTIS serve direct rides of up to 3 h (`street_routing_max_direct_seconds: 10800`).

1. **Ride times** – batched BIKE `one-to-many` queries from the walkable grid points to work. MOTIS rides at a
   constant speed (~15 km/h), so the time is the distance in disguise and the web app rescales it to any speed.
2. **Paths** – one direct BIKE `/api/v5/plan` per 5×5-cell block (~500 m), from its reachable point nearest the
   centre; every cell in the block shows that path. Each MOTIS step is a segment keyed by its OSM nodes, so streets
   shared by many rides are stored once.
3. **Elevation** – heights every 50 m along each segment from the SRTM tiles, which measure the surface, not the
   ground: voids are filled, a 9×9 (~270 m) opening removes towers and trees, a 5×5 median removes what spikes are
   left, and samples over water — bridges — are interpolated from the banks. Climb and descent are summed between
   turning points that reverse by at least 5 m.

| File | Content |
|---|---|
| `bike.grid.bin` | gzip of `"PMB1"`, `u16` version, `u32` width, `u32` height (little-endian), then per cell `u16` ride seconds at `refSpeedKmh` (`0xFFFF` unreachable) and `u16` path index (`0xFFFF` none). Row 0 is the south edge. |
| `bike.routes.json` | `{refSpeedKmh, shapes, lengths, elev, paths}`: per segment an encoded polyline (precision 5), its length in metres and its heights `[h0, Δ…]` every 50 m (last gap shorter; `null` = no data); `paths` = `[seconds, metres, ascent, descent, [segment…]]` |
| `index.json` | gains `bike: {refSpeedKmh, mismatchRate, missingRate}` |

Tests: `cd data/ && uv run --group dev pytest ../tests -q`.
Options: `docker compose run --rm route route --help` (`--days`, `--hours`, `--spacing`, `--max-walk`, …).
