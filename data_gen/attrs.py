"""Per-cell attribute planes on the travel-time grid (`attrs.bin`, "PMA1") and helpers to rasterise layers onto it."""
from __future__ import annotations

import gzip
import struct

import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely.geometry.base import BaseGeometry

from pipeline import BBox, GridMeta

ATTRS_MAGIC, ATTRS_VERSION = b"PMA1", 1
DTYPES = {1: np.dtype("<u1"), 2: np.dtype("<u2")}
_CODES = {"u1": 1, "u2": 2}
_TO_M = Transformer.from_crs("EPSG:4326", "EPSG:7850", always_xy=True)


def encode_attrs(fields: dict[str, np.ndarray], meta: GridMeta) -> bytes:
    n = meta.width * meta.height
    head = struct.pack("<4sHIIH", ATTRS_MAGIC, ATTRS_VERSION, meta.width, meta.height, len(fields))
    planes = []
    for name, plane in fields.items():
        code = _CODES.get(plane.dtype.str[1:])
        if code is None or plane.size != n:
            raise ValueError(f"attr {name}: need {n} u8/u16 values, got {plane.size} {plane.dtype}")
        raw = name.encode("ascii")
        head += struct.pack("<B", len(raw)) + raw + struct.pack("<B", code)
        planes.append(plane.astype(DTYPES[code]).tobytes())
    if len(head) % 2:
        head += b"\0"
    return gzip.compress(head + b"".join(planes), 9)


def decode_attrs(b: bytes) -> tuple[tuple[int, int], dict[str, np.ndarray]]:
    raw = gzip.decompress(b)
    magic, version, w, h, count = struct.unpack_from("<4sHIIH", raw)
    if magic != ATTRS_MAGIC or version != ATTRS_VERSION:
        raise ValueError("attrs format")
    off, spec = struct.calcsize("<4sHIIH"), []
    for _ in range(count):
        size = raw[off]
        name = raw[off + 1:off + 1 + size].decode("ascii")
        spec.append((name, DTYPES[raw[off + 1 + size]]))
        off += size + 2
    off += off % 2
    out = {}
    for name, dt in spec:
        out[name] = np.frombuffer(raw, dtype=dt, count=w * h, offset=off).copy()
        off += w * h * dt.itemsize
    return (w, h), out


def cell_centres(meta: GridMeta) -> tuple[np.ndarray, np.ndarray]:
    xs = meta.min_lon + np.arange(meta.width) * meta.spacing
    ys = meta.min_lat + np.arange(meta.height) * meta.spacing
    gx, gy = np.meshgrid(xs, ys)
    return gx.ravel(), gy.ravel()


def _centres_m(meta: GridMeta) -> np.ndarray:
    return shapely.points(*_TO_M.transform(*cell_centres(meta)))


def inside_code(meta: GridMeta, coded: list[tuple[int, BaseGeometry]]) -> np.ndarray:
    """Code of the polygon holding each cell centre (lowest code wins), 0 outside."""
    lon, lat = cell_centres(meta)
    plane = np.zeros(lon.size, dtype=np.uint8)
    for code, geom in sorted(coded, key=lambda cg: -cg[0]):  # lowest code painted last
        x0, y0, x1, y1 = geom.bounds
        cand = np.nonzero((lon >= x0) & (lon <= x1) & (lat >= y0) & (lat <= y1))[0]
        if cand.size:
            shapely.prepare(geom)
            plane[cand[shapely.contains_xy(geom, lon[cand], lat[cand])]] = code
    return plane


def distance_m(meta: GridMeta, geoms_m: list[BaseGeometry], cap: int) -> np.ndarray:
    """Metres (EPSG:7850) from each cell centre to the nearest geometry, `cap` when none is closer."""
    pts = _centres_m(meta)
    plane = np.full(len(pts), cap, dtype=np.uint16)
    if geoms_m:
        tree = shapely.STRtree(geoms_m)
        (src, _), dist = tree.query_nearest(pts, max_distance=cap, return_distance=True)
        np.minimum.at(plane, src, np.rint(dist).astype(np.uint16))
    return plane


def max_within(meta: GridMeta, valued_m: list[tuple[int, BaseGeometry]], radius: float) -> np.ndarray:
    """Largest value of any geometry within `radius` m of each cell centre (clipped to 255), 0 when none."""
    pts = _centres_m(meta)
    plane = np.zeros(len(pts), dtype=np.uint8)
    if valued_m:
        values = np.clip([v for v, _ in valued_m], 0, 255).astype(np.uint8)
        tree = shapely.STRtree([g for _, g in valued_m])
        src, hit = tree.query(pts, predicate="dwithin", distance=radius)
        np.maximum.at(plane, src, values[hit])
    return plane


def fetch_arcgis(url: str, bbox: BBox, out_fields: str = "*", session=requests) -> list[dict]:
    """All features of an ArcGIS MapServer layer that intersect `bbox`, as GeoJSON (WGS84)."""
    out: list[dict] = []
    while True:
        r = session.get(url, params={
            "where": "1=1", "outFields": out_fields, "outSR": 4326, "f": "geojson", "resultOffset": len(out),
            "geometry": f"{bbox.min_lon},{bbox.min_lat},{bbox.max_lon},{bbox.max_lat}",
            "geometryType": "esriGeometryEnvelope", "inSR": 4326, "spatialRel": "esriSpatialRelIntersects",
        }, timeout=300)
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            raise RuntimeError(f"{url}: {body['error']}")
        feats = body.get("features") or []
        out += feats
        if not feats or not body.get("exceededTransferLimit"):
            break
    if not out:
        raise RuntimeError(f"{url}: no features in the mapped area")
    return out
