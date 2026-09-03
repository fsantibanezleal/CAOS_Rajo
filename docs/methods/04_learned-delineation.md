# 04 Learned delineation: random forest (M7) and U-Net (M8)

Question 2 again, where is the mine, answered by two models trained offline on labelled tiles and run
in the browser on the live scene. The classical methods of [03](03_classical-delineation.md) use one
scene's statistics; these two carry what 1,200 mines look like from orbit. Both ship as ONNX files and
run through onnxruntime-web inside the band-math worker, so the same pixels the classical masks see are
the pixels the models see.

## Training and evaluation data

Jasansky, Maus, Popa and Wilbik 2024, *Global ML-ready dataset for mining areas in satellite images*,
doi:10.5281/zenodo.14195737, CC BY-SA 4.0. The GeoPackage carries, per tile, the 2048 x 2048 footprint
of a Sentinel-2 Level-2A product, the product id, the preferred mining-area polygons (Maus 2022 or Tang
2023, chosen by the authors) and a train/validation/test split (890 / 201 / 116 tiles; 307 tiles carry
no split and are not used). The pixels are not in the archive: `data-pipeline/train/fetch_tiles.py`
finds each product on Earth Search by MGRS tile and acquisition date (two items exist per date, the
original processing baseline and the 05.00 reprocessing with the BOA offset; the highest baseline wins
and the STAC scale and offset are applied), reads the six bands and the scene classification onto the
tile's own 10 m grid, rasterizes the preferred polygons, and stores one compressed chip per tile.

Leakage rules. The published split is site-level, so no tile of a held-out site is seen in training. In
addition every tile whose footprint touches a Rajo catalog window (25 of the 1,207) is removed from
training and validation and evaluated only as `catalog`, so the numbers on the site cards are never
in-sample. Tiles with more than 10% cloud (scene classification) or less than 98% data are dropped from
training and scoring.

## M7 Random forest on per-pixel features

Sixteen features per pixel, computed identically in Python (`data-pipeline/train/common.py`) and in the
browser (`frontend/src/workers/features.ts`; a golden fixture pins every plane to 1e-5):

| Group | Features |
|---|---|
| bands | $\rho_{B2}, \rho_{B3}, \rho_{B4}, \rho_{B8}, \rho_{B11}, \rho_{B12}$ |
| indices ([01](01_composites-and-indices.md)) | NDVI, MNDWI, BSI, NDBI |
| mineral ratios ([02](02_mineral-ratios.md)) | $R_{Fe^{3+}} = \rho_{B4}/\rho_{B2}$, $R_{OH} = \rho_{B11}/\rho_{B12}$, $R_{Fe^{2+}} = \rho_{B12}/\rho_{B8A}$ |
| texture (3 x 3, edge repeated) | mean and standard deviation of BSI, mean of NDVI |

Two million pixels are drawn from the training tiles, half inside the polygons and half outside,
valid pixels only, and a forest is fitted with balanced class weights (Breiman 2001, *Random forests*,
Machine Learning 45, 5-32, doi:10.1023/A:1010933404324). The forest is bounded on purpose: 64 trees,
depth at most 12, at least 50 samples per leaf. An unbounded 200-tree forest on two million pixels is
hundreds of megabytes as an ONNX `TreeEnsembleClassifier`; the bound and the resulting file size are
recorded in `models/registry.json` next to the held-out scores. Export uses skl2onnx (opset 17, ai.onnx.ml
3), and the parity gate requires scikit-learn and onnxruntime to agree to $10^{-5}$ in probability on
100,000 held-out pixels.

In the browser the worker builds the feature planes, streams them through the forest in chunks of
65,536 rows on the WASM provider (tree ensembles are a CPU operator), and turns the probability map
into a mask with the same clean-up as every other method: threshold, a 3 x 3 binary opening, blobs
below 25 pixels dropped.

## M8 U-Net semantic segmentation

Ronneberger, Fischer and Brox 2015, *U-Net: convolutional networks for biomedical image segmentation*,
MICCAI, doi:10.1007/978-3-319-24574-4_28. Four-level encoder-decoder with skip connections, base width
32 (32-64-128-256, bottleneck 512), batch normalisation, ReLU, bilinear up-sampling followed by
concatenation and two convolutions, a 1 x 1 head with one logit per pixel; 7.85 million parameters,
31 MB in float32, about 16 MB in float16.

Input: the six bands at 10 m (B11 and B12 resampled bilinearly from 20 m, which is what the browser
read does too), reflectance clipped at 0.6 and scaled to [0, 1]. Loss: binary cross-entropy plus soft
Dice over valid pixels (clouds and no-data carry no gradient):

$$\mathcal{L} = \mathrm{BCE} + \left(1 - \frac{2\sum_i p_i g_i + \epsilon}{\sum_i p_i + \sum_i g_i + \epsilon}\right)$$

(Milletari, Navab and Ahmadi 2016, *V-Net*, 3DV, doi:10.1109/3DV.2016.79 for the Dice term.) Training
draws a fixed bank of twelve 256 x 256 crops per tile, half of them centred on mined pixels, and runs
AdamW (learning rate 3e-4, weight decay 1e-4) with a cosine schedule, mixed precision, flips, 90-degree
rotations, brightness and contrast jitter, band dropout at 5%, early stopping on validation IoU with
patience 8, one checkpoint per epoch, and every seed recorded in the checkpoint manifest. Validation
scores full 2048 x 2048 tiles through the same sliding-window inference the browser uses: 512 x 512
windows with 64 pixels of overlap blended by a cosine ramp.

Export: ONNX opset 17 with dynamic spatial axes (only Conv, Resize, MaxPool, ReLU and Concat, which the
WebGPU and WASM providers both run). Parity gate: the same held-out window through PyTorch and
onnxruntime must agree to $10^{-3}$ in probability for float32 and $10^{-2}$ for float16. In the browser
the worker runs the WebGPU provider when the page has one and falls back to single-threaded WASM; the
default grid is the coarse one (20 m, four times fewer windows) so the WASM path answers in tens of
seconds, and the 10 m grid is one click away. The instrument prints which backend answered, how many
windows ran and how long it took.

## The held-out matrix

`data-pipeline/train/evaluate.py` scores M4, M5, M6, M7 and M8 on the same tiles with the same metrics:
pixel-pooled IoU, F1, precision and recall over valid pixels; per-tile mean and median IoU; boundary F1
at 2 pixels; per mine type (surface, placer, underground, brine and evaporation); and, for the learned
methods, the degradation under added haze (a constant reflectance added to every band: 0.02, 0.05,
0.10). The validation split chooses the SAM angle and nothing else; test and catalog are reported as
they come. The output, `models/benchmark.json`, is what the app renders; the worse arm is what the
documentation quotes.

Precedents for the reader: MineSegSAT (MacDonald, Jacoby and Coady 2023, arXiv:2311.01676, SegFormer on
Sentinel-2 over western Canada); the multi-modal mining footprint segmentation study, Remote Sensing of
Environment 2024, doi:10.1016/j.rse.2024.114584; Gallwey et al. 2020, *A Sentinel-2 based multispectral
convolutional neural network for detecting artisanal small-scale mining in Ghana*, Remote Sensing of
Environment 248, 111970, doi:10.1016/j.rse.2020.111970.

## Caveats

- The labels are polygons of mining land use (pits, dumps, ponds, plants, tailings), not ore and not
  disturbance of a given year: a rehabilitated dump stays inside the polygon.
- The training scenes are one date per site; a live scene in another season or under haze is a domain
  shift, which the haze curve quantifies for one kind of shift only.
- The forest sees 3 x 3 neighbourhoods and nothing larger; the U-Net sees 256 x 256 in training and
  512 x 512 at inference. Long, thin features (roads, conveyors) are where the two disagree most.
- Both models are evaluated on Sentinel-2 only; the Landsat frames of the time-lapse are not their
  domain, which is why the mined-area series of the signal lane comes from the offline bake, not from
  these models applied to 1985.
