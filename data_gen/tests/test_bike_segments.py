import numpy as np

from bike import SegmentTable
from elevation import Dem
from pipeline import WORK, decode_polyline, encode_polyline

LAT = -32.0
DEG_PER_M = 1 / (np.radians(1) * 6371000 * np.cos(np.radians(WORK[0])))  # lon degrees per metre (to_metres)


def flat_dem(zero_lons=()):
    """10 m everywhere on a 0.0005 deg grid around (LAT, 115.8), 0 m in the columns at `zero_lons`."""
    west, north, step = 115.79, LAT + 0.01, 0.0005
    h = np.full((41, 61), 10.0)
    for lon in zero_lons:
        h[:, round((lon - west) / step)] = 0
    return Dem(h, north=north, west=west, step=step)


def dry(lat, lon):
    return np.zeros(np.shape(lat), bool)


def step(points, node):
    return {"polyline": {"points": encode_polyline(points, 6), "precision": 6}, "toOsmNode": node}


def leg(steps, seconds=100, metres=420.0):
    return {"duration": seconds, "distance": metres, "steps": steps}


def east(lon0, metres):
    return [(LAT, lon0), (LAT, lon0 + metres * DEG_PER_M)]


def test_common_suffix_shared():
    t = SegmentTable(flat_dem(), dry)
    a = t.add_path(1, leg([step(east(115.80, 50), 1), step(east(115.81, 50), 2), step(east(115.82, 50), 3)]))
    b = t.add_path(2, leg([step(east(115.79, 50), 1), step(east(115.81, 50), 2), step(east(115.82, 50), 3)]))
    out = t.finalize()
    assert len(out["shapes"]) == 4
    assert a[4][1:] == b[4][1:]
    assert a[4][0] != b[4][0]


def test_first_step_never_shared():
    t = SegmentTable(flat_dem(), dry)
    a = t.add_path(1, leg([step(east(115.80, 50), 1)]))
    b = t.add_path(2, leg([step(east(115.80, 50), 1)]))
    assert a[4] != b[4]


def test_path_record():
    t = SegmentTable(flat_dem(), dry)
    rec = t.add_path(1, leg([step(east(115.80, 120), 1)], seconds=29, metres=120.0))
    assert rec[:4] == [29, 120, 0, 0]


def test_elev_deltas_and_length():
    t = SegmentTable(flat_dem(), dry)
    t.add_path(1, leg([step(east(115.80, 120), 1)]))
    out = t.finalize()
    assert abs(out["lengths"][0] - 120) <= 1
    assert out["elev"] == [[10, 0, 0, 0]]
    assert decode_polyline(out["shapes"][0], 5)[0] == (LAT, 115.8)


def test_bridge_interpolated():
    def wet(lat, lon):
        return (np.asarray(lon) > 115.8005) & (np.asarray(lon) < 115.8025)

    t = SegmentTable(flat_dem(zero_lons=(115.801, 115.8015, 115.802)), wet)
    t.add_path(1, leg([step([(LAT, 115.7995), (LAT, 115.8035)], 1)]))
    elev = t.finalize()["elev"][0]
    heights = np.cumsum(elev)
    assert heights.min() == 10 and heights.max() == 10


def test_empty_step_skipped():
    t = SegmentTable(flat_dem(), dry)
    empty = {"polyline": {"points": "", "precision": 6}, "toOsmNode": 5}
    a = t.add_path(1, leg([step(east(115.80, 50), 1), empty, step(east(115.81, 50), 2)]))
    b = t.add_path(2, leg([step(east(115.79, 50), 9), step(east(115.81, 50), 2)]))
    assert len(a[4]) == 2 and a[2] == 0
    assert a[4][1] != b[4][1]  # keyed (5, 2) vs (9, 2): the empty step still advances the node chain


def test_missing_dem():
    t = SegmentTable(None, dry)
    rec = t.add_path(1, leg([step(east(115.80, 50), 1), step(east(115.81, 50), 2)]))
    assert rec[2] is None and rec[3] is None
    assert t.finalize()["elev"] == [None, None]


def test_outside_dem_is_none():
    t = SegmentTable(flat_dem(), dry)
    rec = t.add_path(1, leg([step(east(116.5, 50), 1)]))
    assert rec[2] is None
    assert t.finalize()["elev"] == [None]
