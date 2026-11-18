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
| `index.json` | grid size/origin/spacing, days with their dates, hours, per-window mismatch rate |
| `water.json` | simplified water + sea polygons (GeoJSON) the web app clips bands with |
| `stops.json` | `[[name, lat, lon], …]` — every GTFS stop, sorted by `stop_id`; the index is the stop number |
| `{day}-{HH}.grid.bin.gz` | gzip of `"PMG1"`, `u16` version, `u32` width, `u32` height (little-endian), then per cell: median, fastest, sample, walk minutes (`u8`, 255 = n/a) and stop number (`u16`, `0xFFFF` none, `0xFFFE` walk directly). Row 0 is the south edge. |
| `{day}-{HH}.routes.json` | sample times, deduplicated leg polylines (precision 6), and trips keyed `"<stop>:<sample>"` |

The run warns when more than 5 % of cells' planned trip differs from the grid time by over 5 minutes.

### Accuracy guards
- **Walkable grid only.** Grid points further than `--walkable-within` (75 m) from a walkable OSM way are dropped
  before routing. MOTIS snaps far-off points (e.g. mid-river) to the nearest path without charging for the
  distance, which used to give river cells the travel time of the bank.
- **Clipped to land.** The web app cuts bands by `water.json`, so no colour is painted over water.

To rebuild just the masks on an existing setup: `docker compose run --rm --no-deps route masks --force`.

Tests: `cd data/ && uv run --group dev pytest ../tests -q`.
Options: `docker compose run --rm route route --help` (`--days`, `--hours`, `--spacing`, `--max-walk`, …).
