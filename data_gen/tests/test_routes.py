import json
from datetime import datetime
from pathlib import Path

from pipeline import PERTH, PathTable, best_itinerary, build_routes, trip_from_plan

PLAN = json.loads((Path(__file__).parent / "fixtures" / "plan_joondalup.json").read_text())
ARRIVE = datetime(2026, 11, 25, 8, 0, tzinfo=PERTH)
IDS = {"transperth_99871": 5, "transperth_99612": 9}


def trip():
    return trip_from_plan(best_itinerary(PLAN, ARRIVE), IDS, PathTable())


def test_best_itinerary_leaves_latest():
    it = best_itinerary(PLAN, ARRIVE)
    assert it["startTime"] == "2026-11-24T23:16:00Z"


def test_best_itinerary_none_when_all_late():
    assert best_itinerary(PLAN, datetime(2026, 11, 25, 7, 0, tzinfo=PERTH)) is None
    assert best_itinerary({"itineraries": []}, ARRIVE) is None


def test_trip_shape():
    t = trip()
    assert [l["mode"] for l in t["legs"]] == ["REGIONAL_RAIL", "WALK"]
    rail = t["legs"][0]
    assert rail["line"] == "Yanchep Line" and rail["headsign"] == "Elizabeth Quay Stn"
    assert rail["from"] == 5 and rail["to"] == 9


def test_times_are_perth_local():
    t = trip()
    assert t["depart"] == "07:16" and t["arrive"] == "07:57"
    assert t["legs"][0]["depart"] == "07:16"


def test_unknown_stop_ids_map_to_minus1():
    walk = trip()["legs"][1]
    assert walk["line"] == "" and walk["to"] == -1


def test_paths_dedup():
    paths = PathTable()
    a = trip_from_plan(best_itinerary(PLAN, ARRIVE), IDS, paths)
    n = len(paths.items)
    b = trip_from_plan(best_itinerary(PLAN, ARRIVE), IDS, paths)
    assert len(paths.items) == n == 2
    assert [l["path"] for l in a["legs"]] == [l["path"] for l in b["legs"]]


def test_missing_plan_counted():
    def plan(stop, sample):
        return None if sample == 1 else best_itinerary(PLAN, ARRIVE)

    routes, missing = build_routes([(5, 0), (5, 1)], plan, IDS, ["08:00", "08:05"])
    assert missing == 1
    assert set(routes["trips"]) == {"5:0"}
    assert routes["samples"] == ["08:00", "08:05"] and len(routes["paths"]) == 2
