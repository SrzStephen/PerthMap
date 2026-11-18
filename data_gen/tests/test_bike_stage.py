import argparse
import json

import numpy as np
import pytest

import bike as bike_mod
import pipeline
from bike import bike_mismatch, decode_bike_grid, ref_speed_kmh
from pipeline import BBox, encode_polyline, to_metres


def test_ref_speed():
    legs = [{"distance": 17862.0, "duration": 4257}, {"distance": 9831.0, "duration": 2343},
            {"distance": 28752.0, "duration": 6870}]
    assert ref_speed_kmh(legs) == 15.11


def test_bike_mismatch():
    assert bike_mismatch(np.array([100.0, 200, np.nan]), np.array([110.0, 400, 50])) == 0.5
    assert bike_mismatch(np.array([np.nan]), np.array([np.nan])) is None


class FakeMotis:
    def __init__(self, url):
        pass

    def bike_times(self, one, many, max_s, max_match_m):
        a = to_metres(many[:, 0], many[:, 1])
        b = to_metres(np.array([one[0]]), np.array([one[1]]))
        return np.hypot(*(a - b).T) / 4.2

    def bike_plan(self, frm, max_s):
        mid = ((frm[0] + pipeline.WORK[0]) / 2, frm[1])
        steps = [
            {"polyline": {"points": encode_polyline([frm, mid], 6), "precision": 6}, "toOsmNode": 1},
            {"polyline": {"points": encode_polyline([mid, pipeline.WORK], 6), "precision": 6}, "toOsmNode": 2},
        ]
        return {"duration": 420, "distance": 1764.0, "steps": steps}


def test_stage_writes_files(tmp_path, monkeypatch):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.json").write_text(json.dumps({"version": 1, "hours": [6], "mismatchRate": {}}))
    walkways = tmp_path / "walkways.parquet"
    walkways.write_text("x")
    monkeypatch.setattr(pipeline, "WEB", web)
    monkeypatch.setattr(pipeline, "WALKWAYS", walkways)
    monkeypatch.setattr(pipeline, "WATER", tmp_path / "missing-water.parquet")
    monkeypatch.setattr(pipeline, "SRTM_DIR", tmp_path / "srtm")
    monkeypatch.setattr(pipeline, "GRID_BBOX", BBox(115.850, -31.960, 115.855, -31.955))
    monkeypatch.setattr(pipeline, "Motis", FakeMotis)
    monkeypatch.setattr(pipeline, "walkable", lambda grid, m: np.ones(len(grid), bool))

    args = argparse.Namespace(motis_url="http://x", spacing=0.001, snap=100, walkable_within=75, workers=2,
                              bike_block=5)
    bike_mod.bike(args)

    meta = pipeline.grid_meta(0.001)
    g = decode_bike_grid((web / "bike.grid.bin").read_bytes())
    assert g["seconds"].size == meta.width * meta.height
    assert (g["seconds"] != 0xFFFF).all()
    routes = json.loads((web / "bike.routes.json").read_text())
    assert routes["refSpeedKmh"] == pytest.approx(15.12)
    assert set(routes) == {"refSpeedKmh", "shapes", "lengths", "elev", "paths"}
    assert routes["elev"] == [None] * len(routes["shapes"])  # no SRTM tiles
    assert (g["path"] < len(routes["paths"])).all()
    index = json.loads((web / "index.json").read_text())
    assert index["hours"] == [6]
    assert index["bike"]["refSpeedKmh"] == pytest.approx(15.12)
    assert set(index["bike"]) == {"refSpeedKmh", "mismatchRate", "missingRate"}


def test_stage_needs_index(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "WEB", tmp_path)
    args = argparse.Namespace(motis_url="http://x", spacing=0.001, snap=100, walkable_within=75, workers=2,
                              bike_block=5)
    with pytest.raises(SystemExit, match="run the `route` stage first"):
        bike_mod.bike(args)
