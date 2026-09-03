# 01 Run the bake

The bake is a set of plain Python scripts under `data-pipeline/`, run from the repository root through
the numbered local scripts or directly. It writes to a sandbox unless told otherwise.

```powershell
.\scripts\local\01_init.ps1                                        # once: .venv with the bake lane
.\scripts\local\02_generate-data.ps1                               # all stages, all sites, into build/local
.\scripts\local\02_generate-data.ps1 -Stage catalog                # one stage
.\scripts\local\02_generate-data.ps1 -Sites chuquicamata,escondida # a subset of sites
.\scripts\local\02_generate-data.ps1 -Release                      # the canonical bake into data/derived
```

```bash
./scripts/local/01_init.sh
./scripts/local/02_generate-data.sh
STAGE=catalog ./scripts/local/02_generate-data.sh
SITES=chuquicamata,escondida ./scripts/local/02_generate-data.sh
RELEASE=1 ./scripts/local/02_generate-data.sh
```

Direct form: `python data-pipeline/run.py <stage|all> [--sites a,b] [--years 1990,2012,2023-2025]
[--output DIR | --release] [--resume]`.

## Stages

| Stage | Reads | Writes |
|---|---|---|
| `catalog` | `data/examples/sites.json`, the Maus 2022 GeoPackage (downloaded on first use to the data root) | `sites/<id>/site.json` (the accepted definition, the window, the polygon ids), `sites/<id>/polygons.geojson`, `catalog-report.json` |
| `scenes` | `site.json`; Earth Search (Sentinel-2 L2A) and Planetary Computer (Landsat Collection 2 Level-2) STAC searches inside the site's season window, one query per year | `sites/<id>/scenes.json`: per year, the candidate same-day scene groups ranked by scene cloud cover and window coverage, per archive |
| `frames` | `scenes.json`; the scenes' cloud-optimized GeoTIFFs, windowed onto the site grid (10 m Sentinel-2, 30 m Landsat) | `sites/<id>/frames/<year>.webp` (true colour, 1024 px), `<year>-swir.webp` (SWIR, 512 px), `frames.json` (sensor, scene ids, date, data and clear fractions, flags, gaps), and the chip cache under the data root |
| `export` | every `sites/<id>/*.json` side-car and the files they point at | `sites/<id>/manifest.json` with bytes and sha256 per file, `catalog.json` |
| `validate` | the exported tree | a pass, or a list of every missing or drifted file and every year without a frame or a gap reason |

The mask, series and elevation stages are added as their units land; the orchestrator's stage list names
only what exists.

## Sandbox versus release

Without `--release` everything goes to `build/local` (or `--output DIR`). With `--release` the output is
`data/derived`, the committed evidence; the orchestrator accepts `--release` only for `all`, `export` and
`validate`, because a single stage into the canonical tree is how a partial bake happens. The `validate`
stage refuses a tree with more than one engine version.

Text artifacts (JSON, GeoJSON) are written with LF line endings on every platform and hashed byte for
byte; the artifact guard (`scripts/check_artifacts.py`) refuses a CR byte in a text artifact, because a
CRLF file hashed on Windows drifts from the LF bytes git stores and CI checks out.

## Long runs: detached, resumable, parallel

A full bake is hours (about 10 s per Landsat row-scene, 45 s per Sentinel-2 tile, 30 sites, 42 years).
Never run it inside an interactive session or through a shell pipeline: the detached launcher starts it
with its output written straight to a log file.

```powershell
.\scripts\local\run-detached-bake.ps1 -DataRoot X:\rajo-data              # all stages, all sites, release
.\scripts\local\run-detached-bake.ps1 -Stage frames -Sites chuquicamata -Sandbox
```

```bash
RAJO_DATA_ROOT=/data/rajo ./scripts/local/run-detached-bake.sh
STAGE=frames SITES=chuquicamata SANDBOX=1 ./scripts/local/run-detached-bake.sh
```

`--resume` (always set by the launcher) skips every site-year already recorded in `frames.json`, so a
killed run continues where it stopped.

The frames stage is embarrassingly parallel per site. Launch several workers on disjoint site lists into
ONE sandbox root (each writes only its own site directories), then harvest:

```powershell
.\scripts\local\run-detached-bake.ps1 -Stage frames -Sites antamina,centinela,collahuasi -Output build\par
.\scripts\local\run-detached-bake.ps1 -Stage frames -Sites belchatow,grasberg,morenci -Output build\par
# ... when every worker has finished:
.\scripts\local\harvest-frames.ps1 -DryRun            # which sites are complete
.\scripts\local\harvest-frames.ps1                    # copy into data\derived, then export + validate
```

```bash
STAGE=frames SITES=antamina,centinela OUTPUT=build/par ./scripts/local/run-detached-bake.sh
DRY_RUN=1 ./scripts/local/harvest-frames.sh
./scripts/local/harvest-frames.sh
```

The sandbox root must hold each site's `site.json`, `polygons.geojson` and `scenes.json` (copy them from
`data/derived/sites/<id>/` first). The harvest refuses a site whose `frames.json` is missing, whose frame
files are not all on disk, or which has a year that is neither baked nor declared a gap; it then runs
the canonical `export` and `validate` stages, so the manifests, hashes and the catalog are rebuilt from
what is really on disk.

## The data root

Raw downloads and intermediate chips are never in git. `RAJO_DATA_ROOT` (default `data/cache`) holds
them; set it to a large disk for a full bake. `RAJO_MODELS_ROOT` (default `models/`) holds checkpoints;
only the exported ONNX files are committed.
