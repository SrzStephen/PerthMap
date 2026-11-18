import json
from datetime import datetime
from pathlib import Path

import numpy as np

from pipeline import (PERTH, RouteTables, best_itinerary, build_routes, decode_polyline, encode_polyline,
                      trip_from_plan)

PLAN = json.loads((Path(__file__).parent / "fixtures" / "plan_joondalup.json").read_text())
ARRIVE = datetime(2026, 11, 25, 8, 0, tzinfo=PERTH)
IDS = {"transperth_99871": 5, "transperth_99612": 9}


def trip(tables=None):
    return trip_from_plan(best_itinerary(PLAN, ARRIVE), IDS, tables or RouteTables())


def leg(t, i):
    """Leg as dict: [line, from, to, depart, arrive, shape, i0, i1]."""
    return dict(zip(["line", "from", "to", "depart", "arrive", "shape", "i0", "i1"], t[2][i]))


def test_best_itinerary_leaves_latest():
    it = best_itinerary(PLAN, ARRIVE)
    assert it["startTime"] == "2026-11-24T23:16:00Z"


def test_best_itinerary_none_when_all_late():
    assert best_itinerary(PLAN, datetime(2026, 11, 25, 7, 0, tzinfo=PERTH)) is None
    assert best_itinerary({"itineraries": []}, ARRIVE) is None


def test_trip_shape():
    tables = RouteTables()
    t = trip(tables)
    assert len(t[2]) == 2
    rail = leg(t, 0)
    assert tables.lines[rail["line"]] == ["REGIONAL_RAIL", "Yanchep Line", "Elizabeth Quay Stn"]
    assert tables.lines[leg(t, 1)["line"]] == ["WALK", "", ""]
    assert rail["from"] == 5 and rail["to"] == 9


def test_times_are_perth_local_minutes():
    t = trip()
    assert t[0] == 7 * 60 + 16 and t[1] == 7 * 60 + 57
    assert leg(t, 0)["depart"] == 7 * 60 + 16


def test_unknown_stop_ids_map_to_minus1():
    assert leg(trip(), 1)["to"] == -1


def test_leg_geometry_slices_its_shape():
    tables = RouteTables()
    t = trip(tables)
    rail = leg(t, 0)
    shapes = tables.finalize()
    pts = decode_polyline(shapes[rail["shape"]], 5)[rail["i0"]:rail["i1"] + 1]
    raw = decode_polyline(best_itinerary(PLAN, ARRIVE)["legs"][0]["legGeometry"]["points"], 6)
    assert np.allclose(pts[0], raw[0], atol=2e-4) and np.allclose(pts[-1], raw[-1], atol=2e-4)


def test_identical_trips_share_shapes():
    tables = RouteTables()
    a, b = trip(tables), trip(tables)
    assert len(tables.finalize()) == 2
    assert [l[5:] for l in a[2]] == [l[5:] for l in b[2]]


def test_sub_segment_reuses_longer_shape():
    tables = RouteTables()
    line = [(-31.9 + i * 0.001, 115.8) for i in range(20)]
    s_full = tables.add_geometry(("BUS", "950", "UWA"), line)
    s_sub = tables.add_geometry(("BUS", "950", "UWA"), line[5:12])
    assert s_sub == (s_full[0], 5, 11)
    assert len(tables.finalize()) == 1


def test_empty_leg_geometry_falls_back_to_straight_line():
    import copy

    it = copy.deepcopy(best_itinerary(PLAN, ARRIVE))
    it["legs"][1]["legGeometry"]["points"] = ""  # MOTIS returns this for zero-length walks
    tables = RouteTables()
    t = trip_from_plan(it, IDS, tables)
    walk = leg(t, 1)
    shapes = tables.finalize()
    pts = decode_polyline(shapes[walk["shape"]], 5)[walk["i0"]:walk["i1"] + 1]
    frm, to = it["legs"][1]["from"], it["legs"][1]["to"]
    assert np.allclose(pts[0], (frm["lat"], frm["lon"]), atol=1e-5)
    assert np.allclose(pts[-1], (to["lat"], to["lon"]), atol=1e-5)


def test_polyline_roundtrip():
    pts = [(-31.95561, 115.86023), (-31.9, 115.9), (-32.0, 115.7)]
    assert np.allclose(decode_polyline(encode_polyline(pts, 5), 5), pts, atol=1e-5)


def test_missing_plan_counted():
    def plan(stop, sample):
        return None if sample == 1 else best_itinerary(PLAN, ARRIVE)

    routes, missing = build_routes([(5, 0), (5, 1)], plan, IDS, ["08:00", "08:05"])
    assert missing == 1
    assert set(routes["trips"]) == {"5:0"}
    assert routes["samples"] == ["08:00", "08:05"]
    assert len(routes["shapes"]) == 2 and len(routes["lines"]) == 2


def test_plan_uses_routed_transfers_like_one_to_all():
    from pipeline import Motis

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"itineraries": []}

    seen = {}

    class FakeSession:
        def get(self, url, timeout, params):
            seen.update(params, url=url)
            return FakeResp()

    m = Motis("http://x")
    m.s = FakeSession()
    m.plan("transperth_1", ARRIVE)
    assert seen["url"] == "http://x/api/v5/plan"
    assert seen["useRoutedTransfers"] == "true" and seen["arriveBy"] == "true"
