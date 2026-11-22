import gzip
import io
import struct
import zipfile

import numpy as np

from pipeline import DIRECT, NONE, GridMeta, Summary, decode_grid, encode_grid, load_stops

META = GridMeta(width=3, height=2, min_lon=115.0, min_lat=-32.0, spacing=0.001)


def summary(**kw):
    base = dict(median=[10.0, np.nan], fastest=[8.0, np.nan], sample=[3, -1], stop=[1, NONE], walk=[4.0, np.nan])
    base.update(kw)
    return Summary(**{k: np.array(v) for k, v in base.items()})


def test_roundtrip_with_sentinels():
    s = summary(median=[300.0, 20.0], fastest=[7.4, 9.0], sample=[2, 5], stop=[1, DIRECT], walk=[3.0, 9.0])
    b = encode_grid(s, np.array([0, 4]), META, stop_index=np.array([10, 42]))
    g = decode_grid(b)
    assert g["median"].tolist() == [254, 255, 255, 255, 20, 255]
    assert g["fastest"].tolist() == [7, 255, 255, 255, 9, 255]
    assert g["sample"].tolist() == [2, 255, 255, 255, 5, 255]
    assert g["walk"].tolist() == [3, 255, 255, 255, 9, 255]
    assert g["stop"].tolist() == [42, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFE, 0xFFFF]


def test_unreachable_is_sentinel():
    g = decode_grid(encode_grid(summary(), np.array([0, 1]), META, stop_index=np.array([0, 7])))
    assert g["median"][1] == 255 and g["sample"][1] == 255 and g["stop"][1] == 0xFFFF
    assert g["stop"][0] == 7


def test_header():
    raw = gzip.decompress(encode_grid(summary(), np.array([0, 1]), META, stop_index=np.array([0, 1])))
    assert raw[:4] == b"PMG1"
    assert struct.unpack("<HII", raw[4:14]) == (1, 3, 2)
    assert len(raw) == 14 + 6 * 6


def test_row0_is_south():
    from pipeline import cell_of
    assert cell_of(META, lat=-32.0, lon=115.0) == 0
    assert cell_of(META, lat=-31.999, lon=115.002) == 5


def test_load_stops_sorted_ids(tmp_path):
    z = tmp_path / "g.zip"
    with zipfile.ZipFile(z, "w") as f:
        # Transperth's header has spaces after the commas and CRLF line endings
        f.writestr("stops.txt", "location_type, stop_id, stop_name, stop_lat, stop_lon\r\n"
                                "0,20,\"B\",-31.9,115.8\r\n0,100,\"A\",-31.8,115.7\r\n0,3,\"C\",-31.7,115.6\r\n")
    df, ids = load_stops(z)
    assert df["stop_id"].tolist() == ["100", "20", "3"]
    assert ids["transperth_3"] == 2
    assert df.loc[0, "stop_name"] == "A"
