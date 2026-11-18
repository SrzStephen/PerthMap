"""PerthMap data pipeline: public-transport travel times to one destination via MOTIS.

Stages (run in order by docker compose, or individually):

  prepare     crop OSM to Perth, download the current Transperth GTFS, write MOTIS config.yml,
              then build the masks below
  masks       extract walkable paths and water areas from the Perth OSM extract
  route       query a running MOTIS server; write the web app's data (data/results/web/)

How `route` works, for 3 days (weekday/Saturday/Sunday) x 16 one-hour arrive-by windows:

  1. Transit leg: one `/api/v6/one-to-all` arrive-by query from the destination per arrival
     sample (every 5 min). That gives, for every reachable stop, how long before the arrival
     time you must leave that stop.
  2. Access leg: one batched `/api/v1/one-to-many` WALK query per reachable stop to the
     walkable grid points around it (independent of time, so done once for all windows).
  3. Combine: time(cell, T) = min(direct walk, min_stop walk(cell, stop) + transit(stop, T)),
     keeping the winning stop; per window store the median (map colour) and the fastest sample.
  4. Itineraries: one `/api/v5/plan` per (stop, sample) the grid uses, for the click-for-route panel.
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
from datetime import date, datetime, time, timedelta
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
    """Walkable paths (grid points must be near one) and water areas (the web app clips bands by them)."""
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
DAYS = {"weekday": ("Weekday", 2), "saturday": ("Saturday", 5), "sunday": ("Sunday", 6)}  # key: (label, weekday())
WEB = RESULTS / "web"


def service_dates(today: date) -> dict[str, date]:
    """Next Wednesday / Saturday / Sunday after `today` (never today: the GTFS feed may start mid-day)."""
    return {k: today + timedelta(days=(wd - today.weekday()) % 7 or 7) for k, (_, wd) in DAYS.items()}


def sample_times(day: date, hour: int) -> list[datetime]:
    """Arrival samples HH:00, HH:05 ... HH:55 for one window."""
    return [datetime.combine(day, time(hour, m), PERTH) for m in range(0, 60, 5)]


def require_service(day: str, transits: list[pd.DataFrame]) -> None:
    """A day with no reachable stop in any window means the GTFS feed doesn't cover the date."""
    if all(t.empty for t in transits):
        sys.exit(f"MOTIS returned no reachable stops for any {day} window - is the GTFS valid for that date?")


def trip_minutes(depart: str, arrive: str) -> int:
    """Minutes from HH:MM to HH:MM, wrapping past midnight."""
    dh, dm = map(int, depart.split(":"))
    ah, am = map(int, arrive.split(":"))
    return ((ah * 60 + am) - (dh * 60 + dm)) % 1440


def mismatch_rate(fastest: np.ndarray, via_trip: np.ndarray, tolerance: float = 5) -> float | None:
    """Share of cells (with both values) where the grid time and the planned trip differ by > tolerance.

    None when no cell has both (e.g. every plan failed): unknown, not a perfect 0 %."""
    ok = ~np.isnan(fastest) & ~np.isnan(via_trip)
    return float(np.mean(np.abs(fastest[ok] - via_trip[ok]) > tolerance)) if ok.any() else None


def missing_share(missing: int, pairs: int) -> float:
    """Share of (stop, sample) itineraries MOTIS couldn't plan."""
    return missing / pairs if pairs else 0.0


def parse_hours(spec: str) -> list[int]:
    """'6-21' or '7,8,17' -> hours."""
    out = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a), int(b or a) + 1))
    return out


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":")))


def write_water(meta: GridMeta, path: Path) -> None:
    import geopandas as gpd

    w = gpd.read_parquet(WATER)
    b = GRID_BBOX.padded(0.01)
    geom = w.geometry.clip_by_rect(b.min_lon, b.min_lat, b.max_lon, b.max_lat).simplify(meta.spacing / 10)
    gpd.GeoDataFrame(geometry=geom[~geom.is_empty], crs="EPSG:4326").to_file(
        path, driver="GeoJSON", COORDINATE_PRECISION=5)


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
        df = pd.read_csv(f, dtype={"stop_id": str}, skipinitialspace=True)[["stop_id", "stop_name", "stop_lat", "stop_lon"]]
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


def encode_polyline(points, precision: int = 5) -> str:
    """Google encoded polyline of (lat, lon) points."""
    f, out, prev = 10 ** precision, [], (0, 0)
    for lat, lon in points:
        cur = (int(round(lat * f)), int(round(lon * f)))
        for d in (cur[0] - prev[0], cur[1] - prev[1]):
            v = ~(d << 1) if d < 0 else d << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        prev = cur
    return "".join(out)


def decode_polyline(s: str, precision: int = 6) -> list[tuple[float, float]]:
    f, i, lat, lon, pts = 10 ** precision, 0, 0, 0, []
    while i < len(s):
        vals = []
        for _ in range(2):
            shift = result = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                result |= (b & 0x1F) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(result >> 1) if result & 1 else result >> 1)
        lat, lon = lat + vals[0], lon + vals[1]
        pts.append((lat / f, lon / f))
    return pts


class RouteTables:
    """Interned [mode, line, headsign] entries and shared leg shapes.

    A leg's geometry is a slice (shape, i0, i1) of a shape: a later leg that runs along an existing shape of the
    same line (within MATCH_M) reuses it. `finalize()` simplifies shapes between the vertices legs reference and
    remaps every registered leg in place."""

    MATCH_M = 25.0
    SIMPLIFY_DEG = 0.00005  # ~5 m

    def __init__(self) -> None:
        self.lines: list[list[str]] = []
        self._line_index: dict[tuple, int] = {}
        self._shapes: list[np.ndarray] = []  # raw (lat, lon) arrays
        self._groups: dict[tuple, list[int]] = {}
        self._legs: list[list] = []  # registered legs: [line, from, to, dep, arr, shape, i0, i1]

    def line(self, mode: str, name: str, headsign: str) -> int:
        key = (mode, name, headsign)
        if key not in self._line_index:
            self._line_index[key] = len(self.lines)
            self.lines.append(list(key))
        return self._line_index[key]

    def add_geometry(self, group: tuple, points) -> tuple[int, int, int]:
        from shapely import LineString, Point

        pts = np.asarray(points, dtype=float)
        xy = to_metres(pts[:, 0], pts[:, 1])
        for s in self._groups.get(group, []):
            sxy = to_metres(self._shapes[s][:, 0], self._shapes[s][:, 1])
            d0 = np.hypot(*(sxy - xy[0]).T)
            d1 = np.hypot(*(sxy - xy[-1]).T)
            i0, i1 = int(np.argmin(d0)), int(np.argmin(d1))
            if d0[i0] > self.MATCH_M or d1[i1] > self.MATCH_M or i1 < i0:
                continue
            seg = sxy[i0:i1 + 1]
            if len(seg) == 1:
                ok = np.all(np.hypot(*(xy - seg[0]).T) <= self.MATCH_M)
            else:
                line = LineString(seg)
                ok = max(line.distance(Point(p)) for p in xy) <= self.MATCH_M
            if ok:
                return s, i0, i1
        self._shapes.append(pts)
        self._groups.setdefault(group, []).append(len(self._shapes) - 1)
        return len(self._shapes) - 1, 0, len(pts) - 1

    def register(self, leg: list) -> list:
        self._legs.append(leg)
        return leg

    def finalize(self) -> list[str]:
        """Encoded (precision 5), simplified shapes; registered legs' (i0, i1) remapped to them."""
        from shapely import LineString

        anchors: dict[int, set[int]] = {}
        for leg in self._legs:
            anchors.setdefault(leg[5], set()).update((leg[6], leg[7]))
        out, remap = [], {}
        for s, pts in enumerate(self._shapes):
            keep = sorted(anchors.get(s, set()) | {0, len(pts) - 1})
            new_pts, index = [tuple(pts[0])], {0: 0}
            for a, b in zip(keep, keep[1:]):
                chunk = pts[a:b + 1]
                if len(chunk) > 2:
                    chunk = np.asarray(LineString(chunk[:, ::-1]).simplify(self.SIMPLIFY_DEG).coords)[:, ::-1]
                new_pts.extend(tuple(p) for p in chunk[1:])
                index[b] = len(new_pts) - 1
            out.append(encode_polyline(new_pts, 5))
            remap[s] = index
        for leg in self._legs:
            leg[6], leg[7] = remap[leg[5]][leg[6]], remap[leg[5]][leg[7]]
        self._legs = []
        return out


def _minutes(ts: str) -> int:
    t = _utc(ts).astimezone(PERTH)
    return t.hour * 60 + t.minute


def trip_from_plan(it: dict, stop_ids: dict[str, int], tables: RouteTables) -> list:
    """[depart, arrive, legs] with times in Perth minutes since midnight and legs
    [line, from, to, depart, arrive, shape, i0, i1] (stop -1 = not a GTFS stop)."""
    legs = []
    for l in it["legs"]:
        mode, name, head = l["mode"], l.get("displayName") or "", l.get("headsign") or ""
        frm = stop_ids.get(l["from"].get("stopId") or "", -1)
        to = stop_ids.get(l["to"].get("stopId") or "", -1)
        group = (mode, name, head) if mode != "WALK" else (mode, to)
        pts = decode_polyline(l["legGeometry"]["points"], 6)
        if len(pts) < 2:  # zero-length walks come back with an empty polyline
            pts = [(l["from"]["lat"], l["from"]["lon"]), (l["to"]["lat"], l["to"]["lon"])]
        shape, i0, i1 = tables.add_geometry(group, pts)
        legs.append(tables.register([tables.line(mode, name, head), frm, to,
                                     _minutes(l["startTime"]), _minutes(l["endTime"]), shape, i0, i1]))
    return [_minutes(it["startTime"]), _minutes(it["endTime"]), legs]


def build_routes(pairs, plan, stop_ids: dict[str, int], samples: list[str]) -> tuple[dict, int]:
    """`plan(stop, sample)` -> itinerary or None, for each (global stop, sample) pair.

    Longest itineraries are added first so shorter legs along the same line reuse their shapes."""
    tables, trips, missing, plans = RouteTables(), {}, 0, []
    for stop, sample in pairs:
        it = plan(stop, sample)
        if it is None:
            missing += 1
        else:
            plans.append((stop, sample, it))
    plans.sort(key=lambda p: -sum(len(l["legGeometry"]["points"]) for l in p[2]["legs"]))
    for stop, sample, it in plans:
        trips[f"{stop}:{sample}"] = trip_from_plan(it, stop_ids, tables)
    shapes = tables.finalize()
    return {"samples": samples, "lines": tables.lines, "shapes": shapes, "trips": trips}, missing


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
            "useRoutedTransfers": "true",  # same transfer model as one_to_all, or trips leave earlier
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
    WEB.mkdir(parents=True, exist_ok=True)
    motis = Motis(args.motis_url)
    dates = service_dates(datetime.now(PERTH).date())
    days = args.days.split(",")
    hours = parse_hours(args.hours)
    windows = [(d, h) for d in days for h in hours]
    log(f"{len(windows)} windows: days {', '.join(f'{d} {dates[d]}' for d in days)}; hours {hours[0]}-{hours[-1]}")

    # 1. transit leg: stop -> work, for every arrival sample of every window
    def ota(job):
        _, k, t = job
        return motis.one_to_all(t, args.max_minutes, args.max_walk * 60).assign(t=k)

    jobs = [((d, h), k, t) for d, h in windows for k, t in enumerate(sample_times(dates[d], h))]
    with ThreadPoolExecutor(args.workers) as ex:
        parts = list(tqdm(ex.map(ota, jobs), total=len(jobs), mininterval=10))
    by_window: dict = {}
    for (w, _, _), part in zip(jobs, parts):
        by_window.setdefault(w, []).append(part)
    transit = {w: pd.concat(p, ignore_index=True) for w, p in by_window.items()}
    for d in days:
        require_service(d, [transit[(d, h)] for h in hours])

    gtfs_stops, stop_ids = load_stops(INPUT / "transperth_gtfs.zip")
    stops = pd.concat(transit.values()).groupby("stop")[["lat", "lon"]].first().reset_index()
    unknown = ~stops["stop"].isin(stop_ids)
    if unknown.any():
        log(f"warning: {unknown.sum()} stops not in GTFS stops.txt - ignored")
    stops = stops[~unknown].reset_index(drop=True)
    stop_global = stops["stop"].map(stop_ids).to_numpy()
    motis_id = dict(zip(stop_global.tolist(), stops["stop"]))
    log(f"{len(stops)} stops reach work in at least one window")

    # 2. access leg (time-independent): walkable grid cells -> stops, plus direct walk to work
    grid = make_grid(args.spacing)
    meta = grid_meta(args.spacing)
    # Only points near a walkable way: MOTIS snaps far-off points (e.g. mid-river) to the nearest path
    # without charging for the distance, which gave water cells the travel time of the bank.
    if not WALKWAYS.exists():
        sys.exit(f"{WALKWAYS} missing - run the `masks` stage first")
    on_foot = walkable(grid, args.walkable_within)
    log(f"{on_foot.sum():,}/{len(grid):,} grid points within {args.walkable_within} m of a walkable way")
    grid = grid[on_foot].reset_index(drop=True)
    cells = cell_of(meta, grid["lat"].to_numpy(), grid["lon"].to_numpy())
    tree = cKDTree(to_metres(grid["lat"].to_numpy(), grid["lon"].to_numpy()))
    radius = args.max_walk * 60 * 1.5  # m; generous crow-flies bound for a walk of max_walk minutes
    near = tree.query_ball_point(to_metres(stops["lat"].to_numpy(), stops["lon"].to_numpy()), r=radius)

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
    w_idx = np.asarray(tree.query_ball_point(to_metres(np.array([WORK[0]]), np.array([WORK[1]]))[0], r=radius * 2))
    w_min = motis.walk_times(WORK, grid[["lat", "lon"]].to_numpy()[w_idx], args.max_walk * 120, args.snap) / 60

    # 3. per window: combine, summarise, plan the fastest trips, write files
    mismatch, missing_rate = {}, {}
    for day, hour in windows:
        key = f"{day}-{hour:02d}"
        times = sample_times(dates[day], hour)
        samples = [t.strftime("%H:%M") for t in times]
        tw = transit[(day, hour)]
        stop_minutes = np.full((len(stops), len(times)), np.nan)
        if not tw.empty:
            stop_minutes = (tw.pivot_table(index="stop", columns="t", values="minutes", aggfunc="min")
                            .reindex(index=stops["stop"], columns=range(len(times))).to_numpy(dtype=float))
        s = summarise(combine(len(grid), g_idx, g_stop, g_walk, stop_minutes, w_idx, w_min))
        # gzipped, but not named .gz: dev/static servers add Content-Encoding: gzip from the extension
        (WEB / f"{key}.grid.bin").write_bytes(encode_grid(s, cells, meta, stop_global))

        used = s.stop >= 0
        pairs = sorted(set(zip(stop_global[s.stop[used]].tolist(), s.sample[used].tolist())))

        def fetch(pair):
            stop, k = pair
            try:
                return pair, best_itinerary(motis.plan(motis_id[stop], times[k]), times[k])
            except requests.RequestException as e:
                log(f"warning: plan {motis_id[stop]} @ {samples[k]} failed: {e}")
                return pair, None

        with ThreadPoolExecutor(args.workers) as ex:
            plans = dict(ex.map(fetch, pairs))
        routes, missing = build_routes(pairs, lambda st, k: plans[(st, k)], stop_ids, samples)
        write_json(WEB / f"{key}.routes.json", routes)

        via = np.full(len(grid), np.nan)
        for i in np.flatnonzero(used):
            trip = routes["trips"].get(f"{stop_global[s.stop[i]]}:{s.sample[i]}")
            if trip:
                target = times[s.sample[i]].hour * 60 + times[s.sample[i]].minute
                via[i] = s.walk[i] + (target - trip[0]) % 1440
        rate = mismatch_rate(s.fastest, via)
        mismatch[key] = None if rate is None else round(rate, 4)
        missing_rate[key] = round(missing_share(missing, len(pairs)), 4)
        flags = []
        if rate is None and pairs:
            flags.append("no trip could be compared")
        elif rate is not None and rate > 0.05:
            flags.append("> 5% mismatch")
        if missing_rate[key] > 0.05:
            flags.append(f"{missing_rate[key]:.0%} of trips missing")
        flag = f"  WARNING: {'; '.join(flags)}" if flags else ""
        shown = "n/a" if rate is None else f"{rate:.1%}"
        log(f"{key}: {np.isfinite(s.median).sum():,} cells reachable, {len(pairs):,} trips "
            f"({missing} missing), mismatch {shown}{flag}")

    # 4. shared files
    write_json(WEB / "stops.json", [[r.stop_name, round(r.stop_lat, 5), round(r.stop_lon, 5)]
                                     for r in gtfs_stops.itertuples()])
    write_water(meta, WEB / "water.json")
    index_path = WEB / "index.json"
    old = json.loads(index_path.read_text()) if index_path.exists() else {}
    write_json(index_path, {
        "version": GRID_VERSION,
        "generated": datetime.now(PERTH).isoformat(timespec="seconds"),
        "grid": {"width": meta.width, "height": meta.height, "minLon": meta.min_lon, "minLat": meta.min_lat,
                 "spacing": meta.spacing},
        "days": [{"key": d, "label": DAYS[d][0], "date": dates[d].isoformat()} for d in DAYS],
        "hours": list(range(6, 22)),
        "mismatchRate": {**old.get("mismatchRate", {}), **mismatch},
        "missingRate": {**old.get("missingRate", {}), **missing_rate},
    })
    log(f"wrote {len(windows)} windows -> {WEB}  (copy to public/data/)")


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
    sp.add_argument("--days", default="weekday,saturday,sunday", help="comma list of weekday,saturday,sunday")
    sp.add_argument("--hours", default="6-21", help="arrive-by window start hours, e.g. 6-21 or 7,8,17")
    sp.add_argument("--spacing", type=float, default=env_float("GRID_SPACING", 0.001), help="grid spacing, degrees")
    sp.add_argument("--max-walk", type=int, default=15, help="max walk to/from transit, minutes")
    sp.add_argument("--max-minutes", type=int, default=120, help="max total journey, minutes")
    sp.add_argument("--snap", type=int, default=100, help="max distance to snap a grid point to a path, m")
    sp.add_argument("--walkable-within", type=int, default=75,
                    help="drop grid points further than this from a walkable way, m")
    sp.add_argument("--workers", type=int, default=os.cpu_count() or 8)
    sp.set_defaults(fn=route)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
