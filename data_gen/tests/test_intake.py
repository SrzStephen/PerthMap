import json
from pathlib import Path

import pymupdf
import pytest
import shapely
from pyproj import Geod
from shapely.geometry import box, shape
from shapely.ops import transform, unary_union
from pyproj import Transformer

import intake

FIX = Path(__file__).parent / "fixtures"
PDF = FIX / "intake_5464.pdf"
POC = json.loads((FIX / "intake_5464.geojson").read_text())
GEOD = Geod(ellps="WGS84")
TO_MGA = Transformer.from_crs("EPSG:4326", "EPSG:7850", always_xy=True)


def area_km2(g) -> float:
    return transform(TO_MGA.transform, g).area / 1e6


def test_georef_residual():
    doc = pymupdf.open(PDF)
    f = intake.georef(doc)
    for (x, y), (lon, lat) in intake.geo_corners(doc):
        glon, glat = f(x, y)
        _, _, d = GEOD.inv(lon, lat, glon, glat)
        assert d < 1.0


def test_boundary_matches_poc():
    got = unary_union([r.poly for r in intake.boundary_rings(PDF)])
    want = shape(POC["features"][0]["geometry"])
    iou = got.intersection(want).area / got.union(want).area
    assert iou > 0.98


def test_select_intake_wembley():
    want = shape(POC["features"][0]["geometry"])
    pt = want.representative_point()
    main, _ = intake.select_intake(intake.boundary_rings(PDF), (pt.x, pt.y))
    assert main is not None
    assert area_km2(main) == pytest.approx(2.1, abs=0.2)


def test_select_intake_picks_smallest_containing():
    big, small = box(-0.05, -0.05, 0.05, 0.05), box(-0.005, -0.005, 0.005, 0.005)
    main, optional = intake.select_intake([intake.Ring(big), intake.Ring(small)], (0.0, 0.0))
    assert main.equals(small)


def test_select_intake_hatched_is_optional_plain_neighbour_dropped():
    main_ring = box(0, 0, 0.01, 0.01)
    annex = box(0.01, 0, 0.012, 0.01)      # hatched: an optional area
    neighbour = box(0.01, 0.01, 0.02, 0.02)  # touches main but plain: another school's area
    rings = [intake.Ring(main_ring), intake.Ring(annex, hatched=True), intake.Ring(neighbour)]
    main, optional = intake.select_intake(rings, (0.005, 0.005))
    assert main.equals(main_ring)
    assert [o.equals(annex) for o in optional] == [True]


def test_select_intake_far_scrap_is_none():
    # Swan View PS (5428): the only plain ring is a 1.6 km x 90 m scrap ~1.5 km from the school.
    scrap = box(115.81, -31.95, 115.826, -31.9492)
    assert intake.select_intake([intake.Ring(scrap)], (115.80, -31.95)) == (None, [])


def test_select_intake_near_ring_still_used():
    # a school just outside its own drawn area (e.g. across the boundary road) keeps it
    area = box(115.801, -31.96, 115.82, -31.94)  # ~95 m east of the school, ~4 km²
    main, _ = intake.select_intake([intake.Ring(area)], (115.80, -31.95))
    assert main is not None and main.equals(area)


def test_rings_carry_their_level_from_the_layer():
    assert {r.level for r in intake.boundary_rings(PDF)} == {"P"}  # LocalIntakeAreas_PS


def test_select_intake_none_when_far():
    main, optional = intake.select_intake([intake.Ring(box(1, 1, 1.01, 1.01))], (0.0, 0.0))
    assert main is None and optional == []


def test_outline_followed_by_clip_is_optional():
    # Hatched (optional / conditional) areas are clipped to their outline; drawing order varies between maps.
    layer = "LocalIntakeAreas_HS"
    outline = {"type": "s", "layer": layer, "items": [("l", None, None)] * 30}
    hatch = {"type": "s", "layer": layer, "items": [("l",)], "rect": pymupdf.Rect(0, 0, 900, 900)}
    seq = [
        dict(outline, id="opt", rect=pymupdf.Rect(10, 10, 50, 50)),
        dict(outline, id="main", rect=pymupdf.Rect(0, 0, 400, 400)),
        {"type": "clip", "layer": layer, "scissor": pymupdf.Rect(10.2, 10, 50, 49.8)}, hatch,
        {"type": "s", "layer": "Legend", "items": [("l",)] * 30, "rect": pymupdf.Rect(0, 0, 400, 400)},
    ]
    got = [(d["id"], hatched) for d, hatched in intake.boundary_paths(seq)]
    assert got == [("opt", True), ("main", False)]


def test_clip_without_layer_still_marks_optional():
    # Churchlands SHS (4012): the hatch clips carry no layer name.
    outline = {"type": "s", "layer": "LocalIntakeAreas_HS", "items": [("l", None, None)] * 30,
               "rect": pymupdf.Rect(252.1, 45.1, 594.0, 311.1)}
    seq = [outline, {"type": "clip", "layer": "", "scissor": pymupdf.Rect(252.14, 45.11, 593.96, 311.15)}]
    assert [h for _, h in intake.boundary_paths(seq)] == [True]


RASTER = FIX / "intake_5103_raster.pdf"  # City Beach PS: ArcMap 10.6, boundary baked into the image
CITY_BEACH_PS = (115.76512599, -31.93538508)


def test_raster_map_has_no_vector_rings():
    assert intake.boundary_rings(RASTER) == []


def test_raster_intake_city_beach():
    poly = intake.raster_intake(RASTER, CITY_BEACH_PS)
    assert poly is not None and poly.is_valid
    assert poly.contains(shapely.Point(CITY_BEACH_PS))
    x0, y0, x1, y1 = poly.bounds
    assert 115.74 < x0 and x1 < 115.80 and -31.98 < y0 and y1 < -31.90
    assert 2 < area_km2(poly) < 12


def test_raster_intake_outside_any_boundary_is_none():
    assert intake.raster_intake(RASTER, (115.70, -31.94)) is None  # out at sea: the fill leaks to the map edge


def test_not_geopdf(tmp_path):
    doc = pymupdf.open()
    doc.new_page()
    p = tmp_path / "plain.pdf"
    doc.save(p)
    with pytest.raises(ValueError, match="not a GeoPDF"):
        intake.georef(pymupdf.open(p))
