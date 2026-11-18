"""Public schools (DET-024) and their local intake areas (Department of Education WA intake-map GeoPDFs)."""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import struct
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import numpy as np
import requests
import shapely
from pyproj import Transformer
from shapely.geometry import Polygon, mapping
from shapely.ops import transform

import intake
from pipeline import GRID_BBOX, INPUT, RESULTS, WEB, BBox, GridMeta, grid_meta, log, write_json

SLIP_SCHOOLS = ("https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/"
                "Education/MapServer/13/query")
INTAKE_MAP = "https://www.det.wa.edu.au/schoolsonline/school_file_download"
YEARS = ["PKG", "KIN", "PPR"] + [f"Y{n:02d}" for n in range(1, 13)]
LAST_PRIMARY = YEARS.index("Y06")
RETRIES = 3


@dataclass
class School:
    code: str
    name: str
    primary: bool
    secondary: bool
    lat: float
    lon: float


def _title(name: str) -> str:
    return " ".join(w.capitalize() for w in name.split())


def _school(p: dict, bbox: BBox) -> School | None:
    if p.get("sector") != "GOVERNMENT" or p.get("lowyear") not in YEARS or p.get("highyear") not in YEARS:
        return None
    lat, lon = p["latitude"], p["longitude"]
    if not (bbox.min_lon <= lon <= bbox.max_lon and bbox.min_lat <= lat <= bbox.max_lat):
        return None
    low, high = YEARS.index(p["lowyear"]), YEARS.index(p["highyear"])
    primary, secondary = low <= LAST_PRIMARY, high > LAST_PRIMARY
    return School(p["code"], _title(p["schoolname"]), primary, secondary, lat, lon)


def fetch_schools(bbox: BBox, session=requests) -> list[School]:
    out, offset = [], 0
    while True:
        r = session.get(SLIP_SCHOOLS, params={"where": "1=1", "outFields": "*", "outSR": 4326, "f": "geojson",
                                              "resultOffset": offset, "orderByFields": "objectid"}, timeout=60)
        r.raise_for_status()
        body = r.json()
        feats = body.get("features", [])
        out += [s for f in feats if (s := _school(f["properties"], bbox))]
        offset += len(feats)
        if not body.get("exceededTransferLimit") or not feats:
            return out


def _get(session, url: str, params: dict) -> bytes:
    for attempt in range(RETRIES + 1):
        try:
            r = session.get(url, params=params, timeout=60)
            if r.status_code == 404:  # the school has no such map
                return b""
            if r.status_code < 500:
                r.raise_for_status()
                return r.content
        except (requests.ConnectionError, requests.Timeout):
            if attempt == RETRIES:
                raise
        if attempt == RETRIES:
            raise requests.HTTPError(f"{url} {params}: HTTP {r.status_code}")
        time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def download_maps(codes: list[str], dest: Path, workers: int = 8, session=None) -> dict[str, list[Path]]:
    """Each school's intake maps (`<code>_1.pdf`, `<code>_2.pdf`); cached results, PDF or known-absent, are reused."""
    dest.mkdir(parents=True, exist_ok=True)
    local = threading.local()

    def sess():
        if session is not None:
            return session
        if not hasattr(local, "s"):
            local.s = requests.Session()
        return local.s

    def one(code: str, n: int) -> Path | None:
        pdf, none = dest / f"{code}_{n}.pdf", dest / f"{code}_{n}.none"
        if pdf.exists():
            return pdf
        if none.exists():
            return None
        body = _get(sess(), INTAKE_MAP, {"schoolID": code, "fileType": f"INTAKE_MAP0{n}", "yearID": "_NA"})
        if not body.startswith(b"%PDF"):
            none.touch()
            return None
        tmp = pdf.with_suffix(".part")
        tmp.write_bytes(body)
        tmp.rename(pdf)
        return pdf

    jobs = [(c, n) for c in codes for n in (1, 2)]
    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(lambda j: one(*j), jobs))
    out: dict[str, list[Path]] = {}
    for (code, _), path in zip(jobs, results):
        if path:
            out.setdefault(code, []).append(path)
    log(f"intake maps: {sum(len(v) for v in out.values())} PDFs for {len(out)}/{len(codes)} schools")
    return out


INTAKE_MAGIC, INTAKE_VERSION = b"PMI1", 1
NO_SCHOOL = 0xFFFF
SIMPLIFY_M = 5
SOURCE = ("Local intake areas © Department of Education WA, CC BY 4.0, derived from DoE intake maps; "
          "school locations DET-024, CC BY-NC 4.0")
_TO_M = Transformer.from_crs("EPSG:4326", "EPSG:7850", always_xy=True)
_FROM_M = Transformer.from_crs("EPSG:7850", "EPSG:4326", always_xy=True)


def encode_intake(primary: np.ndarray, secondary: np.ndarray, meta: GridMeta) -> bytes:
    header = struct.pack("<4sHII", INTAKE_MAGIC, INTAKE_VERSION, meta.width, meta.height)
    return gzip.compress(header + primary.astype("<u2").tobytes() + secondary.astype("<u2").tobytes(), 9)


def decode_intake(b: bytes) -> tuple[np.ndarray, np.ndarray]:
    raw = gzip.decompress(b)
    magic, version, w, h = struct.unpack_from("<4sHII", raw)
    if magic != INTAKE_MAGIC or version != INTAKE_VERSION:
        raise ValueError("intake format")
    n, off = w * h, struct.calcsize("<4sHII")
    planes = np.frombuffer(raw, dtype="<u2", count=2 * n, offset=off)
    return planes[:n].copy(), planes[n:].copy()


def rasterise(meta: GridMeta, polys: list[tuple[int, Polygon]]) -> tuple[np.ndarray, dict[int, int]]:
    """School index per lattice point inside its polygon; first claim wins. Also cells each school shares."""
    xs = meta.min_lon + np.arange(meta.width) * meta.spacing
    ys = meta.min_lat + np.arange(meta.height) * meta.spacing
    plane = np.full(meta.width * meta.height, NO_SCHOOL, dtype=np.uint16)
    overlaps: dict[int, int] = {}
    for i, poly in polys:
        x0, y0, x1, y1 = poly.bounds
        cx = np.nonzero((xs >= x0) & (xs <= x1))[0]
        cy = np.nonzero((ys >= y0) & (ys <= y1))[0]
        if not len(cx) or not len(cy):
            continue
        gx, gy = np.meshgrid(cx, cy)
        inside = shapely.contains_xy(poly, xs[gx], ys[gy])
        cells = (gy * meta.width + gx)[inside]
        taken = plane[cells] != NO_SCHOOL
        for other, n in zip(*np.unique(plane[cells][taken], return_counts=True)):
            overlaps[int(other)] = overlaps.get(int(other), 0) + int(n)
            overlaps[i] = overlaps.get(i, 0) + int(n)
        plane[cells[~taken]] = i
    return plane, overlaps


def _simplified(poly: Polygon) -> dict:
    m = transform(_TO_M.transform, poly).simplify(SIMPLIFY_M, preserve_topology=True)
    geom = mapping(transform(_FROM_M.transform, m))
    return json.loads(json.dumps(geom), parse_float=lambda v: round(float(v), 5))


def _feature(i: int, kind: str, poly: Polygon) -> dict:
    return {"type": "Feature", "properties": {"i": i, "kind": kind}, "geometry": _simplified(poly)}


def build(web: Path, results: Path, cache: Path, meta: GridMeta, workers: int = 8) -> None:
    found = fetch_schools(GRID_BBOX)
    log(f"{len(found)} public schools in the mapped area")
    maps = download_maps([s.code for s in found], cache, workers=workers)
    features, qa, has_intake = [], [], []
    by_level: dict[str, list[tuple[int, Polygon]]] = {"P": [], "S": []}
    for i, s in enumerate(found):
        rings, main, optional = [], None, []
        for pdf in maps.get(s.code, []):
            try:
                rings += intake.boundary_rings(pdf)
            except Exception as e:  # a damaged or non-Geo PDF: this school just has no area
                log(f"  {s.code} {pdf.name}: {e}")
        method = ""
        if rings:
            main, optional = intake.select_intake(rings, (s.lon, s.lat))
            method = "vector" if main is not None else ""
        else:  # older ArcMap exports have the boundary only in the image
            for pdf in maps.get(s.code, []):
                try:
                    main = intake.raster_intake(pdf, (s.lon, s.lat))
                except Exception as e:
                    log(f"  {s.code} {pdf.name} (raster): {e}")
                if main is not None:
                    method = "raster"
                    break
        has_intake.append(main is not None)
        if main is not None:
            features += [_feature(i, "main", main)] + [_feature(i, "optional", o) for o in optional]
            if s.primary:
                by_level["P"].append((i, main))
            if s.secondary:
                by_level["S"].append((i, main))
        area = round(transform(_TO_M.transform, main).area / 1e6, 3) if main is not None else ""
        qa.append([s.code, s.name, len(maps.get(s.code, [])), len(rings), main is not None, area, method])
    primary, p_over = rasterise(meta, by_level["P"])
    secondary, s_over = rasterise(meta, by_level["S"])

    web.mkdir(parents=True, exist_ok=True)
    levels = lambda s: ("P" if s.primary else "") + ("S" if s.secondary else "")
    write_json(web / "schools.json", {"asOf": date.today().isoformat(), "source": SOURCE, "schools": [
        [s.code, s.name, levels(s), s.lat, s.lon, has] for s, has in zip(found, has_intake)]})
    write_json(web / "intake.json", {"type": "FeatureCollection", "features": features})
    # gzipped, but not named .gz: dev/static servers add Content-Encoding: gzip from the extension
    (web / "intake.bin").write_bytes(encode_intake(primary, secondary, meta))
    with open(results / "intake_qa.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["code", "name", "maps", "rings", "main_found", "area_km2", "overlaps", "method"])
        for i, row in enumerate(qa):
            w.writerow(row[:-1] + [p_over.get(i, 0) + s_over.get(i, 0), row[-1]])
    overlapping = sum(1 for i in range(len(found)) if p_over.get(i) or s_over.get(i))
    log(f"intake: {sum(has_intake)}/{len(found)} schools with an area, {overlapping} overlapping (intake_qa.csv)")


def web_grid_meta() -> GridMeta:
    """The travel-time grid the web app already uses, so intake cells line up with it."""
    index = WEB / "index.json"
    if index.exists():
        g = json.loads(index.read_text())["grid"]
        return GridMeta(g["width"], g["height"], g["minLon"], g["minLat"], g["spacing"])
    return grid_meta(0.001)


def schools_stage(args: argparse.Namespace) -> None:
    cache = INPUT / "intake"
    if args.force:
        for p in cache.glob("*.none"):
            p.unlink()
    RESULTS.mkdir(parents=True, exist_ok=True)
    build(WEB, RESULTS, cache, web_grid_meta(), workers=args.workers)
