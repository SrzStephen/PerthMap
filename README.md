# [PerthMap](https://perthmap.phteven.space/)
![Desktop view](doc/img.png)

<img src="doc/img-mobile.png" alt="Mobile view" width="260">

## What
I couldn't find a good source of truth for "How long will it take me to get to work" using public transport, so I built one.

## Tools used

* [MOTIS](https://github.com/motis-project/motis) (in Docker) as the public transport router to calculate how long it takes to get from A to B.
* [OpenStreetMaps Oceania](https://download.geofabrik.de/australia-oceania/australia.html) for map data including routes.
* [Transperths GTFS feed](https://www.transperth.wa.gov.au/About/Spatial-Data-Access) for up to date public transit route information
* Python for data preperation
* React-Leaflet + Vite + Tailwind for data presentation, on Esri's Light Gray Canvas basemap

# Data
See [data_gen](data_gen/README.md) for how to generate data (`docker compose up --build route`).
