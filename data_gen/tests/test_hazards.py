import json

import geopandas as gpd
import numpy as np
from shapely.geometry import LineString, Point, box, mapping

import attrs
import hazards
from pipeline import GridMeta

PERTH = GridMeta(20, 20, 115.86, -31.95, 0.001)


def site(no, year, aadt, lon=115.865, lat=-31.94):
    props = {"SITE_NO": no, "TRAFFIC_YEAR": year, "MON_SUN": aadt}
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [lon, lat]}}


def test_latest_sites():
    out = hazards.latest_sites([site("A", "2021/22", 5000), site("A", "2023/24", 7000), site("B", "2023/24", None)])
    assert out == [(115.865, -31.94, 7000)]


def test_road_volumes():
    roads = gpd.GeoDataFrame({"name": ["Canning Hwy", "Canning Hwy", "Canning Hwy", None]}, geometry=[
        LineString([(0, 0), (1000, 0)]), LineString([(1000, 0), (2000, 0)]),
        LineString([(2600, 0), (4000, 0)]), LineString([(0, 500), (4000, 500)])], crs="EPSG:7850")
    sites = gpd.GeoDataFrame({"aadt": [40000, 99000]}, geometry=[Point(500, 0), Point(3000, 250)], crs="EPSG:7850")
    assert hazards.road_volumes(roads, sites).tolist() == [40000, 40000, 0, 0]


def feature(geom, **props):
    return {"type": "Feature", "properties": props, "geometry": mapping(geom)}


def fake_fetch(url, bbox, out_fields="*", session=None):
    return {
        hazards.BUSHFIRE: [feature(box(115.8595, -31.9505, 115.8695, -31.9295))],  # columns 0-9
        hazards.ACID: [feature(box(115.8595, -31.9505, 115.8615, -31.9485), risk_class=1.0)],
        hazards.NOISE: [feature(box(115.8595, -31.9505, 115.8625, -31.9495), feature_type="Freight railway")],
        hazards.TRAFFIC: [site("A", "2023/24", 25000, 115.865, -31.94), site("B", "2023/24", 3000, 115.87, -31.935)],
    }[url]


def fake_osm(src, filters, geometry, name):
    if name == "roads":
        return gpd.GeoDataFrame({"name": ["Albany Hwy", "Side St"], "highway": ["primary", "tertiary"]}, geometry=[
            LineString([(115.86, -31.94), (115.879, -31.94)]), LineString([(115.87, -31.95), (115.87, -31.931)])],
            crs="EPSG:4326")
    return gpd.GeoDataFrame({"power": ["line", "substation", "minor_line"]}, geometry=[
        LineString([(115.86, -31.932), (115.879, -31.932)]), box(115.875, -31.949, 115.876, -31.948),
        LineString([(115.86, -31.95), (115.879, -31.95)])], crs="EPSG:4326")


def test_build_writes_outputs(tmp_path):
    hazards.build(tmp_path, PERTH, fetch=fake_fetch, osm=fake_osm)
    for f in ["attrs.bin", "layers.json", "powerlines.json", "traffic.json", "local/attrs.bin", "local/layers.json"]:
        assert (tmp_path / f).exists(), f
    shape, pub = attrs.decode_attrs((tmp_path / "attrs.bin").read_bytes())
    assert shape == (20, 20)
    assert set(pub) == {"bushfire", "power_m", "traffic_k"}
    assert np.count_nonzero(pub["bushfire"]) == 200
    assert pub["traffic_k"].reshape(20, 20)[10, 5] == 25  # beside Albany Hwy
    assert pub["power_m"].reshape(20, 20)[18, 5] < 50  # beside the power line, not the minor line
    _, loc = attrs.decode_attrs((tmp_path / "local/attrs.bin").read_bytes())
    assert set(loc) == {"acid", "noise"}
    assert np.count_nonzero(loc["noise"]) == 3 and loc["noise"].max() == 3  # "Freight railway"
    assert np.count_nonzero(loc["acid"] == 1) == 4
    layers = json.loads((tmp_path / "layers.json").read_text())["layers"]
    assert {l["id"] for l in layers} == {"bushfire", "traffic", "power"} and not any(l["local"] for l in layers)
    local = json.loads((tmp_path / "local/layers.json").read_text())["layers"]
    assert {l["id"] for l in local} == {"acid", "noise"} and all(l["local"] for l in local)
    traffic = json.loads((tmp_path / "traffic.json").read_text())["features"]
    assert [f["properties"]["k"] for f in traffic] == [25]
    kinds = sorted(f["properties"]["kind"] for f in json.loads((tmp_path / "powerlines.json").read_text())["features"])
    assert kinds == ["line", "substation"]
