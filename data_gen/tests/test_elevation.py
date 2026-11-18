import numpy as np
import pytest

from elevation import Dem, VOID, along, climb, fill_voids, interpolate_water, median_filter, sample_positions
from pipeline import BBox


def test_bilinear_sample():
    dem = Dem(np.array([[10.0, 20.0], [30.0, 40.0]]), north=-31.0, west=115.0, step=0.5)
    assert dem.sample(np.array([-31.25]), np.array([115.25]))[0] == pytest.approx(25)
    assert dem.sample(np.array([-31.0]), np.array([115.0]))[0] == pytest.approx(10)
    assert np.isnan(dem.sample(np.array([-30.0]), np.array([115.0]))[0])


def write_hgt(path, rows):
    np.asarray(rows, dtype=">i2").tofile(path)


def test_tile_seam_continuous(tmp_path):
    # 3x3 tiles, 0.5 deg step; heights rise 10 m per row southwards, shared edge row at lat -32 = 20
    write_hgt(tmp_path / "S32E115.hgt", [[0, 0, 0], [10, 10, 10], [20, 20, 20]])
    write_hgt(tmp_path / "S33E115.hgt", [[20, 20, 20], [30, 30, 30], [40, 40, 40]])
    dem = Dem.from_tiles([tmp_path / "S32E115.hgt", tmp_path / "S33E115.hgt"], BBox(115.0, -33.0, 116.0, -31.0))
    lon = np.array([115.5, 115.5])
    north, south = dem.sample(np.array([-32.0 + 1e-9, -32.0 - 1e-9]), lon)
    assert not np.isnan(north) and not np.isnan(south)
    assert north == pytest.approx(south, abs=1e-3)
    assert north == pytest.approx(20, abs=1e-3)


def test_fill_voids():
    h = np.full((3, 3), 10.0)
    h[1, 1] = VOID
    assert fill_voids(h)[1, 1] == 10


def test_median_removes_spike():
    h = np.full((7, 7), 5.0)
    h[3, 3] = 60
    assert np.all(median_filter(h, 5) == 5)


def test_sample_positions():
    assert sample_positions(120).tolist() == [0, 50, 100, 120]
    assert sample_positions(100).tolist() == [0, 50, 100]
    assert sample_positions(0).tolist() == [0]


def test_along_straight_line():
    pts = np.array([[-32.0, 115.0], [-32.0, 115.01]])
    lat, lon = along(pts, np.array([0.0, 1e9]))
    assert lon[0] == pytest.approx(115.0) and lon[1] == pytest.approx(115.01)  # clamped at the end
    mid = along(pts, np.array([472.0]))[1][0]  # ~half of the ~944 m line
    assert mid == pytest.approx(115.005, abs=1e-4)


def test_interpolate_water():
    out = interpolate_water(np.array([10.0, 0, 0, 20]), np.array([False, True, True, False]))
    assert out == pytest.approx([10, 13.333, 16.667, 20], abs=1e-3)


def test_interpolate_water_edges():
    assert interpolate_water(np.array([0.0, 5, 0]), np.array([True, False, True])).tolist() == [5, 5, 5]
    assert interpolate_water(np.array([1.0, 2]), np.array([True, True])).tolist() == [1, 2]


def test_climb_hysteresis():
    assert climb(np.array([0, 1, 0, 1, 0, 10, 4.0])) == (10, 6)
