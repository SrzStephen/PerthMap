import gzip

import numpy as np

from bike import U16_NA, decode_bike_grid, encode_bike_grid, representatives
from pipeline import GridMeta

META = GridMeta(width=3, height=2, min_lon=115.0, min_lat=-32.0, spacing=0.001)


def test_bike_grid_roundtrip():
    b = encode_bike_grid(np.array([61.6, np.nan]), np.array([2, -1]), np.array([0, 4]), META)
    assert gzip.decompress(b)[:4] == b"PMB1"
    g = decode_bike_grid(b)
    assert g["seconds"].tolist() == [62, U16_NA, U16_NA, U16_NA, U16_NA, U16_NA]
    assert g["path"].tolist() == [2, U16_NA, U16_NA, U16_NA, U16_NA, U16_NA]


def test_seconds_clipped():
    g = decode_bike_grid(encode_bike_grid(np.array([70000.0]), np.array([0]), np.array([1]), META))
    assert g["seconds"][1] == 0xFFFE


def grid10():
    return GridMeta(width=10, height=10, min_lon=115.0, min_lat=-32.0, spacing=0.001)


def test_representative_nearest_centre():
    meta = grid10()
    cells = np.arange(100)
    reachable = np.zeros(100, bool)
    reachable[[1 * 10 + 1, 2 * 10 + 2]] = True  # (x1, y1) and (x2, y2), both in block 0
    rep_cells, block_of = representatives(cells, reachable, meta, 5)
    assert rep_cells.tolist() == [22]
    block0 = [y * 10 + x for y in range(5) for x in range(5)]
    assert set(block_of[block0].tolist()) == {0}


def test_empty_block():
    meta = grid10()
    cells = np.arange(100)
    reachable = np.zeros(100, bool)
    reachable[0] = True
    rep_cells, block_of = representatives(cells, reachable, meta, 5)
    assert rep_cells.tolist() == [0]
    assert block_of[99] == -1  # block (1, 1) has no reachable cell
    assert block_of[4] == 0
