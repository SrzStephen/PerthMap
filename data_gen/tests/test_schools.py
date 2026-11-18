import json
from pathlib import Path

import numpy as np
import pytest
import requests
from shapely.geometry import box, shape

import schools
from pipeline import BBox, GridMeta, grid_meta

FIX = Path(__file__).parent / "fixtures"

BB = BBox(115.0, -33.0, 116.0, -31.0)


class Resp:
    def __init__(self, status=200, json=None, content=b""):
        self.status_code, self._json, self.content = status, json, content

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))


class FakeSession:
    def __init__(self, responses):
        self.responses, self.calls = list(responses), []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, dict(params or {})))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def feature(code, low="PKG", high="Y06", sector="GOVERNMENT", lat=-32.0, lon=115.8, name="WEMBLEY PRIMARY SCHOOL"):
    return {"properties": {"code": code, "schoolname": name, "sector": sector, "lowyear": low, "highyear": high,
                           "latitude": lat, "longitude": lon}}


def page(features, more):
    return Resp(json={"features": features, "exceededTransferLimit": more} if more else {"features": features})


def test_fetch_schools_pages():
    s = FakeSession([page([feature("1"), feature("2")], True), page([feature("3")], False)])
    got = schools.fetch_schools(BB, session=s)
    assert [x.code for x in got] == ["1", "2", "3"]
    assert s.calls[1][1]["resultOffset"] == 2
    assert got[0].name == "Wembley Primary School"


def test_levels():
    s = FakeSession([page([
        feature("p", "PKG", "Y06"), feature("s", "Y07", "Y12"), feature("k", "KIN", "Y12"),
        feature("n", sector="NON-GOVERNMENT"), feature("far", lat=-20.0),
    ], False)])
    got = {x.code: (x.primary, x.secondary) for x in schools.fetch_schools(BB, session=s)}
    assert got == {"p": (True, False), "s": (False, True), "k": (True, True)}


def test_download_skips_cached_and_non_pdf(tmp_path: Path):
    (tmp_path / "A_1.pdf").write_bytes(b"%PDF cached")
    (tmp_path / "A_2.none").write_bytes(b"")  # known absent from an earlier run
    s = FakeSession([Resp(content=b"<html>no map</html>"), Resp(content=b"%PDF-1.7 map")])
    got = schools.download_maps(["A", "B"], tmp_path, workers=1, session=s)
    assert got == {"A": [tmp_path / "A_1.pdf"], "B": [tmp_path / "B_2.pdf"]}
    assert len(s.calls) == 2  # only B's two maps were requested
    assert not (tmp_path / "B_1.pdf").exists()


def test_download_404_means_no_map(tmp_path: Path):
    s = FakeSession([Resp(content=b"%PDF map"), Resp(404)])
    assert schools.download_maps(["D"], tmp_path, workers=1, session=s) == {"D": [tmp_path / "D_1.pdf"]}
    assert (tmp_path / "D_2.none").exists()


TOY = GridMeta(20, 20, 0.0, 0.0, 0.001)


def test_intake_bin_roundtrip():
    p = np.arange(400, dtype=np.uint16)
    s = np.full(400, schools.NO_SCHOOL, dtype=np.uint16)
    s[7] = 3
    gp, gs = schools.decode_intake(schools.encode_intake(p, s, TOY))
    assert (gp == p).all() and (gs == s).all()


def test_rasterise_square():
    plane, overlaps = schools.rasterise(TOY, [(4, box(-0.0005, -0.0005, 0.0095, 0.0095))])
    assert (plane == 4).sum() == 100
    assert (plane == schools.NO_SCHOOL).sum() == 300
    assert plane[0] == 4 and plane[9 * 20 + 9] == 4 and plane[10] == schools.NO_SCHOOL
    assert overlaps == {}


def test_rasterise_overlap_counts():
    a = box(-0.0005, -0.0005, 0.0045, 0.0095)  # columns 0-4
    b = box(0.0035, -0.0005, 0.0095, 0.0095)   # columns 4-9: column 4 shared, 10 cells
    plane, overlaps = schools.rasterise(TOY, [(1, a), (2, b)])
    assert plane[4] == 1  # first claim wins
    assert overlaps == {1: 10, 2: 10}


def test_rasterise_smaller_area_wins_overlap():
    big = box(-0.0005, -0.0005, 0.0095, 0.0095)  # e.g. Shenton's 2018 map
    carve = box(-0.0005, -0.0005, 0.0025, 0.0025)  # a newer school carved out of it
    plane, _ = schools.rasterise(TOY, [(1, big), (2, carve)])
    assert plane[0] == 2 and plane[9] == 1


def test_stage_writes_outputs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    poc = shape(json.loads((FIX / "intake_5464.geojson").read_text())["features"][0]["geometry"])
    pt = poc.representative_point()
    wembley = schools.School("5464", "Wembley Primary School", True, False, pt.y, pt.x)
    monkeypatch.setattr(schools, "fetch_schools", lambda bbox: [wembley])
    monkeypatch.setattr(schools, "download_maps", lambda codes, dest, workers: {"5464": [FIX / "intake_5464.pdf"]})
    web, results = tmp_path / "web", tmp_path
    meta = grid_meta(0.001)
    schools.build(web, results, tmp_path / "cache", meta, workers=1)

    sj = json.loads((web / "schools.json").read_text())
    assert sj["schools"] == [["5464", "Wembley Primary School", "P", pt.y, pt.x, True]]
    fc = json.loads((web / "intake.json").read_text())
    assert {f["properties"]["kind"] for f in fc["features"]} == {"main"}
    primary, secondary = schools.decode_intake((web / "intake.bin").read_bytes())
    assert 160 < (primary == 0).sum() < 220  # ~2.0 km² at ~0.0105 km² (94 m x 111 m) per 0.001° cell
    assert (secondary == schools.NO_SCHOOL).all()
    qa = (results / "intake_qa.csv").read_text().splitlines()
    assert qa[0] == "code,name,maps,rings,main_found,area_km2,overlaps,method"
    assert qa[1].startswith("5464,") and qa[1].endswith(",vector")


def test_stage_falls_back_to_raster(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    city_beach = schools.School("5103", "City Beach Primary School", True, False, -31.93538508, 115.76512599)
    monkeypatch.setattr(schools, "fetch_schools", lambda bbox: [city_beach])
    monkeypatch.setattr(schools, "download_maps",
                        lambda codes, dest, workers: {"5103": [FIX / "intake_5103_raster.pdf"]})
    schools.build(tmp_path / "web", tmp_path, tmp_path / "cache", grid_meta(0.001), workers=1)
    sj = json.loads((tmp_path / "web" / "schools.json").read_text())
    assert sj["schools"][0][5] is True
    assert (tmp_path / "intake_qa.csv").read_text().splitlines()[1].endswith(",raster")


def test_download_retries_5xx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(schools.time, "sleep", lambda s: None)
    s = FakeSession([Resp(503), Resp(503), Resp(content=b"%PDF ok"), Resp(content=b"<html/>")])
    got = schools.download_maps(["C"], tmp_path, workers=1, session=s)
    assert got == {"C": [tmp_path / "C_1.pdf"]}
    assert len(s.calls) == 4
