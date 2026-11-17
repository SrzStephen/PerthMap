"""PerthMap data pipeline: public-transport travel times to one destination via MOTIS.

Stages (run in order by docker compose, or individually):

  prepare     crop OSM to Perth, download the current Transperth GTFS, write MOTIS config.yml,
              then build the masks below
  masks       extract walkable paths and water areas from the Perth OSM extract
  route       query a running MOTIS server and compute a travel time for every grid point
  isochrones  turn grid travel times into the polygons the web app renders (poly.json)

How `route` works (two cheap passes instead of ~200k individual journey plans):

  1. Transit leg: one `/api/v6/one-to-all` arrive-by query from the destination per
     arrival time in the window. That gives, for every reachable stop, how long before
     the arrival time you must leave that stop.
  2. Access leg: one batched `/api/v1/one-to-many` WALK query per reachable stop to the
     grid points around it (independent of time, so done once).
  3. Combine: time(grid, T) = min(direct walk, min_stop walk(grid, stop) + transit(stop, T)),
     then summarise across arrival times with a percentile.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import struct
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests
from scipy.spatial import cKDTree
from tqdm import tqdm

PERTH = ZoneInfo("Australia/Perth")
DATA = Path(os.environ.get("DATA_DIR", "/data"))
INPUT = DATA / "input"
MOTIS_DIR = DATA / "motis"
RESULTS = DATA / "results"
WALKWAYS = INPUT / "walkways.parquet"
WATER = INPUT / "water.parquet"
METRIC_CRS = "EPSG:32750"  # WGS 84 / UTM 50S - metres around Perth

GEOFABRIK_AU = "https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf"
TRANSPERTH_GTFS = "https://www.transperth.wa.gov.au/TimetablePDFs/GoogleTransit/Production/google_transit.zip"


@dataclass(frozen=True)
class BBox:
    min_lon: float
    min_lat: float
    max_lon: float
    max_lat: float

    def padded(self, deg: float) -> "BBox":
        return BBox(self.min_lon - deg, self.min_lat - deg, self.max_lon + deg, self.max_lat + deg)

    @property
    def osmium(self) -> str:
        return f"{self.min_lon},{self.min_lat},{self.max_lon},{self.max_lat}"


# Same area and destination as the original R5 notebook.
GRID_BBOX = BBox(115.679169, -32.301063, 116.060099, -31.725200)
WORK = (-31.955612, 115.860234)  # lat, lon


def log(msg: str) -> None:
    print(f"[{datetime.now(PERTH):%H:%M:%S}] {msg}", flush=True)


def env_float(name: str, default: float) -> float:
    return float(os.environ.get(name, default))


# --------------------------------------------------------------------------- prepare
def download(url: str, dest: Path) -> None:
    log(f"downloading {url} -> {dest}")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0)) or None
        with open(tmp, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, disable=not sys.stderr.isatty()) as bar:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                bar.update(len(chunk))
    tmp.rename(dest)


def prepare(args: argparse.Namespace) -> None:
    INPUT.mkdir(parents=True, exist_ok=True)
    MOTIS_DIR.mkdir(parents=True, exist_ok=True)

    # OSM: crop the Australia extract to Perth (MOTIS imports the whole file otherwise).
    perth_osm = INPUT / "perth.osm.pbf"
    if not perth_osm.exists() or args.force:
        au = INPUT / "australia-latest.osm.pbf"
        if not au.exists():
            download(GEOFABRIK_AU, au)
        log("cropping OSM to Perth")
        subprocess.run(
            ["osmium", "extract", "--overwrite", "-s", "smart", "-b", GRID_BBOX.padded(0.05).osmium,
             str(au), "-o", str(perth_osm)],
            check=True,
        )

    # GTFS: always refresh unless told not to - stale feeds silently produce empty results.
    gtfs = INPUT / "transperth_gtfs.zip"
    if not gtfs.exists() or not args.keep_gtfs:
        download(TRANSPERTH_GTFS, gtfs)

    config = f"""\
server:
  port: 8080
  web_folder: /ui
  n_threads: {os.cpu_count() or 8}
osm: {perth_osm}
timetable:
  first_day: TODAY
  num_days: 60
  datasets:
    transperth:
      path: {gtfs}
street_routing: true
osr_footpath: true
geocoding: false
reverse_geocoding: false
limits:
  onetomany_max_many: 100000
  onetoall_max_results: 100000
  onetoall_max_travel_minutes: 240
  street_routing_max_prepost_transit_seconds: 3600
  street_routing_max_direct_seconds: 7200
"""
    (MOTIS_DIR / "config.yml").write_text(config)
    log(f"wrote {MOTIS_DIR / 'config.yml'}")
    masks(args)


# --------------------------------------------------------------------------- masks
# Ways a pedestrian can't use (or that aren't built yet). Ferries are routes, not highways, so excluded anyway.
NOT_WALKABLE = {"motorway", "motorway_link", "construction", "proposed", "abandoned", "disused",
                "raceway", "bus_guideway", "razed"}
FOOT_OK = {"yes", "designated", "permissive"}


def osm_layer(src: Path, filters: list[str], geometry: str, name: str):
    """osmium tags-filter + export -> GeoDataFrame (EPSG:4326)."""
    import geopandas as gpd

    tmp = INPUT / f"{name}.osm.pbf"
    seq = INPUT / f"{name}.geojsonseq"
    subprocess.run(["osmium", "tags-filter", "--overwrite", str(src), *filters, "-o", str(tmp)], check=True)
    subprocess.run(["osmium", "export", "--overwrite", "-f", "geojsonseq", f"--geometry-types={geometry}",
                    str(tmp), "-o", str(seq)], check=True)
    gdf = gpd.read_file(seq, driver="GeoJSONSeq")
    tmp.unlink()
    seq.unlink()
    return gdf.set_crs("EPSG:4326", allow_override=True)


def masks(args: argparse.Namespace) -> None:
    """Walkable paths (grid points must be near one) and water areas (isochrones are clipped by them)."""
    src = INPUT / "perth.osm.pbf"
    if WALKWAYS.exists() and WATER.exists() and not getattr(args, "force", False):
        log(f"masks exist ({WALKWAYS.name}, {WATER.name}); use --force to rebuild")
        return

    log("extracting walkable ways")
    ways = osm_layer(src, ["w/highway"], "linestring", "walkways")
    col = lambda k: ways[k] if k in ways else None  # noqa: E731
    foot, access = col("foot"), col("access")
    keep = ~ways["highway"].isin(NOT_WALKABLE)
    if foot is not None:
        keep &= ~foot.isin({"no", "private"})
    if access is not None:
        keep &= ~(access.isin({"no", "private"}) & ~(foot.isin(FOOT_OK) if foot is not None else False))
    ways = ways.loc[keep, ["highway", "geometry"]]
    ways.to_parquet(WALKWAYS)
    log(f"{len(ways):,} walkable ways -> {WALKWAYS}")

    log("extracting water areas")
    water = osm_layer(src, ["nwr/natural=water", "nwr/waterway=riverbank", "nwr/natural=bay"], "polygon", "water")
    water = water[water.geom_type.isin(["Polygon", "MultiPolygon"])][["geometry"]]
    ocean = ocean_polygons(src)
    log(f"{len(ocean):,} ocean polygons from the coastline")
    water = pd.concat([water, ocean], ignore_index=True)
    water.to_parquet(WATER)
    log(f"{len(water):,} water polygons -> {WATER}")


def sea_pieces(frame, coast, offset: float = 1.0) -> list:
    """Cut `frame` with coastline lines and keep the pieces on their right (OSM: land left, sea right).

    Each piece takes the majority of probe points placed `offset` right vs left of every segment."""
    from shapely import LineString, Point, STRtree, polygonize, unary_union

    # unclipped lines so they genuinely cross the frame (clipped ends sit a hair off it and dangle)
    pieces = [p for p in polygonize([unary_union([*coast, frame.boundary])]).geoms
              if frame.contains(p.representative_point())]
    right, left = [], []
    for line in coast:
        c = np.asarray(LineString(line).coords)
        mid, d = (c[:-1] + c[1:]) / 2, c[1:] - c[:-1]
        n = offset * np.column_stack([d[:, 1], -d[:, 0]]) / np.maximum(np.hypot(*d.T), 1e-9)[:, None]
        right.extend(Point(p) for p in mid + n)
        left.extend(Point(p) for p in mid - n)
    tree = STRtree(pieces)

    def votes(pts):
        return np.bincount(tree.query(pts, predicate="within")[1], minlength=len(pieces))

    keep = votes(right) > votes(left)
    return [p for p, k in zip(pieces, keep) if k]


def ocean_polygons(src: Path):
    """Sea inside the padded grid bbox, from the OSM coastline."""
    import geopandas as gpd
    from shapely import box

    coast = osm_layer(src, ["w/natural=coastline"], "linestring", "coast").to_crs(METRIC_CRS)
    pb = GRID_BBOX.padded(0.02)
    frame = gpd.GeoSeries([box(pb.min_lon, pb.min_lat, pb.max_lon, pb.max_lat)], crs="EPSG:4326").to_crs(METRIC_CRS)[0]
    sea = sea_pieces(frame, list(coast.geometry.values))
    return gpd.GeoDataFrame(geometry=sea, crs=METRIC_CRS).to_crs("EPSG:4326")[["geometry"]]


def walkable(grid: pd.DataFrame, max_m: float) -> np.ndarray:
    """Boolean mask: grid points within `max_m` of a walkable way."""
    import geopandas as gpd

    ways = gpd.read_parquet(WALKWAYS).to_crs(METRIC_CRS)
    pts = gpd.GeoSeries(gpd.points_from_xy(grid.lon, grid.lat), crs="EPSG:4326").to_crs(METRIC_CRS)
    hit, _ = ways.sindex.query(pts.values, predicate="dwithin", distance=max_m)
    mask = np.zeros(len(grid), dtype=bool)
    mask[np.unique(hit)] = True
    return mask


# --------------------------------------------------------------------------- route
def default_travel_date() -> date:
    """Next Wednesday in Perth time (a 'typical' weekday that is inside the GTFS validity)."""
    today = datetime.now(PERTH).date()
    return today + timedelta(days=(2 - today.weekday()) % 7 or 7)


NONE, DIRECT = -1, -2  # Combined.stop / Summary.stop sentinels: unreachable, walk straight to work


@dataclass(frozen=True)
class Combined:
    """Per (sample, cell): best total minutes, winning stop row (or NONE/DIRECT) and its walk minutes."""
    total: np.ndarray
    stop: np.ndarray
    walk: np.ndarray


@dataclass(frozen=True)
class Summary:
    """Per cell: median and fastest total over samples, plus the fastest sample's stop and walk."""
    median: np.ndarray
    fastest: np.ndarray
    sample: np.ndarray
    stop: np.ndarray
    walk: np.ndarray


def combine(n_cells: int, g_idx: np.ndarray, g_stop: np.ndarray, g_walk: np.ndarray,
            stop_minutes: np.ndarray, w_idx: np.ndarray, w_min: np.ndarray) -> Combined:
    """time(cell, t) = min(direct walk, min_stop walk(cell, stop) + transit(stop, t)), keeping the argmin."""
    n_t = stop_minutes.shape[1]
    total = np.full((n_t, n_cells), np.nan)
    stop = np.full((n_t, n_cells), NONE, dtype=np.int32)
    walk = np.full((n_t, n_cells), np.nan)
    w_ok = ~np.isnan(w_min)
    w_idx, w_min = np.asarray(w_idx)[w_ok], np.asarray(w_min)[w_ok]
    for j in range(n_t):
        t = g_walk + stop_minutes[g_stop, j]
        ok = ~np.isnan(t)
        ci, si, wi, ti = g_idx[ok], g_stop[ok], g_walk[ok], t[ok]
        order = np.lexsort((ti, ci))
        cells, first = np.unique(ci[order], return_index=True)
        pick = order[first]
        total[j, cells], stop[j, cells], walk[j, cells] = ti[pick], si[pick], wi[pick]
        better = np.isnan(total[j, w_idx]) | (w_min < total[j, w_idx])
        cells = w_idx[better]
        total[j, cells], stop[j, cells], walk[j, cells] = w_min[better], DIRECT, w_min[better]
    return Combined(total, stop, walk)


def summarise(c: Combined) -> Summary:
    n_cells = c.total.shape[1]
    reach = ~np.all(np.isnan(c.total), axis=0)
    median = np.full(n_cells, np.nan)
    fastest = np.full(n_cells, np.nan)
    sample = np.full(n_cells, -1, dtype=np.int16)
    stop = np.full(n_cells, NONE, dtype=np.int32)
    walk = np.full(n_cells, np.nan)
    sub = c.total[:, reach]
    median[reach] = np.nanmedian(sub, axis=0)
    best = np.nanargmin(sub, axis=0)
    cols = np.flatnonzero(reach)
    fastest[reach] = sub[best, np.arange(len(cols))]
    sample[reach] = best
    stop[reach] = c.stop[best, cols]
    walk[reach] = c.walk[best, cols]
    return Summary(median, fastest, sample, stop, walk)


@dataclass(frozen=True)
class GridMeta:
    width: int
    height: int
    min_lon: float
    min_lat: float
    spacing: float


def grid_meta(spacing: float) -> GridMeta:
    """Shape of the `make_grid` lattice (row 0 = south)."""
    return GridMeta(len(np.arange(GRID_BBOX.min_lon, GRID_BBOX.max_lon, spacing)),
                    len(np.arange(GRID_BBOX.min_lat, GRID_BBOX.max_lat, spacing)),
                    GRID_BBOX.min_lon, GRID_BBOX.min_lat, spacing)


def cell_of(meta: GridMeta, lat, lon):
    """Flat cell index (iy * width + ix) for coordinates on the lattice."""
    ix = np.rint((np.asarray(lon) - meta.min_lon) / meta.spacing).astype(np.int64)
    iy = np.rint((np.asarray(lat) - meta.min_lat) / meta.spacing).astype(np.int64)
    return iy * meta.width + ix


GRID_MAGIC, GRID_VERSION = b"PMG1", 1
U8_NA, STOP_NONE, STOP_DIRECT = 255, 0xFFFF, 0xFFFE


def _u8(values: np.ndarray) -> np.ndarray:
    out = np.full(values.shape, U8_NA, dtype=np.uint8)
    ok = ~np.isnan(values)
    out[ok] = np.clip(np.floor(values[ok] + 0.5), 0, 254)
    return out


def encode_grid(s: Summary, cells: np.ndarray, meta: GridMeta, stop_index: np.ndarray) -> bytes:
    """Gzipped header + planes (median, fastest, sample, walk: u8; stop: u16 LE) over the full lattice."""
    n = meta.width * meta.height
    planes = {k: np.full(n, U8_NA, dtype=np.uint8) for k in ("median", "fastest", "sample", "walk")}
    planes["median"][cells] = _u8(s.median.astype(float))
    planes["fastest"][cells] = _u8(s.fastest.astype(float))
    planes["walk"][cells] = _u8(s.walk.astype(float))
    sample = s.sample.astype(np.int64)
    planes["sample"][cells] = np.where(sample >= 0, sample, U8_NA).astype(np.uint8)
    stop = np.full(n, STOP_NONE, dtype="<u2")
    rows = s.stop.astype(np.int64)
    stop[cells] = np.where(rows >= 0, stop_index[np.clip(rows, 0, None)],
                           np.where(rows == DIRECT, STOP_DIRECT, STOP_NONE))
    header = struct.pack("<4sHII", GRID_MAGIC, GRID_VERSION, meta.width, meta.height)
    body = b"".join(planes[k].tobytes() for k in ("median", "fastest", "sample", "walk")) + stop.tobytes()
    return gzip.compress(header + body, 9)


def decode_grid(b: bytes) -> dict[str, np.ndarray]:
    raw = gzip.decompress(b)
    magic, version, w, h = struct.unpack("<4sHII", raw[:14])
    assert magic == GRID_MAGIC and version == GRID_VERSION
    n, o = w * h, 14
    out = {}
    for k in ("median", "fastest", "sample", "walk"):
        out[k] = np.frombuffer(raw, np.uint8, n, o)
        o += n
    out["stop"] = np.frombuffer(raw, "<u2", n, o)
    return out


def load_stops(gtfs_zip: Path) -> tuple[pd.DataFrame, dict[str, int]]:
    """GTFS stops sorted by stop_id (string); MOTIS id `transperth_<stop_id>` -> row index."""
    with zipfile.ZipFile(gtfs_zip) as z, z.open("stops.txt") as f:
        df = pd.read_csv(f, dtype={"stop_id": str}, usecols=["stop_id", "stop_name", "stop_lat", "stop_lon"])
    df = df.sort_values("stop_id", kind="stable").reset_index(drop=True)
    return df, {f"transperth_{sid}": i for i, sid in enumerate(df["stop_id"])}


def _utc(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _hhmm(ts: str) -> str:
    return _utc(ts).astimezone(PERTH).strftime("%H:%M")


def best_itinerary(resp: dict, arrive: datetime) -> dict | None:
    """Latest-departing itinerary that still arrives by `arrive` (fewest transfers on ties).

    MOTIS returns several itineraries regardless of numItineraries; leaving as late as possible matches
    the one-to-all arrive-by duration used for the grid."""
    ok = [it for it in resp.get("itineraries", []) if _utc(it["endTime"]) <= arrive]
    if not ok:
        return None
    return max(ok, key=lambda it: (_utc(it["startTime"]), -it.get("transfers", 0)))


class PathTable:
    """Deduplicated encoded polylines; legs refer to them by index."""

    def __init__(self) -> None:
        self.items: list[str] = []
        self._index: dict[str, int] = {}

    def add(self, points: str) -> int:
        if points not in self._index:
            self._index[points] = len(self.items)
            self.items.append(points)
        return self._index[points]


def trip_from_plan(it: dict, stop_ids: dict[str, int], paths: PathTable) -> dict:
    legs = [{
        "mode": l["mode"],
        "line": l.get("displayName") or "",
        "headsign": l.get("headsign") or "",
        "from": stop_ids.get(l["from"].get("stopId") or "", -1),
        "to": stop_ids.get(l["to"].get("stopId") or "", -1),
        "depart": _hhmm(l["startTime"]),
        "arrive": _hhmm(l["endTime"]),
        "path": paths.add(l["legGeometry"]["points"]),
    } for l in it["legs"]]
    return {"depart": _hhmm(it["startTime"]), "arrive": _hhmm(it["endTime"]), "legs": legs}


def build_routes(pairs, plan, stop_ids: dict[str, int], samples: list[str]) -> tuple[dict, int]:
    """`plan(stop, sample)` -> itinerary or None, for each (global stop, sample) pair."""
    paths, trips, missing = PathTable(), {}, 0
    for stop, sample in pairs:
        it = plan(stop, sample)
        if it is None:
            missing += 1
            continue
        trips[f"{stop}:{sample}"] = trip_from_plan(it, stop_ids, paths)
    return {"samples": samples, "paths": paths.items, "trips": trips}, missing


def make_grid(spacing: float) -> pd.DataFrame:
    lons = np.arange(GRID_BBOX.min_lon, GRID_BBOX.max_lon, spacing)
    lats = np.arange(GRID_BBOX.min_lat, GRID_BBOX.max_lat, spacing)
    lon, lat = (a.ravel() for a in np.meshgrid(lons, lats))
    return pd.DataFrame({"lat": lat, "lon": lon})


def to_metres(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Local equirectangular projection; accurate to <0.5% over the Perth grid."""
    lat0 = np.radians(WORK[0])
    return np.column_stack([np.radians(lon) * 6371000 * np.cos(lat0), np.radians(lat) * 6371000])


class Motis:
    def __init__(self, url: str):
        self.url = url.rstrip("/")
        self.s = requests.Session()
        adapter = requests.adapters.HTTPAdapter(pool_maxsize=64)
        self.s.mount("http://", adapter)

    def one_to_all(self, when: datetime, max_minutes: int, max_walk_s: int) -> pd.DataFrame:
        r = self.s.get(f"{self.url}/api/v6/one-to-all", timeout=600, params={
            "one": f"{WORK[0]},{WORK[1]}",
            "time": when.isoformat(),
            "arriveBy": "true",
            "maxTravelTime": max_minutes,
            "maxPreTransitTime": max_walk_s,
            "maxPostTransitTime": max_walk_s,
            "useRoutedTransfers": "true",
        })
        r.raise_for_status()
        rows = [
            {"stop": p["place"].get("stopId") or p["place"].get("name"),
             "lat": p["place"]["lat"], "lon": p["place"]["lon"],
             "minutes": p["duration"], "k": p.get("k")}
            for p in r.json()["all"]
        ]
        return pd.DataFrame(rows)

    def plan(self, stop_id: str, arrive: datetime) -> dict:
        """Raw /api/v5/plan response: arrive-by journeys from a stop to work."""
        r = self.s.get(f"{self.url}/api/v5/plan", timeout=60, params={
            "fromPlace": stop_id, "toPlace": f"{WORK[0]},{WORK[1]}",
            "time": arrive.isoformat(), "arriveBy": "true", "numItineraries": 1,
        })
        r.raise_for_status()
        return r.json()

    def walk_times(self, one: tuple[float, float], many: np.ndarray, max_s: int, max_match_m: int) -> np.ndarray:
        """Seconds to walk from each `many` point to `one` (NaN if unreachable)."""
        body = {
            "one": f"{one[0]};{one[1]}",
            "many": [f"{la};{lo}" for la, lo in many],
            "mode": "WALK",
            "max": max_s,
            "maxMatchingDistance": max_match_m,
            "arriveBy": True,
        }
        r = self.s.post(f"{self.url}/api/v1/one-to-many", json=body, timeout=600)
        r.raise_for_status()
        return np.array([d.get("duration", np.nan) if d else np.nan for d in r.json()], dtype=float)


def route(args: argparse.Namespace) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    motis = Motis(args.motis_url)

    travel_date = date.fromisoformat(args.date) if args.date else default_travel_date()
    start = datetime.combine(travel_date, datetime.strptime(args.arrive_from, "%H:%M").time(), PERTH)
    arrivals = [start + timedelta(minutes=m) for m in range(0, args.window + 1, args.step)]
    log(f"arrive-by {arrivals[0]:%a %Y-%m-%d %H:%M} .. {arrivals[-1]:%H:%M} every {args.step} min "
        f"({len(arrivals)} searches)")

    # 1. transit leg: stop -> work, for each arrival time
    def ota(t: datetime) -> pd.DataFrame:
        return motis.one_to_all(t, args.max_minutes, args.max_walk * 60).assign(t=t.strftime("%H:%M"))

    with ThreadPoolExecutor(args.workers) as ex:
        transit = pd.concat(ex.map(ota, arrivals), ignore_index=True)
    if transit.empty:
        sys.exit("MOTIS returned no reachable stops - is the GTFS valid for the travel date?")
    stops = transit.groupby("stop")[["lat", "lon"]].first().reset_index()
    stop_minutes = transit.pivot_table(index="stop", columns="t", values="minutes", aggfunc="min").reindex(stops["stop"])
    log(f"{len(stops)} stops can reach work; sample durations (min): "
        f"{transit['minutes'].describe()[['min', '50%', 'max']].round(1).to_dict()}")

    # 2. access leg: grid -> stop walking, one batched request per stop
    grid = make_grid(args.spacing)
    # Only points near a walkable way: MOTIS snaps far-off points (e.g. mid-river) to the nearest path
    # without charging for the distance, which gave water cells the travel time of the bank.
    if not WALKWAYS.exists():
        sys.exit(f"{WALKWAYS} missing - run the `masks` stage first")
    on_foot = walkable(grid, args.walkable_within)
    log(f"{on_foot.sum():,}/{len(grid):,} grid points within {args.walkable_within} m of a walkable way")
    grid = grid[on_foot].reset_index(drop=True)
    grid_xy = to_metres(grid["lat"].to_numpy(), grid["lon"].to_numpy())
    tree = cKDTree(grid_xy)
    radius = args.max_walk * 60 * 1.5  # m; generous crow-flies bound for a walk of max_walk minutes
    stop_xy = to_metres(stops["lat"].to_numpy(), stops["lon"].to_numpy())
    near = tree.query_ball_point(stop_xy, r=radius)

    def access(i: int) -> tuple[np.ndarray, np.ndarray]:
        idx = np.asarray(near[i], dtype=np.int64)
        if idx.size == 0:
            return idx, np.empty(0)
        secs = motis.walk_times((stops.lat[i], stops.lon[i]), grid[["lat", "lon"]].to_numpy()[idx],
                                args.max_walk * 60, args.snap)
        ok = ~np.isnan(secs)
        return idx[ok], secs[ok]

    log(f"walking times for {len(grid):,} grid points around {len(stops)} stops")
    g_idx, g_stop, g_walk = [], [], []
    with ThreadPoolExecutor(args.workers) as ex:
        for s, (idx, secs) in enumerate(tqdm(ex.map(access, range(len(stops))), total=len(stops), mininterval=10)):
            g_idx.append(idx)
            g_stop.append(np.full(idx.size, s))
            g_walk.append(secs / 60)
    g_idx, g_stop, g_walk = map(np.concatenate, (g_idx, g_stop, g_walk))

    # direct walk to work (no transit)
    w_idx = np.asarray(tree.query_ball_point(to_metres(np.array([WORK[0]]), np.array([WORK[1]]))[0], r=radius * 2))
    w_min = motis.walk_times(WORK, grid[["lat", "lon"]].to_numpy()[w_idx], args.max_walk * 120, args.snap) / 60

    # 3. combine per arrival time, then summarise
    per_t = combine(len(grid), g_idx, g_stop, g_walk, stop_minutes.to_numpy(), w_idx, w_min).total

    with np.errstate(all="ignore"):
        grid["travel_time"] = np.nanpercentile(per_t, args.percentile, axis=0)
        grid["travel_time_min"] = np.nanmin(per_t, axis=0)
        grid["travel_time_max"] = np.nanmax(per_t, axis=0)
    out = grid.dropna(subset=["travel_time"])
    out.to_csv(RESULTS / "grid_travel_times.csv", index=False)
    (RESULTS / "run.json").write_text(json.dumps({
        "travel_date": travel_date.isoformat(), "arrivals": [a.isoformat() for a in arrivals],
        "percentile": args.percentile, "spacing_deg": args.spacing, "max_walk_min": args.max_walk,
        "walkable_within_m": args.walkable_within,
        "grid_points": len(grid), "reachable_points": len(out), "stops": len(stops),
        "generated": datetime.now(PERTH).isoformat(timespec="seconds"),
    }, indent=2))
    log(f"{len(out):,}/{len(grid):,} grid points reachable; median {out.travel_time.median():.1f} min "
        f"-> {RESULTS / 'grid_travel_times.csv'}")


# ----------------------------------------------------------------------- isochrones
# matplotlib 'plasma' anchors (r, g, b) - avoids pulling matplotlib in just for a colormap.
_PLASMA = np.array([
    [0.050383, 0.029803, 0.527975], [0.274952, 0.012588, 0.622364], [0.494877, 0.011990, 0.657865],
    [0.665129, 0.138566, 0.585582], [0.798216, 0.280197, 0.469538], [0.902323, 0.425383, 0.359915],
    [0.973416, 0.585761, 0.251540], [0.993814, 0.765863, 0.159460], [0.940015, 0.975158, 0.131326],
])


def plasma_r(n: int) -> np.ndarray:
    x = np.linspace(1, 0, n) * (len(_PLASMA) - 1)
    return np.array([np.interp(x, np.arange(len(_PLASMA)), _PLASMA[:, c]) for c in range(3)]).T


def band_polygons(ix: np.ndarray, iy: np.ndarray, shape: tuple[int, int], close: int, min_hole: int):
    """Grid cells -> (Multi)Polygon in cell units. Closing fills 1-cell speckle, small holes are filled."""
    from scipy import ndimage
    from shapely import box, coverage_union_all

    cells = np.zeros(shape, dtype=bool)
    cells[iy, ix] = True
    if close:
        cells = ndimage.binary_closing(np.pad(cells, close), iterations=close)[close:-close, close:-close] | cells
    holes, n = ndimage.label(~cells)
    if n:
        sizes = ndimage.sum_labels(np.ones_like(holes), holes, index=np.arange(1, n + 1))
        edge = np.unique(np.concatenate([holes[0], holes[-1], holes[:, 0], holes[:, -1]]))
        small = np.flatnonzero(sizes < min_hole) + 1
        cells |= np.isin(holes, np.setdiff1d(small, edge))
    yy, xx = np.nonzero(cells)
    if not len(xx):
        return None
    return coverage_union_all(box(xx - 0.5, yy - 0.5, xx + 0.5, yy + 0.5))


def isochrones(args: argparse.Namespace) -> None:
    """Band polygons straight from the grid cells (no hull), smoothed and clipped to land."""
    import geopandas as gpd
    from shapely import make_valid, unary_union
    from shapely.affinity import affine_transform

    run = json.loads((RESULTS / "run.json").read_text())
    s = run["spacing_deg"]
    df = pd.read_csv(RESULTS / "grid_travel_times.csv")
    ix = np.rint((df.lon.to_numpy() - GRID_BBOX.min_lon) / s).astype(int)
    iy = np.rint((df.lat.to_numpy() - GRID_BBOX.min_lat) / s).astype(int)
    shape = (iy.max() + 1, ix.max() + 1)
    to_lonlat = [s, 0, 0, s, GRID_BBOX.min_lon, GRID_BBOX.min_lat]

    water = None
    if WATER.exists() and not args.no_water:
        w = gpd.read_parquet(WATER)
        # ~10 m tolerance keeps the shoreline honest without thousands of extra vertices per band
        water = make_valid(unary_union(w.geometry.simplify(s / 10).values))
        log(f"clipping to land with {len(w):,} water polygons")

    steps = list(range(args.first, args.last, args.every))
    rows = []
    for step in steps:
        sel = df.travel_time.to_numpy() < step
        geom = band_polygons(ix[sel], iy[sel], shape, args.close, args.min_hole)
        if geom is None:
            continue
        # round off the staircase a little, then back to lon/lat
        r = args.smooth
        geom = geom.buffer(r, join_style="round").buffer(-r, join_style="round").simplify(0.25)
        geom = affine_transform(geom, to_lonlat)
        if water is not None:
            geom = make_valid(geom.difference(water))
        # drop slivers left by the clip (under ~1 cell) and thin out the shoreline vertices
        parts = [g for g in getattr(geom, "geoms", [geom]) if g.geom_type == "Polygon" and g.area >= s * s]
        geom = unary_union(parts).simplify(s / 5).buffer(0) if parts else geom.__class__()
        if not geom.is_empty:
            rows.append({"index": step, "time": step, "geometry": geom})
            log(f"{step:3d} min: {geom.geom_type}, {len(getattr(geom, 'geoms', [geom]))} part(s)")
    gdf = gpd.GeoDataFrame(rows, geometry="geometry", crs="EPSG:4326")
    rgb = plasma_r(len(steps))[[steps.index(s) for s in gdf["time"]]]
    gdf[["r", "g", "b"]] = rgb.round(6)
    gdf["a"] = 1.0
    out = RESULTS / "poly.json"
    gdf[::-1][["index", "time", "r", "g", "b", "a", "geometry"]].to_file(out, driver="GeoJSON", COORDINATE_PRECISION=5)
    log(f"wrote {len(gdf)} isochrones -> {out}  (copy to src/assets/poly.json)")


# ----------------------------------------------------------------------------- cli
def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("prepare")
    sp.add_argument("--force", action="store_true", help="re-crop OSM even if perth.osm.pbf exists")
    sp.add_argument("--keep-gtfs", action="store_true", help="reuse an existing GTFS download")
    sp.set_defaults(fn=prepare)

    sp = sub.add_parser("masks")
    sp.add_argument("--force", action="store_true", help="rebuild even if the masks exist")
    sp.set_defaults(fn=masks)

    sp = sub.add_parser("route")
    sp.add_argument("--motis-url", default=os.environ.get("MOTIS_URL", "http://motis:8080"))
    sp.add_argument("--date", help="travel date YYYY-MM-DD (default: next Wednesday, Perth time)")
    sp.add_argument("--arrive-from", default="08:00", help="start of the arrive-by window (HH:MM)")
    sp.add_argument("--window", type=int, default=60, help="arrive-by window length, minutes")
    sp.add_argument("--step", type=int, default=5, help="minutes between arrival samples")
    sp.add_argument("--percentile", type=float, default=env_float("PERCENTILE", 50))
    sp.add_argument("--spacing", type=float, default=env_float("GRID_SPACING", 0.001), help="grid spacing, degrees")
    sp.add_argument("--max-walk", type=int, default=15, help="max walk to/from transit, minutes")
    sp.add_argument("--max-minutes", type=int, default=120, help="max total journey, minutes")
    sp.add_argument("--snap", type=int, default=100, help="max distance to snap a grid point to a path, m")
    sp.add_argument("--walkable-within", type=int, default=75,
                    help="drop grid points further than this from a walkable way, m")
    sp.add_argument("--workers", type=int, default=os.cpu_count() or 8)
    sp.set_defaults(fn=route)

    sp = sub.add_parser("isochrones")
    sp.add_argument("--first", type=int, default=15)
    sp.add_argument("--last", type=int, default=90)
    sp.add_argument("--every", type=int, default=5)
    sp.add_argument("--close", type=int, default=1, help="morphological closing iterations (cells)")
    sp.add_argument("--min-hole", type=int, default=6, help="fill holes smaller than this many cells")
    sp.add_argument("--smooth", type=float, default=0.6, help="edge rounding radius (cells)")
    sp.add_argument("--no-water", action="store_true", help="don't clip bands to land")
    sp.set_defaults(fn=isochrones)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
