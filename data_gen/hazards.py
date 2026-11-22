"""Hazard and noise layers rasterised onto the travel-time grid (`attrs.bin`) plus small line layers for the map.

Public files (openly licensed sources) go to `web/`; personal-use-only sources go to `web/local/`, which the public
site never ships (see README "Local build")."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
from shapely.geometry import mapping, shape

from attrs import distance_m, encode_attrs, fetch_arcgis, inside_code, max_within
from pipeline import GRID_BBOX, INPUT, WEB, GridMeta, log, osm_layer, write_json

SLIP = "https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/"
BUSHFIRE = SLIP + "Bush_Fire_Prone_Areas/MapServer/23/query"
ACID = SLIP + "Soil_Risk_Map/MapServer/3/query"
NOISE = SLIP + "Property_and_Planning/MapServer/100/query"
TRAFFIC = ("https://gisservices.mainroads.wa.gov.au/arcgis/rest/services/OpenData/RoadAssets_DataPortal/"
           "MapServer/27/query")
NOISE_TYPES = ["Strategic freight and/or major traffic route", "Other significant freight/traffic route",
               "Freight railway", "Metropolitan passenger railway", "Proposed strategic freight route",
               "Proposed metropolitan passenger railway"]
ROAD_FILTERS = ["w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,"
                "tertiary,tertiary_link"]
POWER_FILTERS = ["w/power=line", "nwr/power=substation"]
POWER_CAP_M = 5000
TRAFFIC_RADIUS_M = 200
TRAFFIC_MAP_MIN = 5000  # vehicles/day for a road to be drawn
SIMPLIFY_M = 10
METRIC = "EPSG:7850"

LAYERS = [
    # id, field, title, source, licence, url, local
    ("bushfire", "bushfire", "Bushfire prone areas", "OBRM-026", "CC BY 4.0", BUSHFIRE[:-6], False),
    ("traffic", "traffic_k", "Traffic volumes", "Main Roads Traffic Digest", "CC BY 4.0", TRAFFIC[:-6], False),
    ("power", "power_m", "Powerlines and substations", "OpenStreetMap", "ODbL",
     "https://www.openstreetmap.org/copyright", False),
    ("acid", "acid", "Acid sulfate soils", "DWER-055", "Personal use only", ACID[:-6], True),
    ("noise", "noise", "Road/rail noise areas", "DPLH-057", "Personal use only", NOISE[:-6], True),
]


def latest_sites(features: list[dict]) -> list[tuple[float, float, int]]:
    """(lon, lat, vehicles/day Mon–Sun) per count site, from its newest count."""
    best: dict[str, dict] = {}
    for f in features:
        p = f["properties"]
        if p.get("MON_SUN") is None or not f.get("geometry"):
            continue
        cur = best.get(p["SITE_NO"])
        if cur is None or str(p["TRAFFIC_YEAR"]) > str(cur["properties"]["TRAFFIC_YEAR"]):
            best[p["SITE_NO"]] = f
    out = []
    for f in best.values():
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append((lon, lat, int(f["properties"]["MON_SUN"])))
    return out


def road_volumes(roads: gpd.GeoDataFrame, sites: gpd.GeoDataFrame, snap_m: float = 60,
                 reach_m: float = 2000) -> np.ndarray:
    """Vehicles/day per road: a count site sits on its nearest road (within `snap_m`) and also speaks for the
    same-named roads within `reach_m` (the nearest site wins); 0 where nothing was counted."""
    vol = np.zeros(len(roads), dtype=np.int64)
    if not len(roads) or not len(sites):
        return vol
    geoms, site_geoms = roads.geometry.values, sites.geometry.values
    aadt = sites["aadt"].to_numpy()
    names = np.array([n if isinstance(n, str) and n else None for n in roads.get("name", [None] * len(roads))],
                     dtype=object)
    (si, ri), _ = shapely.STRtree(geoms).query_nearest(site_geoms, max_distance=snap_m, return_distance=True)
    anchored: dict[int, int] = {}
    for s, r in zip(si, ri):
        anchored.setdefault(int(s), int(r))
    by_name: dict[str, list[int]] = defaultdict(list)
    for s, r in anchored.items():
        if names[r] is None:
            vol[r] = max(vol[r], aadt[s])
        else:
            by_name[names[r]].append(s)
    for name, ss in by_name.items():
        near = site_geoms[ss]
        for r in np.nonzero(names == name)[0]:
            d = shapely.distance(geoms[r], near)
            k = int(np.argmin(d))
            if d[k] <= reach_m:
                vol[r] = aadt[ss[k]]
    return vol


def _geoms(features: list[dict]) -> list:
    return [shape(f["geometry"]) for f in features if f.get("geometry")]


def _rounded(geom) -> dict:
    return json.loads(json.dumps(mapping(geom)), parse_float=lambda v: round(float(v), 5))


def _lines_fc(gdf: gpd.GeoDataFrame, props) -> dict:
    """Simplified (in metres) line features; `props(row)` gives each feature's properties."""
    simple = gdf.to_crs(METRIC).simplify(SIMPLIFY_M).to_crs("EPSG:4326")
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": props(row), "geometry": _rounded(g)}
        for (_, row), g in zip(gdf.iterrows(), simple) if not g.is_empty]}


def _manifest(local: bool, as_of: str) -> dict:
    return {"layers": [{"id": i, "field": f, "title": t, "source": s, "licence": lic, "url": u, "asOf": as_of,
                        "local": loc} for i, f, t, s, lic, u, loc in LAYERS if loc == local]}


def _share(name: str, plane: np.ndarray) -> None:
    log(f"  {name}: {np.count_nonzero(plane) / plane.size:.1%} of cells nonzero, max {plane.max()}")


def build(web: Path, meta: GridMeta, fetch=fetch_arcgis, osm=osm_layer) -> None:
    src = INPUT / "perth.osm.pbf"
    as_of = date.today().isoformat()

    bushfire = inside_code(meta, [(1, g) for g in _geoms(fetch(BUSHFIRE, GRID_BBOX))])

    acid_feats = fetch(ACID, GRID_BBOX)
    acid = inside_code(meta, [(int(f["properties"]["risk_class"]), shape(f["geometry"])) for f in acid_feats
                              if f.get("geometry") and f["properties"].get("risk_class") in (1, 2)])
    noise_coded = []
    for f in fetch(NOISE, GRID_BBOX):
        t = f["properties"].get("feature_type")
        if t in NOISE_TYPES and f.get("geometry"):
            noise_coded.append((NOISE_TYPES.index(t) + 1, shape(f["geometry"])))
        else:
            log(f"  noise: skipping feature type {t!r}")
    noise = inside_code(meta, noise_coded)

    sites = latest_sites(fetch(TRAFFIC, GRID_BBOX))
    site_gdf = gpd.GeoDataFrame({"aadt": [a for _, _, a in sites]},
                                geometry=gpd.points_from_xy([s[0] for s in sites], [s[1] for s in sites]),
                                crs="EPSG:4326").to_crs(METRIC)
    roads = osm(src, ROAD_FILTERS, "linestring", "roads")
    roads = roads[roads.geom_type.isin(["LineString", "MultiLineString"])].reset_index(drop=True)
    roads_m = roads.to_crs(METRIC)
    roads["vol"] = road_volumes(roads_m, site_gdf)
    counted = roads["vol"] >= 1000
    traffic_k = max_within(meta, [(int(v // 1000), g) for v, g in zip(roads["vol"][counted], roads_m.geometry[counted])],
                           TRAFFIC_RADIUS_M)
    log(f"traffic: {len(sites)} count sites, {int((roads['vol'] > 0).sum())}/{len(roads)} roads with a volume")

    power = osm(src, POWER_FILTERS, "point,linestring,polygon", "power")
    lines = power[(power["power"] == "line") & power.geom_type.isin(["LineString", "MultiLineString"])]
    subs = power[power["power"] == "substation"]
    power_m = distance_m(meta, list(lines.to_crs(METRIC).geometry) + list(subs.to_crs(METRIC).geometry), POWER_CAP_M)
    log(f"power: {len(lines)} lines, {len(subs)} substations")

    (web / "local").mkdir(parents=True, exist_ok=True)
    # gzipped, but not named .gz: dev/static servers add Content-Encoding: gzip from the extension
    (web / "attrs.bin").write_bytes(encode_attrs({"bushfire": bushfire, "power_m": power_m, "traffic_k": traffic_k},
                                                 meta))
    (web / "local" / "attrs.bin").write_bytes(encode_attrs({"acid": acid, "noise": noise}, meta))
    write_json(web / "layers.json", _manifest(False, as_of))
    write_json(web / "local" / "layers.json", _manifest(True, as_of))

    busy = roads[roads["vol"] >= TRAFFIC_MAP_MIN].assign(k=lambda d: d["vol"] // 1000)
    merged = [(int(k), shapely.line_merge(shapely.unary_union(list(g.geometry))))
              for (_, k), g in busy.groupby([busy["name"].fillna(""), "k"])]
    merged_gdf = gpd.GeoDataFrame({"k": [k for k, _ in merged]}, geometry=[g for _, g in merged], crs="EPSG:4326")
    write_json(web / "traffic.json", _lines_fc(merged_gdf, lambda r: {"k": int(r["k"])}))
    power_fc = _lines_fc(lines, lambda r: {"kind": "line"})
    power_fc["features"] += [{"type": "Feature", "properties": {"kind": "substation"},
                              "geometry": _rounded(g.representative_point())} for g in subs.geometry]
    write_json(web / "powerlines.json", power_fc)

    for name, plane in [("bushfire", bushfire), ("traffic_k", traffic_k), ("acid", acid), ("noise", noise)]:
        _share(name, plane)
    log(f"  power_m: {np.mean(power_m < 200):.1%} of cells within 200 m")


def hazards_stage(args: argparse.Namespace) -> None:
    from schools import web_grid_meta
    build(WEB, web_grid_meta())
