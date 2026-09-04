# 03 Train the models

The learned lane (M7 random forest, M8 U-Net) is trained by plain scripts under `data-pipeline/train/`,
run from the repository root in the `.venv` with the GPU lane installed. Every step is resumable and
every output carries its provenance in `models/registry.json`. Only the ONNX files, the registry and
the benchmark are committed; tiles, crop banks, checkpoints and the scikit-learn estimator stay under
the data root.

```powershell
.\scripts\local\01_init.ps1                                                    # once: the .venv
.\.venv\Scripts\python -m pip install -r requirements-gpu.txt --index-url https://download.pytorch.org/whl/cu126
$env:RAJO_DATA_ROOT = "X:\rajo-data"                                           # a large disk
```

Check the GPU is really used before a long run: `python -c "import torch; print(torch.cuda.is_available())"`.
The PyPI wheel of torch is CPU-only and training then silently runs on the CPU (measured 2026-09-03).

## 1 Fetch the training tiles

```powershell
.\.venv\Scripts\python data-pipeline\train\fetch_tiles.py --workers 8
```

Reads the Jasansky et al. 2024 GeoPackage (`<data root>/raw/jasansky2024/mining_area_data.gpkg`, from
doi:10.5281/zenodo.14195737), maps every product id to its Earth Search item (highest processing
baseline), reads the six bands and the scene classification onto the tile's own 10 m grid, rasterizes
the preferred polygons, and stores one compressed chip per tile under `<data root>/train/tiles/` with
`index.json`. Every tile whose footprint touches a catalog site window is marked `holdout=catalog`.
Products absent from both Earth Search collections (2016 acquisitions, a few later gaps) are logged and
skipped; the 2026-09-03 run fetched 1,112 of 1,207 split tiles in 134 minutes with eight workers.

## 2 The random forest

```powershell
.\.venv\Scripts\python data-pipeline\train\train_rf.py --version v1
```

Samples two million valid pixels (half inside the polygons) from the training tiles, computes the
sixteen features of `common.rf_features`, fits a bounded forest (64 trees, depth 12, 50 samples per
leaf, balanced class weights), exports it with skl2onnx, checks scikit-learn against onnxruntime on
100,000 held-out pixels (threshold 1e-5), scores validation, test and catalog tiles, and writes
`models/rf/rf-v1.onnx`, `models/rf/rf-v1.metrics.json` and the registry entry. About 25 minutes of
sampling on a busy machine, a minute of fitting, ten minutes of scoring.

```powershell
.\.venv\Scripts\python data-pipeline\train\export_forest.py --version v1
```

Writes the file the browser actually runs, `models/rf/rf-v1.forest.bin` (flat node arrays, float64
thresholds), checks the Python traversal against scikit-learn on 50,000 held-out pixels (1e-6) and
records `file_forest`, `sha256_forest` and `forest_parity` in the registry. onnxruntime-web has no
tree-ensemble kernel, so the ONNX file is archival and the worker traverses this file in TypeScript.
Then regenerate the golden fixture so `forest.test.ts` pins the TypeScript walk to the Python one:

```powershell
.\.venv\Scripts\python data-pipeline\train\make_golden.py
```

## 3 The U-Net

```powershell
.\.venv\Scripts\python data-pipeline\train\train_unet.py --build-bank --version v1
.\.venv\Scripts\python data-pipeline\train\train_unet.py --version v1 --epochs 40 --batch 16 --workers 4
.\.venv\Scripts\python data-pipeline\train\train_unet.py --version v1 --resume     # after a kill
```

The bank draws twelve 256 x 256 crops per training and validation tile (half centred on mined pixels)
into memory-mapped arrays; training runs AdamW with a cosine schedule, BCE + Dice over valid pixels,
mixed precision, flips, rotations, jitter and band dropout, validates a subset of full tiles every epoch
with sliding-window inference, stops after eight epochs without gain, and keeps `best.pt`, `last.pt` and
`manifest.json` under `<data root>/checkpoints/unet-v1/`. About 150 s per epoch on an RTX 4070 Laptop.

```powershell
.\.venv\Scripts\python data-pipeline\train\export_unet.py --version v1
```

Exports fp32 and fp16 ONNX (opset 17, dynamic spatial axes), checks PyTorch against onnxruntime on a real
held-out window (1e-3 and 1e-2) and writes the registry entry.

## 4 The held-out matrix

```powershell
.\.venv\Scripts\python data-pipeline\train\evaluate.py
```

Scores M4 Otsu, M5 k-means, M6 SAM, M7 and M8 on the same validation, test and catalog-holdout tiles:
pixel-pooled IoU, F1, precision and recall; per-tile mean and median IoU; boundary F1 at 2 px; per mine
type; and the learned methods under added haze. Validation chooses the SAM angle and the probability
thresholds of the learned methods (0.3 to 0.8), writes them into the registry (`threshold`), and test and
catalog are reported at those settings (0.5 alongside). Output: `models/benchmark.json` (rendered on
the app's Methods page) and `models/benchmark.per-tile.json`.

## 5 Apply the models to the bake and ship them

```powershell
.\.venv\Scripts\python data-pipeline\run.py masks --release --resume    # adds rf and unet masks per year
.\.venv\Scripts\python data-pipeline\run.py series --release            # rebuilds the series and breaks
.\.venv\Scripts\python data-pipeline\run.py export --release
.\.venv\Scripts\python data-pipeline\run.py validate --release
```

`copy-data.mjs` copies `models/**/*.onnx`, `models/**/*.forest.bin` and the JSON side-cars into the site
at build time; the instrument reads `models/registry.json` for the model cards and
`models/benchmark.json` for the held-out scores.

## Parity, the contract with the browser

The browser computes the same features and runs the same ONNX files. Three golden fixtures keep the two
sides aligned and fail the unit tests when they drift:

| Fixture | Written by | Replayed by |
|---|---|---|
| `frontend/src/workers/__fixtures__/rf_features_golden.json` | `data-pipeline/train/make_golden.py` | `frontend/src/workers/features.test.ts` |
| `frontend/src/lib/__fixtures__/changepoints_golden.json` | `data-pipeline/make_changepoint_golden.py` | `frontend/src/lib/changepoints.test.ts` |
| the ONNX parity records in `models/registry.json` | `train_rf.py`, `export_unet.py` | the model cards |

Regenerate a fixture whenever its definition changes, and commit both sides in the same commit.
