import gtfs_kit as gk
from shapely import box
import geopandas as gpd
from pathlib import Path

if __name__ == "__main__":
    base_crs = "EPSG:4326"  # EPSG code for WGS84
    base_feed = gk.read_feed(
        "http://www.transperth.wa.gov.au/TimetablePDFs/GoogleTransit/Production/google_transit.zip",
        dist_units="m",
    )
    geoframe = gpd.GeoDataFrame(
        index=[0],
        geometry=[
            box(xmin=115.679169, ymin=-32.301063, xmax=116.060099, ymax=-31.725200)
        ],
        crs=base_crs,
    )
    feed = gk.restrict_to_area(base_feed=base_feed, array=geoframe)
    feed.write(Path("data/gtfs_trimmed.zip"))
