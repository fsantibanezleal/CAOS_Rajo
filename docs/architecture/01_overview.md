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

| Concern | Bake (Python) | Browser (TypeScript) |
|---|---|---|
| catalog and windows | `data-pipeline/rajo/contracts.py`, `geo.py`, `stages/catalog.py` | `frontend/src/lib/contract.ts`, `state/catalog.ts` |
| scenes and frames | `stages/scenes.py`, `stages/frames.py` | `lib/stac.ts`, `lib/cog.ts` (live window reads) |
| band math | `indices.py` | `workers/indices.worker.ts` |
| learned models | `models/` (train, export, evaluate) | `workers/inference.worker.ts` |
| series and change points | `series.py`, `stages/series.py` | `workers/series.worker.ts` |
| elevation | `dem.py`, `stages/dem.py` | `map/terrain.ts`, `lib/profile.ts` |
| manifests | `manifest.py`, `stages/export.py`, `stages/validate.py` | `lib/contract.ts` |

The module list grows with each unit; a name appears here only once the module exists.
