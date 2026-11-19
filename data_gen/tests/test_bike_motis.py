import math
from pathlib import Path

import numpy as np

import pipeline
from pipeline import Motis, motis_config


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def post(self, url, json=None, timeout=None):
        self.calls.append(("post", url, json))
        return FakeResponse(self.payload)

    def get(self, url, params=None, timeout=None):
        self.calls.append(("get", url, params))
        return FakeResponse(self.payload)


def motis_with(payload):
    m = Motis("http://motis:8080")
    m.s = FakeSession(payload)
    return m


def test_bike_times_request():
    m = motis_with([{"duration": 60.0}, None])
    out = m.bike_times(pipeline.WORK, np.array([[-32.0, 115.8], [-32.1, 115.9]]), 10800, 100)
    _, url, body = m.s.calls[0]
    assert url.endswith("/api/v1/one-to-many")
    assert body["mode"] == "BIKE" and body["arriveBy"] is True and body["max"] == 10800
    assert body["maxMatchingDistance"] == 100
    assert out[0] == 60.0 and math.isnan(out[1])


def test_bike_plan_returns_leg():
    leg = {"mode": "BIKE", "duration": 100, "distance": 420.0, "steps": []}
    m = motis_with({"direct": [{"legs": [leg]}]})
    assert m.bike_plan((-32.0, 115.8), 10800) == leg
    _, url, params = m.s.calls[0]
    assert url.endswith("/api/v5/plan")
    assert params["directModes"] == "BIKE" and params["transitModes"] == ""
    assert params["maxDirectTime"] == 10800
    assert params["fromPlace"] == "-32.0,115.8"


def test_bike_plan_no_direct():
    assert motis_with({"direct": []}).bike_plan((-32.0, 115.8), 10800) is None


def test_prepare_config_limit():
    cfg = motis_config(Path("/data/input/perth.osm.pbf"), Path("/data/input/gtfs.zip"), 8)
    assert "street_routing_max_direct_seconds: 10800" in cfg
    assert "n_threads: 8" in cfg


def test_srtm_tiles():
    assert pipeline.SRTM_TILES == ["S32E115", "S33E115", "S32E116", "S33E116"]
    assert pipeline.srtm_url("S33E116") == "https://s3.amazonaws.com/elevation-tiles-prod/skadi/S33/S33E116.hgt.gz"
