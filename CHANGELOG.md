# Changelog

All notable changes to Rajo are recorded here. The format follows Keep a Changelog; versions follow the
`X.XX.XXX` scheme (major = capability milestone, minor = completed feature, patch = fixes and polish).
The manifest (`frontend/package.json`) carries the semver form with zeros dropped.

## [0.01.000] - 2026-09-03

### Added

- Repository scaffold: MIT license, community files, versioning, content-standard and repository guards,
  CI (Python lint and tests in a sandbox, frontend typecheck, unit tests and build, integrity guards),
  numbered local scripts in PowerShell and bash, pinned requirement lanes (offline bake, GPU, dev).
- Offline pipeline skeleton with the staged layout (catalog, scenes, frames, masks, series, dem, export,
  validate) and the two data contracts (ingestion and artifact).
- Frontend skeleton: React 19 + Vite 6 + TypeScript, EN/ES i18n (English source), light/dark theming with
  no-flash pre-paint, routes (observatory, atlas, methods, data, about), design tokens.
