"""Everyday amenities from OpenStreetMap (supermarkets, parks, stations, GPs, …) as points for the map."""
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path

from pipeline import GRID_BBOX, INPUT, WEB, log, osm_layer, write_json

# id, label, rules: any (key, values) match. First matching type wins.
TYPES: list[tuple[str, str, list[tuple[str, set[str]]]]] = [
    ("supermarket", "Supermarkets", [("shop", {"supermarket"})]),
    ("park", "Parks", [("leisure", {"park"})]),
    ("playground", "Playgrounds", [("leisure", {"playground"})]),
    ("station", "Train stations", [("railway", {"station"})]),
    ("gp", "GPs", [("amenity", {"doctors"}), ("healthcare", {"doctor"})]),
    ("pharmacy", "Pharmacies", [("amenity", {"pharmacy"}), ("healthcare", {"pharmacy"})]),
    ("hospital", "Hospitals", [("amenity", {"hospital"})]),
    ("childcare", "Childcare", [("amenity", {"childcare", "kindergarten"})]),
    ("library", "Libraries", [("amenity", {"library"})]),
    ("cafe", "Cafés", [("amenity", {"cafe"})]),
]
OSM_FILTERS = ["nwr/shop=supermarket", "nwr/leisure=park,playground", "nwr/railway=station",
               "nwr/amenity=doctors,pharmacy,hospital,childcare,kindergarten,library,cafe",
               "nwr/healthcare=doctor,pharmacy"]
MIN_PARK_M2 = 1000  # drops verges and slivers tagged as parks
SOURCE = "© OpenStreetMap contributors, ODbL"
METRIC = "EPSG:7850"


def classify(tags: dict) -> str | None:
    for tid, _, rules in TYPES:
        if any(isinstance(tags.get(k), str) and tags[k] in values for k, values in rules):
            return tid
    return None


def build(web: Path, osm=osm_layer) -> None:
    gdf = osm(INPUT / "perth.osm.pbf", OSM_FILTERS, "point,polygon", "amenities")
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].reset_index(drop=True)
    tag_cols = [c for c in gdf.columns if c != "geometry"]
    kinds = [classify({c: row[c] for c in tag_cols}) for _, row in gdf.iterrows()]
    area = gdf.to_crs(METRIC).area.to_numpy()
    index = {tid: i for i, (tid, _, _) in enumerate(TYPES)}
    b = GRID_BBOX
    items, counts = [], {tid: 0 for tid, _, _ in TYPES}
    names = gdf["name"] if "name" in gdf else [None] * len(gdf)
    for kind, geom, a, name in zip(kinds, gdf.geometry, area, names):
        if kind is None or (kind == "park" and a < MIN_PARK_M2):
            continue
        pt = geom.representative_point()
        if not (b.min_lon <= pt.x <= b.max_lon and b.min_lat <= pt.y <= b.max_lat):
            continue
        items.append([index[kind], round(pt.y, 5), round(pt.x, 5), name if isinstance(name, str) else ""])
        counts[kind] += 1
    web.mkdir(parents=True, exist_ok=True)
    write_json(web / "amenities.json", {"asOf": date.today().isoformat(), "source": SOURCE,
                                        "types": [[tid, label] for tid, label, _ in TYPES], "items": items})
    log("amenities: " + ", ".join(f"{k} {n}" for k, n in counts.items()))


def amenities_stage(args: argparse.Namespace) -> None:
    build(WEB)
