from shapely import LineString, box

from pipeline import sea_pieces


def test_right_side_is_sea():
    # heading north: OSM puts land on the left (west), sea on the right (east)
    sea = sea_pieces(box(0, 0, 10, 10), [LineString([(5, -1), (5, 11)])])
    assert len(sea) == 1
    assert sea[0].bounds[0] == 5


def test_reversed_coastline_flips_side():
    sea = sea_pieces(box(0, 0, 10, 10), [LineString([(5, 11), (5, -1)])])
    assert len(sea) == 1
    assert sea[0].bounds[2] == 5
