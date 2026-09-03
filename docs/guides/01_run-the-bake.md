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

Direct form: `python data-pipeline/run.py <stage|all> [--sites a,b] [--output DIR | --release] [--resume]`.

## Stages

| Stage | Reads | Writes |
|---|---|---|
| `catalog` | `data/examples/sites.json`, the Maus 2022 GeoPackage (downloaded on first use to the data root) | `sites/<id>/site.json` (the accepted definition, the window, the polygon ids), `sites/<id>/polygons.geojson`, `catalog-report.json` |
| `export` | every `sites/<id>/*.json` side-car and the files they point at | `sites/<id>/manifest.json` with bytes and sha256 per file, `catalog.json` |
| `validate` | the exported tree | a pass, or a list of every missing or drifted file and every year without a frame or a gap reason |

The scene, frame, mask, series and elevation stages are added as their units land; the orchestrator's
stage list names only what exists.

## Sandbox versus release

Without `--release` everything goes to `build/local` (or `--output DIR`). With `--release` the output is
`data/derived`, the committed evidence; the orchestrator accepts `--release` only for `all`, `export` and
`validate`, because a single stage into the canonical tree is how a partial bake happens. The `validate`
stage refuses a tree with more than one engine version.

## The data root

Raw downloads and intermediate chips are never in git. `RAJO_DATA_ROOT` (default `data/cache`) holds
them; set it to a large disk for a full bake. `RAJO_MODELS_ROOT` (default `models/`) holds checkpoints;
only the exported ONNX files are committed.
