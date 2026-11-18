# PerthMap House Hunting Layers — Design

Date: 2026-11-18
Status: Approved (grilling session), pending plan

## Goal

Help choose a house to buy in metro Perth. Add property-relevant layers, filters, address search and a
per-point "property report" to PerthMap, on top of the existing public-transport travel-time map.

### Decisions (from the grilling session)

| # | Decision |
|---|---|
| Q1 | Optional overlays inside PerthMap (not a separate app). |
| Q2/Q8 | Two builds from one codebase. **Public** (deployed site): openly licensed layers only. **Local** (`VITE_LOCAL_LAYERS=1`, run by the user): adds personal-use-only layers. Report rows for missing layers say "local build only" and link to the agency viewer. |
| Q3 | Layer viewer + filter mode: active filters combine into one shaded "passes" mask. No weighted score. |
| Q4/Q19 | Click → property report panel (extends today's route panel). |
| Q5/Q7 | Address search (Nominatim, debounced, generic UA, attribution). Snaps to nearest grid cell and shows that cell's route to the CBD. Coverage = existing `GRID_BBOX`. |
| Q6/Q14 | Hand-run snapshot; re-run yearly (intake areas change each December via Gazette). Every layer shows source + "as of" date. |
| — | Driving: out of scope. |
| Q9 | Schools: point locations (DET-024) + **local intake areas for all ~450 metro public schools**, extracted from DoE GeoPDFs. One fast bulk download (6–8 concurrent, retries). No ICSEA (link to My School). |
| Q10 | No price layer. ABS 2021 is stale; 2026 Census first release June 2027 — revisit then. |
| Q11 | v1 layers listed below. Deferred: heritage, tree canopy, mobile coverage, sewer/septic, crime, Pearce/N65 noise. |
| Q12 | Lot area (Landgate cadastre) + R-code → indicative subdivision potential (local build). |
| Q13 | Primary and secondary intake as separate layers; optional/shared areas hatched; "approximate — from DoE maps; check the official lookup if near a boundary" + link. |
| Q15–17 | Filters computed per travel-time grid cell at build time; lot filters highlight lots at street zoom. Amenity distance = walking network distance. |
| Q18 | Big layers (lots, zones, R-codes) as PMTiles via `protomaps-leaflet`; small layers as simplified gzipped GeoJSON. |
| Q8a | Flood stays local-only (DWER "Custom (Active Acceptance)"); public build links to DWER viewer. User may email DWER (spatial.data@dwer.wa.gov.au) for permission later. |
| Q20 | Phased delivery (below). |

## Layers

| Layer | Source | Licence | Build |
|---|---|---|---|
| Local intake areas (primary, secondary) | DoE Schools Online `INTAKE_MAP01/02` GeoPDFs | CC BY 4.0 (DoE; exclude UBD basemap) | public |
| School locations | DET-024, SLIP `Education/MapServer/13` | CC BY-NC 4.0 | public |
| Bushfire prone areas | OBRM-026, `Bush_Fire_Prone_Areas/MapServer/23` | CC BY 4.0 | public |
| NBN technology type (Jul 2020, flagged stale) | Dept of Infrastructure MapServer | CC BY 4.0 | public |
| Powerlines / substations | OSM `power=line,substation` | ODbL | public |
| Amenities (supermarket, park, station, GP, pharmacy) | OSM (existing Geofabrik extract) | ODbL | public |
| Traffic volumes (noise proxy) | Main Roads Traffic Digest, `RoadAssets_DataPortal/MapServer/27` | CC BY 4.0 | public |
| LPS zones, R-codes | DPLH-071/070, `Property_and_Planning/MapServer/112,111` | DPLH personal use | local |
| Perth / Jandakot ANEF | DPLH-046/047, `Property_and_Planning/77,78` | DPLH personal use | local |
| Road & rail noise corridors (SPP 5.4) | DPLH-057/058, `Property_and_Planning/100,75` | DPLH personal use | local |
| Floodway / flood fringe 1% AEP | DWER-014, `Water/MapServer/23` | DWER personal use | local |
| Acid sulfate soil risk | DWER-055, `Soil_Risk_Map/MapServer/3` | DWER personal use | local |
| Contaminated sites | DWER-059, `Environment/MapServer/5` | DWER personal use | local |
| WWTP odour buffers | WCORP-088, `Infrastructure_and_Utilities/35` | Water Corp personal use | local |
| Western Power transmission lines | WP-032 (SLIP login) | Western Power personal use | local (OSM in public) |
| Cadastre lots | LGATE-001, `Property_and_Planning/MapServer/2` | Landgate personal use | local |

SLIP layers are fetched from `https://public-services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/<svc>/MapServer/<id>/query`
(`f=geojson`, `outSR=4326`, paged with `resultOffset`, maxRecordCount 10,000). Each layer records
source URL, licence, attribution and fetch date in a `layers.json` manifest.

## Intake area extraction

Proof of concept in `data_gen/intake/` (validated on 6 current maps; median 3 m to OSM road centrelines).
- School IDs from Schools Online `home.do` autocomplete list (888 statewide). Filter to `GRID_BBOX`.
- Download `school_file_download?schoolID=<id>&fileType=INTAKE_MAP0{1,2}&yearID=_NA`.
- PDFs are Esri GeoPDFs: `/VP /Measure /GEO` GPTS/LPTS corners + MGA Zone 50 → affine page→MGA50 → WGS84.
- Boundary = vector path in layer `LocalIntakeAreas_HS` (stroke ≈ 0,0.149,0.451). Choose the ring
  containing the school point; drop 1-segment hatch lines; tag optional areas separately; neighbouring rings ignored.
- Fallback for raster-only maps: colour segmentation (expected rare; flag for review).
- QA report: schools with 0 or >1 candidate rings, area outliers, school point outside its own ring.

## Grid attributes and filters

At build time compute per grid cell (same `GridMeta` as travel time) and ship as one gzipped binary
attribute file (format versioned like `PMG1`). Fields:

| Field | Filter (default) |
|---|---|
| travel time (existing) | ≤ N min |
| intake primary id, secondary id (+ optional flags) | in chosen school(s) |
| ANEF band (Perth/Jandakot) | < 20 (20/25 selectable) |
| bushfire prone | excluded |
| floodway / fringe | excluded |
| acid sulfate high risk | excluded |
| distance to transmission line | ≥ 200 m |
| in SPP 5.4 noise corridor | excluded |
| NBN technology | FTTP or HFC |
| distance to contaminated site / odour buffer | ≥ 500 m |
| walking distance to supermarket / park / station / GP / pharmacy | 1 km / 400 m / 1.5 km / 1.5 km / 1 km |
| max R-code | ≥ chosen |

Walking distances via a multi-source Dijkstra on the OSM walkable network the pipeline already builds.
Local-only fields are absent from the public attribute file (and their filters hidden).

## Lots and subdivision (local build)

Lot polygons (LGATE-001) clipped to residential zones; area in EPSG:7850. Join R-code (split codes keep
base and upper). Indicative dwellings = floor(area / average site area) with each lot ≥ minimum (R-Codes
Vol 1, April 2026, Table D). Shipped as PMTiles with `area_m2`, `rcode`, `n_base`, `n_upper`. Filters
"lot ≥ X m²" / "can subdivide" highlight lots at zoom ≥ 16. Labelled indicative, not planning advice.

## Property report (panel order)

1. Address + route to CBD (existing)
2. Schools: intake primary / secondary (+ optional), caveat, link to official lookup
3. Planning: zone, R-code, lot area, subdivision estimate
4. Hazards: bushfire, flood, acid sulfate
5. Noise & nuisances: ANEF band, noise corridor, powerline distance, contaminated/odour
6. Services: NBN type, walking distance to each amenity

Each row: value, source, as-of date; "local build only" where applicable.

## Phases

1. Address search + property report shell; schools and intake areas (pipeline + layers + report rows + intake filter).
2. Hazards & noise layers; grid attribute file + filter UI.
3. Walking distances to amenities; NBN.
4. Local build: zones, R-codes, ANEF, flood, contaminated, lots + subdivision (PMTiles).

## Non-goals

Driving times, prices, crime, ICSEA/NAPLAN, scraping NBN per-premises, scheduled refreshes, address-level
legal intake determinations.

## Testing

Pipeline: pytest for GeoPDF georeferencing (fixture PDF), ring selection, grid attribute encode/decode,
subdivision heuristic table. Web: Vitest for attribute decode, filter mask combination, report rows,
geocode snapping. E2E: extend `scripts/e2e-route.py` with an address search → report check.
