# 02 The two data contracts

## Contract 1, ingestion: which sites enter

`data-pipeline/rajo/contracts.py::validate_sites` is a pure function over the rows of
`data/examples/sites.json` (or a bring-your-own-site file with the same shape). A row is accepted,
rejected with a reason, or accepted with a flag. The full field table and the outlier policy are in
`data/README.md`; the decisions that matter:

- **A fact without a source is rejected.** Site cards show only sourced sentences, with the URL.
- **A seed more than 3 km from the nearest reference polygon is rejected**, unless the row says
  `no_reference_polygon: true`, in which case the site is accepted and flagged. The reference is the Maus
  et al. 2022 polygon set (44,929 polygons, CC BY-SA 4.0), read through its GeoPackage R-tree.
- **The window is a square of 4 to 40 km on the UTM grid of the seed**, 10 m pixels, origin snapped to 10 m,
  so every frame of a site shares one pixel grid across sensors and years.

## Contract 2, artifact: what the bake hands to the web

`data-pipeline/rajo/manifest.py` writes `data/derived/sites/<id>/manifest.json` (`rajo.site/v1`) and
`data/derived/catalog.json` (`rajo.catalog/v1`); `frontend/src/lib/contract.ts` mirrors the shapes and
`isCatalog` / `isSiteManifest` guard them at load time. Every declared file carries bytes and sha256.

`scripts/check_artifacts.py` (stdlib only, runs in CI) and the `validate` stage refuse: a declared file that
is missing, empty or drifted; a catalog whose `n_sites` disagrees with its entries; a tree with more than
one engine version (a partial bake); a site year with neither a frame nor a recorded gap reason.
