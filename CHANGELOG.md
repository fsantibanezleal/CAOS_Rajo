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

### Changed

- Local dev and preview ports registered in the management repo (5901, 4901); browser gates never reuse a
  server they did not start and assert the page title first.
- LICENSE is the plain MIT text; data licenses moved to LICENSES.md.

## [0.01.000] - 2026-09-03

### Added

- Repository scaffold: MIT license, community files, versioning, content-standard and repository guards,
  CI (Python lint and tests in a sandbox, frontend typecheck, unit tests and build, integrity guards),
  numbered local scripts in PowerShell and bash, pinned requirement lanes (offline bake, GPU, dev).
- Offline pipeline skeleton with the staged layout (catalog, scenes, frames, masks, series, dem, export,
  validate) and the two data contracts (ingestion and artifact).
- Frontend skeleton: React 19 + Vite 6 + TypeScript, EN/ES i18n (English source), light/dark theming with
  no-flash pre-paint, routes (observatory, atlas, methods, data, about), design tokens.
