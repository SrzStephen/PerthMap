import numpy as np
import pytest
import requests
from pyproj import Transformer
from shapely.geometry import LineString, Point, box

import attrs
from pipeline import BBox, GridMeta

TOY = GridMeta(20, 20, 0.0, 0.0, 0.001)
PERTH = GridMeta(20, 20, 115.86, -31.95, 0.001)
TO_M = Transformer.from_crs("EPSG:4326", "EPSG:7850", always_xy=True)


def centre_m(meta: GridMeta, ix: int, iy: int) -> tuple[float, float]:
    return TO_M.transform(meta.min_lon + ix * meta.spacing, meta.min_lat + iy * meta.spacing)


def test_roundtrip():
    n = TOY.width * TOY.height
    fields = {"bushfire": (np.arange(n) % 2).astype(np.uint8), "power_m": np.arange(n, dtype=np.uint16) * 7}
    shape, out = attrs.decode_attrs(attrs.encode_attrs(fields, TOY))
    assert shape == (20, 20)
    assert list(out) == ["bushfire", "power_m"]
    for k in fields:
        assert out[k].dtype == fields[k].dtype
        np.testing.assert_array_equal(out[k], fields[k])


def test_encode_rejects_bad_plane():
    with pytest.raises(ValueError):
        attrs.encode_attrs({"x": np.zeros(399, np.uint8)}, TOY)
    with pytest.raises(ValueError):
        attrs.encode_attrs({"x": np.zeros(400, np.float32)}, TOY)


def test_inside_code_overlap():
    a = box(-0.0005, -0.0005, 0.0095, 0.0095)
    b = box(0.0045, 0.0045, 0.0145, 0.0145)
    plane = attrs.inside_code(TOY, [(2, a), (1, b)]).reshape(20, 20)
    assert plane.dtype == np.uint8
    assert plane[7, 7] == 1  # shared: lowest code wins
    assert plane[2, 2] == 2
    assert plane[12, 12] == 1
    assert np.count_nonzero(plane) == 100 + 100 - 25


def test_distance_cap():
    pt = Point(centre_m(PERTH, 10, 10))
    plane = attrs.distance_m(PERTH, [pt], cap=300).reshape(20, 20)
    assert plane.dtype == np.uint16
    assert plane[10, 10] == 0
    assert 90 <= plane[10, 11] <= 100
    assert plane[0, 0] == 300


def test_max_within():
    c = centre_m(PERTH, 5, 5)
    far = centre_m(PERTH, 18, 18)
    lines = [(12, LineString([(c[0] - 50, c[1]), (c[0] + 50, c[1])])),
             (30, LineString([(c[0], c[1] - 50), (c[0], c[1] + 50)])),
             (300, LineString([(far[0] - 10, far[1]), (far[0] + 10, far[1])]))]
    plane = attrs.max_within(PERTH, lines, radius=50).reshape(20, 20)
    assert plane.dtype == np.uint8
    assert plane[5, 5] == 30
    assert plane[12, 2] == 0
    assert plane[18, 18] == 255


class Resp:
    def __init__(self, body):
        self.status_code, self._body = 200, body

    def json(self):
        return self._body

    def raise_for_status(self):
        pass


class Session:
    def __init__(self, bodies):
        self.bodies, self.calls = list(bodies), []

    def get(self, url, params=None, timeout=None):
        self.calls.append(params)
        return Resp(self.bodies.pop(0))


FEAT = {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [0, 0]}}
BB = BBox(115.0, -33.0, 116.0, -31.0)


def test_fetch_pages():
    s = Session([{"features": [FEAT, FEAT], "exceededTransferLimit": True}, {"features": [FEAT]}])
    out = attrs.fetch_arcgis("http://x/query", BB, session=s)
    assert len(out) == 3
    assert s.calls[1]["resultOffset"] == 2
    p = s.calls[0]
    assert p["outSR"] == 4326 and p["f"] == "geojson" and p["geometryType"] == "esriGeometryEnvelope"


def test_fetch_error_body():
    with pytest.raises(RuntimeError):
        attrs.fetch_arcgis("http://x/query", BB, session=Session([{"error": {"code": 400}}]))


def test_fetch_empty_raises():
    with pytest.raises(RuntimeError):
        attrs.fetch_arcgis("http://x/query", BB, session=Session([{"features": []}]))
