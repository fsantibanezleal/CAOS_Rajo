# 01 Sources, probed and licensed

Every row was probed live on 2026-09-02 with a browser-like `Origin` header. "CORS" means the response
carried `Access-Control-Allow-Origin` for that origin, which is what lets a static page read the data
directly. Sources without CORS are read by the offline bake only.

## Satellite imagery

| Source | Access | Browser | License and attribution |
|---|---|---|---|
| Sentinel-2 L2A cloud-optimized GeoTIFFs, 2017 to today, 10 m | Earth Search v1 STAC (`earth-search.aws.element84.com/v1`, collection `sentinel-2-l2a`) and the `sentinel-cogs` bucket (AWS Open Data, free, not requester-pays) | yes: STAC and COGs both answer with CORS `*`, range reads allowed (`206 Partial Content` probed on a 10 m band) | Copernicus Sentinel data legal notice: free, full and open; "Contains modified Copernicus Sentinel data [year]" |
| Landsat Collection 2 Level-2, 1982 to today, 30 m | Microsoft Planetary Computer STAC (`planetarycomputer.microsoft.com/api/stac/v1`, collection `landsat-c2-l2`), assets on Azure blob with an anonymous SAS token (`/api/sas/v1/token/landsat-c2-l2`, about 24 h validity) | no: bake only | USGS Landsat data are public domain; the distribution asks for attribution to the U.S. Geological Survey |

Facts used by the bake: Sentinel-2 L2A surface reflectance is `(DN + BOA_ADD_OFFSET) / 10000` with
`BOA_ADD_OFFSET = -1000` from processing baseline 04.00 (Earth Search items carry `scale 0.0001`,
`offset -0.1` on the reflectance assets and `earthsearch:boa_offset_applied`); DN 0 is no data. The Scene
Classification band (SCL) values are 0 no data, 1 saturated or defective, 2 topographic cast shadow, 3 cloud
shadow, 4 vegetation, 5 not vegetated, 6 water, 7 unclassified, 8 cloud medium probability, 9 cloud high
probability, 10 thin cirrus, 11 snow or ice. Landsat Collection 2 surface reflectance is
`DN * 0.0000275 - 0.2`; `QA_PIXEL` bits 0 fill, 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow.

Band table (Sentinel-2, ESA SentiWiki): B2 490 nm 10 m, B3 560 nm 10 m, B4 665 nm 10 m, B5 705 nm 20 m,
B6 740 nm 20 m, B7 783 nm 20 m, B8 842 nm 10 m, B8A 865 nm 20 m, B11 1610 nm 20 m, B12 2190 nm 20 m
(B1, B9 at 60 m are not used).

## Elevation

| Source | Access | Browser | License and attribution |
|---|---|---|---|
| Terrain Tiles (Mapzen / Tilezen), global, terrarium PNG and GeoTIFF | `s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | yes: CORS `*` | attribution "Mapzen" plus the regional credits; sources SRTM, GMTED2010, ETOPO1 and regional sets (3DEP, Geoscience Australia CC BY 4.0, EU-DEM, CDEM, LINZ, ...). In South America the surface is the year-2000 SRTM |
| Copernicus DEM GLO-30, TanDEM-X 2011 to 2015, 30 m | `copernicus-dem-30m` bucket (COG per 1 x 1 degree tile) | no: the bucket answers range reads without CORS, bake only | Copernicus DEM licence: free for the general public with attribution to DLR and Airbus under COPERNICUS by the European Union and ESA; absolute vertical accuracy under 4 m at 90% |
| SRTM GL1, February 2000, 30 m, void-filled | OpenTopography S3 (`opentopography.s3.sdsc.edu/raster/SRTM_GL1/SRTM_GL1_srtm/`) | yes: CORS reflected | Farr et al. 2007, doi:10.1029/2005RG000183; OpenTopography acknowledgement |

Terrarium decoding: `elevation_m = (R * 256 + G + B / 256) - 32768`.

## Mining footprints and training data

| Source | Content | License |
|---|---|---|
| Maus et al. 2022, Global-scale mining polygons v2, doi:10.1594/PANGAEA.942325 (paper doi:10.1038/s41597-022-01547-4) | 44,929 polygons, 101,583 km2, every ground feature related to mining, digitised on the 2019 Sentinel-2 cloudless mosaic; validation on 1,000 control points: overall accuracy 88.3%, F1 0.87, user's accuracy for the mine class 97.2% | CC BY-SA 4.0 (share-alike: the polygon layers Rajo publishes stay CC BY-SA 4.0) |
| Tang and Werner 2023, Global mining footprint mapped from high-resolution satellite imagery, doi:10.1038/s43247-023-00805-6 (data doi:10.5281/zenodo.6806817) | mine area polygons from high-resolution imagery | CC BY 4.0 |
| Jasansky, Maus, Popa, Wilbik 2024, Global ML-ready dataset for mining areas in satellite images, doi:10.5281/zenodo.14195737 | 1,514 Sentinel-2 tiles over 1,210 sites with mining masks from both polygon sets and a manually preferred variant; mine type and scale; a site-level train, validation and test split; tile ids and timestamps so the pixels are fetched from the Sentinel-2 archive | CC BY-SA 4.0 |

## Basemaps and labels

| Source | Access | Browser | License and attribution |
|---|---|---|---|
| EOX Sentinel-2 cloudless, yearly global mosaics 2016 to 2025 | WMTS `tiles.maps.eox.at/wmts/1.0.0/s2cloudless-{year}_3857/default/g/{z}/{y}/{x}.jpg` | yes: CORS reflected | 2024 layer CC BY-NC-SA 4.0 for non-commercial use; attribution verbatim: "Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024)". Rajo is a non-commercial open research project and renders the string verbatim |
| OpenFreeMap (OpenMapTiles over OpenStreetMap) | `tiles.openfreemap.org/styles/{dark,positron}` | yes: CORS `*`, no key, no request limits | attribution "OpenFreeMap (c) OpenMapTiles Data from OpenStreetMap" (MapLibre adds it automatically) |
| CARTO raster basemaps | `basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png` | yes: CORS `*` | fallback only; CARTO free basemap terms, attribution "(c) OpenStreetMap contributors (c) CARTO" |

## Rejected sources, and why

| Source | Reason |
|---|---|
| Esri World Imagery (`server.arcgisonline.com`) | tiles answer with CORS, but Esri states the legacy service is in mature status and applications must migrate to the ArcGIS basemap layer service, which requires an account and an API key. Not acceptable for a keyless open app |
| GRID-Arendal Global Tailings Portal | 1,805 facilities, but the dataset download requires contacting GRID-Arendal for permission (beta terms). Not redistributable; tailings facilities are named per site only from public disclosures, and their footprints are part of the Maus polygons (which include tailings dams) |
| Copernicus DEM read live in the browser | no CORS on the bucket; baked offline instead |
| Landsat read live in the browser | token plumbing and unverified CORS on Azure blob; baked offline instead |
