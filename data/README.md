# data/, the data contracts and layout

Governed by the two data contracts of the CAOS product archetype: an ingestion contract that decides
which sites can enter the catalog (the bring-your-own-site gate), and an artifact contract between the
offline bake and the web app.

## Layout

| Path | What | Git |
|---|---|---|
| `raw/` | downloaded sources: mining polygons, the training set, DEM tiles, satellite windows | git-ignored (the bake fetches them; set `RAJO_DATA_ROOT` to a large disk) |
| `cache/` | intermediate chips (6-band uint16 windows per site-year) | git-ignored |
| `examples/` | the site catalog (`sites.json`) and a tiny bring-your-own-site example that passes Contract 1 | committed |
| `derived/catalog.json` | the index: every baked site with its manifest path, the engine version | committed |
| `derived/sites/<id>/` | manifest, frames (WebP), masks (PNG), series (JSON), DEM delta and terrain tiles | committed (compact) |

## CONTRACT 1, ingestion: a site definition

Defined in `data-pipeline/rajo/contracts.py`. A site row is **accepted** iff it satisfies the schema;
**rejected** with a reason otherwise (never silently coerced); plausible-but-suspicious rows are **flagged**
(accepted, the flag recorded in the manifest).

| Field | Type | Rule |
|---|---|---|
| `id` | string | `^[a-z0-9-]{3,40}$`, unique |
| `name.en`, `name.es` | string | non-empty |
| `country` | ISO 3166-1 alpha-3 | three uppercase letters |
| `categories` | list | at least one of the controlled vocabulary (`copper-chile`, `copper-world`, `lithium-brine`, `iron`, `gold`, `lignite`, `diamonds`, `oil-sands`, `transition`, `closure`) |
| `seed.lon`, `seed.lat` | degrees | within [-180, 180] and [-85, 85] |
| `window_km` | float | in [4, 40]; default 20 |
| `first_year` | int | in [1984, 2026] |
| `season` | `{start_month, end_month}` | months in [1, 12]; used to pick the yearly frame |
| `facts` | list of `{text.en, text.es, source}` | every fact carries a source URL; a fact without a source is rejected |
| `polygons` | derived | the reference polygons (Maus 2022) within 12 km of the seed; a seed more than 3 km from the nearest polygon is **rejected** unless `no_reference_polygon: true`, which is then **flagged** |

Outlier policy: missing field or wrong type: reject; out-of-range coordinates: reject; no source on a
fact: reject; seed far from every reference polygon: reject (or flag with the explicit opt-out); a window
that would exceed 40 km: reject; first_year before the first Landsat 5 scene at the site: flag.

## CONTRACT 2, artifact: what the bake hands to the web

Defined in `data-pipeline/rajo/manifest.py` and mirrored in `frontend/src/lib/contract.ts`; a drift
between the two fails `tsc`. Every site manifest (`derived/sites/<id>/manifest.json`, schema
`rajo.site/v1`) carries: the site definition as accepted, the window (WGS84 bbox, UTM EPSG code, pixel
size, affine transform), the frames (year, sensor, scene id, acquisition date, cloud fraction, file, bytes,
sha256, mask files), the series (years and mined area in km2 per method, with change points), the DEM
block (epochs, delta file, cut and fill volumes, noise floor), the models used (name, version, sha256) and
the engine version. `derived/catalog.json` (schema `rajo.catalog/v1`) indexes every site.

`scripts/check_artifacts.py` validates the tree: every declared file exists with the declared size and
sha256, and the engine version is one value across the whole tree.

## Provenance and licenses

See `docs/data/` for every source with its license and the attribution block the app renders.
