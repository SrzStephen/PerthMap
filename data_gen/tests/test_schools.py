from pathlib import Path

import pytest
import requests

import schools
from pipeline import BBox

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


def test_download_retries_5xx(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(schools.time, "sleep", lambda s: None)
    s = FakeSession([Resp(503), Resp(503), Resp(content=b"%PDF ok"), Resp(content=b"<html/>")])
    got = schools.download_maps(["C"], tmp_path, workers=1, session=s)
    assert got == {"C": [tmp_path / "C_1.pdf"]}
    assert len(s.calls) == 4
