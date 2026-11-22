import json

import geopandas as gpd
import numpy as np
from shapely.geometry import Point, box

import amenities


def test_classify():
    c = amenities.classify
    assert c({"shop": "supermarket"}) == "supermarket"
    assert c({"leisure": "park"}) == "park"
    assert c({"railway": "station"}) == "station"
    assert c({"amenity": "doctors"}) == "gp"
    assert c({"healthcare": "doctor"}) == "gp"
    assert c({"amenity": "pharmacy", "healthcare": "pharmacy"}) == "pharmacy"
    assert c({"amenity": "kindergarten"}) == "childcare"
    assert c({"amenity": "cafe"}) == "cafe"
    assert c({"leisure": "playground"}) == "playground"
    assert c({"amenity": "bench"}) is None
    assert c({"shop": np.nan, "amenity": "library"}) == "library"  # osmium leaves missing tags as NaN


def fake_osm(src, filters, geometry, name):
    return gpd.GeoDataFrame({
        "shop": ["supermarket", None, None, None],
        "leisure": [None, "park", "park", None],
        "amenity": [None, None, None, "pharmacy"],
        "name": ["Coles Wembley", "Big Park", "Verge", None],
    }, geometry=[
        Point(115.81, -31.93),
        box(115.82, -31.94, 115.83, -31.93),  # ~1 km²
        box(115.84, -31.94, 115.8401, -31.9399),  # ~100 m²: dropped
        Point(116.5, -31.9),  # outside the grid box: dropped
    ], crs="EPSG:4326")


def test_build_writes_json(tmp_path):
    amenities.build(tmp_path, osm=fake_osm)
    out = json.loads((tmp_path / "amenities.json").read_text())
    ids = [t[0] for t in out["types"]]
    assert ids == [t[0] for t in amenities.TYPES]
    assert out["source"].startswith("© OpenStreetMap contributors")
    rows = sorted(out["items"], key=lambda r: r[0])
    assert [(ids[r[0]], r[3]) for r in rows] == [("supermarket", "Coles Wembley"), ("park", "Big Park")]
    t, lat, lon, _ = rows[1]
    assert -31.94 < lat < -31.93 and 115.82 < lon < 115.83  # a point inside the park
