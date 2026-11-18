"""Local intake area boundaries from Department of Education WA intake-map GeoPDFs.

The maps are Esri GeoPDFs: the page's viewport carries a /Measure /GEO dictionary whose GPTS (lat, lon) and LPTS
(unit square inside the viewport /BBox) pin four corners, in GDA94 / MGA zone 50. The boundary itself is a vector
path in a layer named LocalIntakeAreas_PS (primary) or _HS (secondary); optional areas are extra rings in that layer
filled with single-segment hatch strokes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import pymupdf
from pyproj import Transformer
from scipy import ndimage
from shapely.geometry import Point, Polygon
from skimage import measure
from shapely.ops import transform

BOUNDARY_RGB = (0.0, 0.149, 0.451)
MGA50 = "EPSG:28350"  # GDA94 / MGA zone 50, as the maps declare
_TO_MGA = Transformer.from_crs("EPSG:4326", MGA50, always_xy=True)
_FROM_MGA = Transformer.from_crs(MGA50, "EPSG:4326", always_xy=True)
_TO_M = Transformer.from_crs("EPSG:4326", "EPSG:7850", always_xy=True)
NEAR_M = 250  # a school just outside every ring (e.g. across the boundary road) owns the nearest ring this close
NEAR_MIN_KM2 = 0.3  # ...if it is a real area, not a scrap of boundary


@dataclass
class Ring:
    poly: Polygon  # lon, lat
    hatched: bool = False
    level: str | None = None  # "P" / "S" from the layer name (LocalIntakeAreas_PS / _HS)


def _level(layer: str) -> str | None:
    layer = layer.upper()
    return "P" if layer.endswith("_PS") else "S" if layer.endswith("_HS") else None


def _floats(s: str) -> list[float]:
    return [float(v) for v in s.split()]


def geo_corners(doc: pymupdf.Document) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """The four ((x, y) page point, y from the top as PyMuPDF reports drawings; (lon, lat)) control points."""
    page = doc[0]
    obj = doc.xref_object(page.xref)
    if "/VP" not in obj:
        raise ValueError("not a GeoPDF")
    vp = obj.split("/VP", 1)[1]
    bbox = re.search(r"/BBox \[([^\]]+)\]", vp)
    measure = re.search(r"/Measure (\d+) 0 R", vp)
    mo = doc.xref_object(int(measure.group(1))) if measure else vp
    gpts = re.search(r"/GPTS \[([^\]]+)\]", mo)
    lpts = re.search(r"/LPTS \[([^\]]+)\]", mo)
    if not (bbox and gpts and lpts):
        raise ValueError("not a GeoPDF")
    x0, y0, x1, y1 = _floats(bbox.group(1))
    g, l = _floats(gpts.group(1)), _floats(lpts.group(1))
    height = page.mediabox.height
    out = []
    for (u, v), (lat, lon) in zip(zip(l[0::2], l[1::2]), zip(g[0::2], g[1::2])):
        px, py = x0 + (x1 - x0) * u, y0 + (y1 - y0) * v  # PDF user space, y up
        out.append(((px, height - py), (lon, lat)))
    return out


def _affine(doc: pymupdf.Document) -> np.ndarray:
    """3x3 matrix taking page points (x, y from the top, 1) to MGA zone 50 (E, N, 1)."""
    corners = geo_corners(doc)
    a = np.array([[x, y, 1.0] for (x, y), _ in corners])
    e, n = _TO_MGA.transform([c[1][0] for c in corners], [c[1][1] for c in corners])
    ce = np.linalg.lstsq(a, np.asarray(e), rcond=None)[0]
    cn = np.linalg.lstsq(a, np.asarray(n), rcond=None)[0]
    return np.array([ce, cn, [0.0, 0.0, 1.0]])


def georef(doc: pymupdf.Document) -> Callable[[float, float], tuple[float, float]]:
    """Page point (y from the top) -> (lon, lat), via an affine fit of the corners in MGA zone 50."""
    m = _affine(doc)

    def f(x: float, y: float) -> tuple[float, float]:
        e, n, _ = m @ (x, y, 1.0)
        return _FROM_MGA.transform(e, n)

    return f


def _is_boundary(dr: dict) -> bool:
    layer = (dr.get("layer") or "").lower()
    if "intake" in layer:
        return "legend" not in layer
    c = dr.get("color")
    return bool(c) and all(abs(a - b) < 0.02 for a, b in zip(c, BOUNDARY_RGB)) and len(dr["items"]) > 20 \
        and not layer.startswith("legend")


def _subpaths(items: list) -> list[list[tuple[float, float]]]:
    rings, ring = [], []
    for it in items:
        if it[0] == "l":
            a, b = it[1], it[2]
        elif it[0] == "c":
            a, b = it[1], it[4]
        else:
            continue
        if ring and (abs(ring[-1][0] - a.x) > 0.01 or abs(ring[-1][1] - a.y) > 0.01):
            rings.append(ring)
            ring = []
        if not ring:
            ring.append((a.x, a.y))
        ring.append((b.x, b.y))
    if ring:
        rings.append(ring)
    return rings


def boundary_paths(drawings: list[dict]) -> list[tuple[dict, bool]]:
    """Boundary outlines from `get_drawings(extended=True)`, each with whether it is an optional (hatched) area.

    ArcGIS fills an optional (or conditional) area with hatch strokes clipped to its outline, so an outline whose
    bounding box matches a clip is hatched. Drawing order and the clip's layer name vary between maps, so neither is
    used; other clips (basemap tiles, legend) are rectangles that never match an outline's box to within 1 pt.
    """
    clips = [d["scissor"] for d in drawings if d.get("type") == "clip" and d.get("scissor") is not None]

    def matches(r) -> bool:
        return any(max(abs(r.x0 - c.x0), abs(r.y0 - c.y0), abs(r.x1 - c.x1), abs(r.y1 - c.y1)) < 1.0 for c in clips)

    return [(d, matches(d["rect"])) for d in drawings
            if d.get("type") != "clip" and len(d.get("items") or []) > 20 and _is_boundary(d)]


def boundary_rings(pdf: Path) -> list[Ring]:
    """Closed boundary rings in WGS84, flagged `hatched` for optional areas."""
    doc = pymupdf.open(pdf)
    f = georef(doc)
    rings: list[Ring] = []
    for dr, hatched in boundary_paths(doc[0].get_drawings(extended=True)):
        for pts in _subpaths(dr["items"]):
            if len(pts) < 4:
                continue
            poly = Polygon([f(x, y) for x, y in pts]).buffer(0)
            if poly.is_empty:
                continue
            level = _level(dr.get("layer") or "")
            rings.extend(Ring(p, hatched, level) for p in (poly.geoms if poly.geom_type == "MultiPolygon" else [poly]))
    return rings


RASTER_DPI = 150
RASTER_RGB = np.array([0, 38, 115])  # the boundary colour once ArcMap 10.x has baked it into the image
RASTER_TOL = 50


def raster_intake(pdf: Path, school: tuple[float, float]) -> Polygon | None:
    """Fallback for maps whose boundary is only in the image (ArcMap 10.x): the region enclosed by boundary-blue
    pixels around the school, or None when the fill escapes to the page edge (no closed boundary around it)."""
    doc = pymupdf.open(pdf)
    m = _affine(doc)
    pix = doc[0].get_pixmap(dpi=RASTER_DPI, colorspace=pymupdf.csRGB, alpha=False)
    rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(int)
    line = np.abs(rgb - RASTER_RGB).max(axis=2) < RASTER_TOL
    line = ndimage.binary_dilation(line, iterations=1)  # close anti-aliasing gaps in the stroke

    scale = RASTER_DPI / 72
    e, n = _TO_MGA.transform(*school)
    px, py, _ = np.linalg.solve(m, (e, n, 1.0))
    col, row = int(round(px * scale)), int(round(py * scale))
    if not (0 <= row < pix.height and 0 <= col < pix.width):
        return None
    labels, _ = ndimage.label(~line)
    target = labels[row, col]
    if target == 0:  # the school sits on the line itself
        return None
    region = labels == target
    if region[0].any() or region[-1].any() or region[:, 0].any() or region[:, -1].any():
        return None
    region = ndimage.binary_fill_holes(region)
    contours = measure.find_contours(np.pad(region, 1).astype(float), 0.5)
    ring = max(contours, key=len) - 1  # undo the padding; (row, col)
    poly = Polygon([georef(doc)(c / scale, r / scale) for r, c in ring]).buffer(0)
    if poly.geom_type == "MultiPolygon":
        poly = max(poly.geoms, key=lambda p: p.area)
    return poly if poly.contains(Point(school)) else None


def select_intake(rings: list[Ring], school: tuple[float, float]) -> tuple[Polygon | None, list[Polygon]]:
    """The school's own (main) ring and its optional (hatched) rings; other rings are neighbours' areas."""
    pt = Point(school)
    plain = [r.poly for r in rings if not r.hatched]
    containing = [p for p in plain if p.contains(pt)]
    if containing:
        main = min(containing, key=lambda p: p.area)
    else:
        pm = transform(_TO_M.transform, pt)
        metric = [transform(_TO_M.transform, p) for p in plain]
        near = [(m.distance(pm), i) for i, m in enumerate(metric) if m.area / 1e6 >= NEAR_MIN_KM2]
        near = [(d, i) for d, i in near if d <= NEAR_M]
        if not near:
            return None, []
        main = plain[min(near)[1]]
    return main, [r.poly for r in rings if r.hatched]
