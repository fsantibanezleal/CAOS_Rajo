# Changelog

All notable changes to Rajo are recorded here. The format follows Keep a Changelog; versions follow the
`X.XX.XXX` scheme (major = capability milestone, minor = completed feature, patch = fixes and polish).
The manifest (`frontend/package.json`) carries the semver form with zeros dropped.

## [Unreleased]

## [0.02.000] - 2026-09-03

The four lanes on the thirty sites, deployed at rajo.fasl-work.com.

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
  the forest exported as flat node arrays (`rf-v1.forest.bin`, float64 thresholds) and traversed in
  TypeScript because onnxruntime-web has no tree-ensemble kernel (Python and TypeScript walks both
  parity-checked), onnxruntime-web with the WebGPU provider and a WASM fallback for the U-Net (sliding
  windows with overlap blending, coarse or full grid), both as instrument methods with progress,
  backend, timing, area against the reference polygons, the model card, and the cursor probability
  readout.
- Relief profile: the stats survive a line that leaves the baked Copernicus window (length, global
  surface range, Copernicus coverage, change only where both surfaces answer); tiles that are not PNG
  (a static host answers a missing tile with the SPA page) are treated as missing; the cursor elevation
  readout divides out the terrain exaggeration.
- Theme swap with terrain on: the terrain is dropped before the style is replaced and restored on the
  new style's load (MapLibre's depth pass otherwise ran against a style without a projection).
- Site facts re-sourced: the Chilean copper cards carry Cochilco's by-company tonnages for 2024 and
  2025 and the first year with reported production; the cards outside Chile cite the operators' pages
  and filings (Freeport-McMoRan, MMG, Antamina, Rio Tinto, Ivanhoe Mines, PGE GiEK); two cards keep
  attributed pages where the operator is unreachable; unsourced wordings dropped. The Data page and
  docs/data/01_sources.md list the production tables and disclosures as a source group.
- Atlas: copper mine production by country (USGS Mineral Commodity Summaries 2026, 2024 and 2025
  estimated, reserves) next to Cochilco's reported 2025 total for Chile and the catalog's site counts.
- Parallel frame workers on disjoint site lists into one sandbox root, and the harvest that moves
  complete sites into the canonical tree and runs export and validate.
- Signal lane, offline: the masks stage (one mask per baked frame and method on the 30 m grid, scored
  inside the reference envelope), the series stage (mined-area series per method with sensor and
  validity, envelope index means, CUSUM and PELT change points with an in-house solver checked against
  ruptures, and the harmonic regression with breaks on the dense series), the dense stage (every clear
  Sentinel-2 date since 2017 at 60 m from the COG overviews); the manifest carries the frame gaps and
  the validate stage checks them and the series shapes.
- Signal lane, browser: the change-point code mirrored in TypeScript (golden fixture from Python), the
  series drawer above the timeline (uPlot: area per method with Landsat years shaded, PELT segments and
  breaks, CUSUM alarms, envelope indices, the dense series with harmonic breaks, a live PELT penalty,
  click-to-year), and the baked mask of the year draped over the frame.
- Reflectance is clamped at zero and normalised indices carry denominator floors, in Python and in the
  browser alike, so a dark pixel can no longer blow up an envelope mean.
- Deploy scripts (PowerShell and bash): guards, tests, build, tar over ssh into a release directory with
  an atomic swap, then a live check of the title, the catalog and a deep link.
- Relief lane: the dem stage (SRTM 2000 and Copernicus 2011 to 2015 on the site grid, geoid-corrected
  difference, stable-ground noise floor, cut and fill volumes, hillshades, terrarium tiles per site) and
  the Relief tab (epoch toggle, exaggeration, the difference draped, the profile tool sampling both
  surfaces from the tiles in the browser); the method page for M12.
- Documentation depth in the app: the Methods page (twelve methods with KaTeX equations, lane badges,
  sources with DOIs, caveats, and the held-out benchmark table when the models ship), the Data page
  (every source probed and licensed, the facts the bake relies on, the two contracts, the catalog as
  baked, the attribution block verbatim), the About page (lifecycle, rules, versioning, licences, how to
  cite), and the architecture modal behind the header's info button: five hand-authored, theme-aware,
  bilingual SVG diagrams (the app, the lanes, the web flow, the science, the data contracts) with a render
  harness that refuses hex colours and text crossing a box edge; a Playwright gate for all of it.

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
