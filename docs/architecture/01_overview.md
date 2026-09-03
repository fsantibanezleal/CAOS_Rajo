# 01 Overview: the four lanes

```
+------------------------------- static site (nginx, no backend) --------------------------------+
| index.html + hashed assets      /data/catalog.json      /data/sites/<id>/{manifest.json,        |
| frames/*.webp, masks/*.png, series.json, dem/*.png, terrain/{z}/{x}/{y}.png}    /models/*.onnx  |
+------------------------------------------------------------------------------------------------+

REPLAY   the browser fetches the baked frames, masks, series and elevation deltas and animates them;
         every chart reads committed JSON; nothing is recomputed, so what you see is what was validated.

LIVE A   the browser searches the Earth Search STAC catalog, range-reads six Sentinel-2 bands and the
         scene classification of the site window with geotiff.js, and a Web Worker computes composites,
         indices, mineral ratios, Otsu masks, k-means clusters, spectral-angle masks and change vectors.

LIVE B   onnxruntime-web runs the exported random forest and U-Net on the same window and paints the
         mine-footprint probability as an overlay.

LIVE C   TypeScript implementations of CUSUM, PELT and the harmonic-break model run on the baked series
         or on a region of interest the user draws; each has a Python twin and a parity test.

RELIEF   MapLibre renders 3D terrain from the Mapzen terrarium tiles (the year-2000 SRTM surface in
         South America) or from the site's baked Copernicus DEM tiles (2011 to 2015); the profile tool
         decodes terrarium PNGs in the browser; volumes come from the baked elevation difference.
```

The bake is canonical truth: heavy downloads, model training, full inference and cross-site evaluation run
before a release, in the isolated `.venv`, and write compact artifacts plus manifests. Tests and CI write
only to sandboxes. The web build copies committed artifacts. The deploy verifies hashes and publishes.

## Modules

| Concern | Bake (Python, `data-pipeline/`) | Browser (TypeScript, `frontend/src/`) |
|---|---|---|
| catalog and windows | `rajo/contracts.py`, `rajo/geo.py`, `rajo/stages/catalog.py` | `lib/contract.ts`, `lib/utm.ts`, `state/catalog.ts`, `state/site.ts` |
| scenes and frames | `rajo/stac.py`, `rajo/raster.py`, `rajo/stages/scenes.py`, `rajo/stages/frames.py`; parallel workers `scripts/local/run-detached-bake.*`, `harvest.py` | `lib/stac.ts`, `lib/cog.ts` (live window reads), `map/frameOverlay.ts`, `components/Timeline.tsx`, `state/timeline.ts` |
| band math and classical masks | `train/baselines.py` (the Python mirrors), `rajo/stages/masks.py` | `lib/indices.ts`, `lib/colormap.ts`, `lib/rasterize.ts`, `workers/indices.worker.ts`, `components/Instrument.tsx`, `state/live.ts` |
| learned models | `train/fetch_tiles.py`, `train/common.py`, `train/train_rf.py`, `train/unet_model.py`, `train/train_unet.py`, `train/export_unet.py`, `train/evaluate.py`, `train/make_golden.py`; `models/registry.json` | `workers/features.ts` (golden fixture), `workers/onnx.ts` (onnxruntime-web), `state/models.ts` |
| series and change points | `rajo/changepoints.py`, `rajo/stages/series.py`, `rajo/stages/dense.py`, `make_changepoint_golden.py` | `lib/changepoints.ts` (golden fixture), `components/SeriesPanel.tsx` (uPlot) |
| elevation | `rajo/stages/dem.py` | `map/reliefOverlay.ts`, `components/ReliefPanel.tsx`, `state/relief.ts` |
| manifests and gates | `rajo/manifest.py`, `rajo/stages/export.py`, `rajo/stages/validate.py`, `scripts/check_artifacts.py`, `scripts/check_repo_standards.py` | `lib/contract.ts`, `copy-data.mjs`, `tests/*.spec.ts` (Playwright by use), `tools/render-svg.mjs` |
| documentation in the app | `docs/` (this wiki) | `content/methods.ts`, `content/sources.ts`, `content/architecture.ts`, `pages/MethodsPage.tsx`, `pages/DataPage.tsx`, `pages/AboutPage.tsx`, `components/ArchitectureModal.tsx`, `public/svg/tech/*.svg` |

Every name in this table exists in the tree; the map is MapLibre GL JS with its worker bundled by Vite
and registered through `setWorkerUrl` (`map/MapView.tsx`), the basemap style is assembled in
`lib/basemap.ts`.
