# data-pipeline/, the offline bake

Plain Python scripts invoked by path (this repository declares no package). Run through
`scripts/local/02_generate-data.*` or directly:

```
python data-pipeline/run.py all                      # sandbox: build/local
python data-pipeline/run.py frames --sites chuquicamata,escondida --output build/local
python data-pipeline/run.py all --release            # the canonical bake into data/derived
```

Stages, in order (each deterministic, resumable, and independently testable):

| Stage | Module | Input | Output |
|---|---|---|---|
| `catalog` | `rajo/stages/catalog.py` | `data/examples/sites.json`, the Maus 2022 polygons | accepted sites with windows and polygon ids |
| `scenes` | `rajo/stages/scenes.py` | sites, the two STAC catalogs | one scene per site-year with cloud statistics |
| `frames` | `rajo/stages/frames.py` | scenes | 6-band uint16 chips (cache) and 1024 px WebP frames |
| `masks` | `rajo/stages/masks.py` | chips, the models | per-frame masks (Otsu, RF, U-Net) as PNG |
| `series` | `rajo/stages/series.py` | masks | mined-area series per method, change points |
| `dem` | `rajo/stages/dem.py` | SRTM GL1, Copernicus GLO-30 | delta raster, volumes, per-site terrain tiles |
| `export` | `rajo/stages/export.py` | everything above | site manifests + `catalog.json` with sha256 |
| `validate` | `rajo/stages/validate.py` | the derived tree | completeness report; fails on any missing cell |

Environment: `RAJO_DATA_ROOT` (raw downloads and chips; default `data/cache`), `RAJO_MODELS_ROOT`
(checkpoints; default `models/`). No secrets: Planetary Computer tokens are anonymous and fetched at run time.
