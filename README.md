# Rajo, open pits seen from orbit

Live: https://rajo.fasl-work.com (vps-static on the prod box, first content deploy 2026-09-03; the footer prints the deployed version).

[![CI](https://img.shields.io/github/actions/workflow/status/fsantibanezleal/CAOS_Rajo/ci.yml?branch=main&label=CI)](https://github.com/fsantibanezleal/CAOS_Rajo/actions)
[![License](https://img.shields.io/github/license/fsantibanezleal/CAOS_Rajo)](LICENSE)
[![Version](https://img.shields.io/github/v/tag/fsantibanezleal/CAOS_Rajo?label=version&sort=semver)](https://github.com/fsantibanezleal/CAOS_Rajo/tags)

Rajo ("open pit" in Chilean Spanish) is an open observatory of the world's great open-pit mines and lithium
evaporation ponds as seen from satellites over four decades. It shows each site on a 3D globe with real
relief, replays a yearly time-lapse from 1985 (Landsat) to today (Sentinel-2), computes spectral and mineral
indices live in your browser from the raw cloud-optimized GeoTIFFs, runs a learned mine-footprint
segmentation in the browser, detects change points on the mined-area signal, and shows where and how much
rock moved between the 2000 and the 2011 to 2015 global elevation models. Chilean copper is the core of the
catalog; the world's icons are the context.

Everything runs in the browser or comes from a baked, checksummed artifact. There is no backend, no
account, and nothing is uploaded anywhere. Every number on screen traces to a computation you can rerun or
to a named, dated source.

## Status

Version 0.02.001 (2026-09-03; 0.02.000 plus the fixes from its first live run): the four lanes on the thirty sites. Replay: the yearly time-lapse 1985 to
2026 baked and validated for every site (Landsat then Sentinel-2), the classical and learned masks, the
mined-area series with their change points, and the elevation difference between the year-2000 radar
surface and the 2011 to 2015 Copernicus surface. Live: the latest clear Sentinel-2 scene read in the
browser, nine indices, Otsu, k-means, spectral angle, the random forest walked from flat node arrays and
the U-Net on WebGPU or WASM. Every site card carries sourced facts (Cochilco and the operators' own
disclosures), the Atlas prints the USGS copper table by country, and the Methods page reads the
held-out benchmark. The dense (all-dates) series exists for the sites the detached workers have
finished; the rest land as they complete. See the [CHANGELOG](CHANGELOG.md) and the open issues.

## Run it locally

Numbered scripts in [`scripts/local/`](scripts/local/README.md), PowerShell first, bash twins alongside:

```powershell
.\scripts\local\00_install-prereqs.ps1     # checks Python 3.12+, Node 22+, git
.\scripts\local\01_init.ps1                # .venv (bake lane) + frontend packages
.\scripts\local\03_dev.ps1                 # http://localhost:5901
```

The offline bake (`02_generate-data`) is not needed to run the app: the committed artifacts under
`data/derived/` are what the deployed site serves.

## Repository

| Path | What |
|---|---|
| `frontend/` | React 19 + Vite + TypeScript SPA: MapLibre GL JS (globe, 3D terrain, image overlays), geotiff.js range reads, a band-math Web Worker (indices, classical masks, the random forest traversed from flat arrays), onnxruntime-web for the U-Net, uPlot charts, KaTeX, EN/ES |
| `data-pipeline/` | the offline bake, plain Python scripts invoked by path (no package): catalog, scenes, frames, masks, series, dem, export, validate |
| `data/` | the site catalog (`examples/sites.json`), the two data contracts (`README.md`), the committed derived artifacts |
| `models/` | exported ONNX models with their registry (checkpoints stay out of git) |
| `docs/` | the wiki: architecture, data sources and licenses, methods, sites, guides |
| `scripts/` | local scripts and the CI guards (content standards, repository standards, artifact contract) |
| `tests/` | pytest suite for the pipeline (sandboxed; tests never write the committed artifacts) |
| `deploy/` | the nginx site and the deploy scripts |

## Data and licenses

Sentinel-2 L2A (Copernicus, via Earth Search on AWS), Landsat Collection 2 Level-2 (USGS, via Microsoft
Planetary Computer), Terrain Tiles (Mapzen), Copernicus DEM GLO-30, SRTM GL1 (via OpenTopography), the
mining polygons of Maus et al. 2022 (CC BY-SA 4.0), Tang and Werner 2023 (CC BY 4.0) and Jasansky et al.
2024 (CC BY-SA 4.0), the EOX Sentinel-2 cloudless basemap (CC BY-NC-SA 4.0) and OpenFreeMap. The full
attribution block and every license are in [`docs/data/`](docs/) and rendered in the app. Code is MIT.

## Author

Felipe Santibanez-Leal. Issues and pull requests are welcome; see [CONTRIBUTING](CONTRIBUTING.md).
