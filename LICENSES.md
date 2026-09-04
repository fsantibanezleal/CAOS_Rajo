# Licenses

The code in this repository is MIT (see `LICENSE`). The data and imagery it reads and the derived
artifacts it publishes carry their own licenses, listed here and in `docs/data/03_attribution.md`.

| Component | License | Attribution |
|---|---|---|
| Sentinel-2 L2A (Copernicus) | Copernicus Sentinel data legal notice: free, full and open access | Contains modified Copernicus Sentinel data [year] |
| Landsat Collection 2 Level-2 (USGS) | public domain; distributed by Microsoft Planetary Computer | Landsat courtesy of the U.S. Geological Survey |
| Terrain Tiles (Mapzen / Tilezen) | per source: SRTM, GMTED2010, ETOPO1 (public domain), regional sets (CC BY 4.0 and others) | Mapzen plus the regional credits |
| Copernicus DEM GLO-30 | Copernicus DEM licence, free with attribution | (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA |
| SRTM GL1 via OpenTopography | public domain (NASA/USGS); OpenTopography acknowledgement | Farr et al. 2007, doi:10.1029/2005RG000183 |
| Maus et al. 2022 mining polygons | CC BY-SA 4.0 | doi:10.1594/PANGAEA.942325 |
| Tang and Werner 2023 mining polygons | CC BY 4.0 | doi:10.5281/zenodo.6806817 |
| Jasansky et al. 2024 training set | CC BY-SA 4.0 | doi:10.5281/zenodo.14195737 |
| EOX Sentinel-2 cloudless 2024 basemap | CC BY-NC-SA 4.0 (non-commercial use) | Sentinel-2 cloudless - https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024) |
| OpenFreeMap tiles | OpenMapTiles (BSD / CC BY) over OpenStreetMap (ODbL) | OpenFreeMap (c) OpenMapTiles Data from OpenStreetMap |

Derived polygon layers published by this project (`data/derived/sites/*/polygons.geojson`) are
CC BY-SA 4.0, as the share-alike term of the Maus dataset requires. Exported model weights
(`models/*.onnx`) are MIT; the training data's CC BY-SA 4.0 is credited in `models/registry.json`.
