# Changelog

All notable changes to Rajo are recorded here. The format follows Keep a Changelog; versions follow the
`X.XX.XXX` scheme (major = capability milestone, minor = completed feature, patch = fixes and polish).
The manifest (`frontend/package.json`) carries the semver form with zeros dropped.

## [Unreleased]

### Added

- Bake: the scenes stage (Earth Search and Planetary Computer searches grouped by acquisition day) and the
  frames stage (warped reads onto the site grid, data presence separated from quality-mask clearness,
  Landsat 7 scan-line gap compositing, true-colour and SWIR frames, the chip cache); detached launchers.
- Timeline bar (paused by default, keyboard, ticks, sensor and date readout, flags) and the georeferenced
  frame overlay draped on the terrain.
- Live lane: the latest clear Sentinel-2 scene read from the cloud-optimized GeoTIFFs into the browser,
  composites, nine spectral and mineral indices with perceptually uniform colormaps, histogram and
  statistics, cursor value readout; Otsu bare-ground mask, k-means clustering and spectral-angle mask with
  areas against the reference polygons; the method pages for M1 to M6.
- Learned lane, offline: the training tiles (Jasansky et al. 2024 geometry and split, Earth Search pixels,
  catalog sites held out), the sixteen-feature random forest with ONNX export and a scikit-learn versus
  onnxruntime parity gate, the U-Net (crop bank, masked BCE + Dice, mixed precision, early stopping,
  checkpoints), its fp32 and fp16 export with a PyTorch versus onnxruntime parity gate, Python mirrors of
  the classical methods, and the held-out benchmark (validation, test, catalog tiles; per mine type; haze
  degradation); the model registry; the method page for M7 and M8.
- Learned lane, browser: the feature stack mirrored in the worker (golden fixture pins it to Python),
  onnxruntime-web with the WebGPU provider and a WASM fallback, the forest and the U-Net (sliding
  windows with overlap blending, coarse or full grid) as instrument methods with progress, backend,
  timing, area against the reference polygons, the model card, and the cursor probability readout.
- Parallel frame workers on disjoint site lists into one sandbox root, and the harvest that moves
  complete sites into the canonical tree and runs export and validate.
- Deploy scripts (PowerShell and bash): guards, tests, build, tar over ssh into a release directory with
  an atomic swap, then a live check of the title, the catalog and a deep link.

### Changed

- Local dev and preview ports registered in the management repo (5901, 4901); browser gates never reuse a
  server they did not start and assert the page title first.
- LICENSE is the plain MIT text; data licenses moved to LICENSES.md.
- Text artifacts (JSON, GeoJSON) are written with LF on every platform and the artifact guard refuses a
  CR byte, so the hashes in the manifests match what git stores.
- The build overlay copies the models tree and the onnxruntime-web runtime next to the data.

## [0.01.000] - 2026-09-03

### Added

- Repository scaffold: MIT license, community files, versioning, content-standard and repository guards,
  CI (Python lint and tests in a sandbox, frontend typecheck, unit tests and build, integrity guards),
  numbered local scripts in PowerShell and bash, pinned requirement lanes (offline bake, GPU, dev).
- Offline pipeline skeleton with the staged layout (catalog, scenes, frames, masks, series, dem, export,
  validate) and the two data contracts (ingestion and artifact).
- Frontend skeleton: React 19 + Vite 6 + TypeScript, EN/ES i18n (English source), light/dark theming with
  no-flash pre-paint, routes (observatory, atlas, methods, data, about), design tokens.
