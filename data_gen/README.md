# About
Generates the travel-time isochrones (`poly.json`) shown on the map, using the
[MOTIS](https://github.com/motis-project/motis) public-transport router, all in Docker.

# How
```sh
cd data_gen
docker compose up --build route      # prepare -> MOTIS import -> MOTIS server -> route
docker compose run --rm isochrones   # grid travel times -> isochrone polygons
cp data/results/poly.json ../src/assets/poly.json
docker compose down
```

| Stage | Container | What it does |
|---|---|---|
| `prepare` | pipeline | Crops the Geofabrik Australia extract to Perth with `osmium`, downloads the current Transperth GTFS, writes `data/motis/config.yml`, then runs `masks` |
| `masks` | pipeline | Extracts walkable ways and water areas (lakes, rivers, and the sea from the coastline) → `data/input/walkways.parquet`, `water.parquet` |
| `motis-import` | `ghcr.io/motis-project/motis` | Builds the street + timetable index in `data/motis/index` |
| `motis` | `ghcr.io/motis-project/motis` | Serves the API (and a web UI at http://localhost:8080 for spot checks) |
| `route` | pipeline | Computes a travel time for every grid point (see below) → `data/results/grid_travel_times.csv` |
| `isochrones` | pipeline | Bands every 5 min from 15–85 min built from the grid cells themselves, clipped to land → `data/results/poly.json` |

Drop an existing `australia-latest.osm.pbf` into `data/input/` to skip the ~900 MB download.

## How travel times are computed
Rather than planning one journey per grid point, `route` does:

1. **Transit leg** – one MOTIS `one-to-all` *arrive-by* search from the destination per
   arrival time (08:00–09:00 every 5 min, on the next Wednesday by default). This gives, for every
   stop, how long before the arrival time you need to leave it.
2. **Walking leg** – one batched `one-to-many` walking query per reachable stop to the grid
   points around it (max 15 min walk).
3. **Combine** – each grid point takes the best stop (walk + transit), or walking directly, per
   arrival time; the map uses the median across the window (`PERCENTILE=90 docker compose up route`
   for a pessimistic "reliably on time" map).

### Accuracy guards
- **Walkable grid only.** Grid points further than `--walkable-within` (75 m) from a walkable OSM way are dropped
  before routing. MOTIS snaps far-off points (e.g. mid-river) to the nearest path without charging for the
  distance, which used to give river cells the travel time of the bank.
- **No hulls.** Each band is the union of its grid cells (1-cell gaps closed, holes under `--min-hole` cells
  filled, edges rounded), so separate station catchments stay separate instead of being bridged.
- **Clipped to land.** Bands are cut by OSM water and the sea, so no colour is painted over water.

To rebuild just the masks on an existing setup: `docker compose run --rm --no-deps route masks --force`.

Useful options: `docker compose run --rm route route --help`
(`--date`, `--arrive-from`, `--window`, `--spacing`, `--max-walk`, …).
