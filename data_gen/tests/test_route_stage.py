from datetime import date, datetime

import numpy as np
import pandas as pd
import pytest

from pipeline import PERTH, mismatch_rate, require_service, sample_times, service_dates, trip_minutes


def test_service_dates():
    d = service_dates(date(2026, 11, 18))  # a Wednesday
    assert d == {"weekday": date(2026, 11, 25), "saturday": date(2026, 11, 21), "sunday": date(2026, 11, 22)}


def test_sample_times():
    ts = sample_times(date(2026, 11, 25), 8)
    assert len(ts) == 12
    assert ts[0] == datetime(2026, 11, 25, 8, 0, tzinfo=PERTH)
    assert ts[-1] == datetime(2026, 11, 25, 8, 55, tzinfo=PERTH)


def test_zero_reachable_fails():
    empty = pd.DataFrame(columns=["stop", "lat", "lon", "minutes", "t"])
    some = pd.DataFrame({"stop": ["a"], "lat": [0.0], "lon": [0.0], "minutes": [5.0], "t": [0]})
    require_service("sunday", [empty, some])  # one empty window is fine (direct walk only)
    with pytest.raises(SystemExit):
        require_service("sunday", [empty, empty])


def test_trip_minutes_wraps_midnight():
    assert trip_minutes("07:16", "08:00") == 44
    assert trip_minutes("23:50", "00:10") == 20


def test_mismatch_rate():
    fastest = np.array([40.0, 30.0, 20.0, 50.0, np.nan])
    via_trip = np.array([41.0, 30.0, 27.0, 49.0, 10.0])
    assert mismatch_rate(fastest, via_trip) == 0.25
    # nothing to compare (e.g. every plan failed) is "unknown", not a perfect 0 %
    assert mismatch_rate(np.array([20.0]), np.array([np.nan])) is None


def test_missing_share():
    from pipeline import missing_share
    assert missing_share(3, 100) == 0.03
    assert missing_share(0, 0) == 0.0
