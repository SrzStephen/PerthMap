from pipeline import merged_index

GRID = {"width": 3, "height": 2, "minLon": 115.0, "minLat": -32.0, "spacing": 0.001}
BIKE = {"refSpeedKmh": 15.09, "mismatchRate": 0.0, "missingRate": 0.001}


def test_route_keeps_bike_entry():
    old = {"grid": GRID, "bike": BIKE, "mismatchRate": {"weekday-08": 0.1}}
    new = {"grid": GRID, "mismatchRate": {"weekday-09": 0.2}}
    out = merged_index(old, new)
    assert out["bike"] == BIKE
    assert out["mismatchRate"] == {"weekday-09": 0.2}


def test_route_drops_bike_when_grid_changed():
    old = {"grid": GRID, "bike": BIKE}
    out = merged_index(old, {"grid": {**GRID, "spacing": 0.002, "width": 2}})
    assert "bike" not in out


def test_no_old_index():
    assert merged_index({}, {"grid": GRID}) == {"grid": GRID}
