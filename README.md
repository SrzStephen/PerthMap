# [PerthMap](https://perthmap.phteven.space/)
![Page view](doc/img.png)

![](img_2.png)
## What
I couldn't find a good source of truth for "How long will it take me to get to work" using public transport, so I built one.

## Tools used

* [R5](r5py.readthedocs.io/) as a routing library to calculate the fastest way from A to B.
* [OpenStreetMaps Oceania](https://download.geofabrik.de/australia-oceania.html) for map data including routes.
* [Transperths GTFS feed](https://www.transperth.wa.gov.au/About/Spatial-Data-Access) for up to date public transit route information
* Python for data preperation
* React-Leaflet + Vite + Tailwind for data presentation

# Data
See [data_gen](data_gen/README.md)
