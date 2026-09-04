# scripts/local

Everything needed to run Rajo on a fresh machine, in numeric order. All scripts resolve paths relative to
the repository root, so they can be invoked from anywhere. PowerShell is the primary shell; each script has
a `.sh` twin with the same behaviour, differing only where the platform forces it. String literals in the
PowerShell scripts are plain ASCII on purpose: Windows PowerShell 5.1 reads a `.ps1` as CP-1252 unless the
file carries a UTF-8 BOM, so a non-ASCII dash inside a string can silently terminate it.

**On a fresh machine, run them in order:**

    00_install-prereqs  ->  01_init  ->  03_dev

`02_generate-data` is the offline bake. It is NOT required to run the app: the committed artifacts under
`data/derived/` are what the deployed site serves.

## Two things worth knowing before you start

**There is no `.env` and nothing to provision.** Rajo has no backend, no database and no secret. It is a
static site over committed artifacts plus browser-side computation against open, keyless data sources.

**The artifacts are committed.** `data/derived/` holds the baked frames, masks, series and manifests.
Regenerating them downloads satellite windows from public archives and can take hours; running the app
takes seconds.

## `00_install-prereqs`

Checks Python 3.12 or newer, Node 22 or newer and git, matching what CI pins. Idempotent. **Both versions
only CHECK.** On PowerShell, `-Install` lets it use `winget`; the bash version only ever names what is
missing.

```powershell
.\scripts\local\00_install-prereqs.ps1
.\scripts\local\00_install-prereqs.ps1 -Install
```

```bash
./scripts/local/00_install-prereqs.sh
```

## `01_init`

One-stop setup from a fresh clone. Idempotent. Creates `.venv` with the offline bake lane and the dev
tooling, installs the frontend packages with `npm ci`, and, with `-Gpu`, installs the CUDA torch build for
the training lane.

```powershell
.\scripts\local\01_init.ps1
.\scripts\local\01_init.ps1 -Force        # rebuild .venv and node_modules
.\scripts\local\01_init.ps1 -Gpu          # also install the CUDA torch build
```

```bash
./scripts/local/01_init.sh
FORCE=1 ./scripts/local/01_init.sh
GPU=1 ./scripts/local/01_init.sh
```

## `02_generate-data`

The offline bake, in stages: catalog, scenes, frames, masks, series, dem, export, validate. **Writes to a
sandbox (`build/local`) unless `-Release` is passed**, because a bake that overwrote the committed
artifacts is how a release gets clobbered. `-Release` refuses a partial tree (mixed engine versions).

```powershell
.\scripts\local\02_generate-data.ps1                       # sandbox, all stages, all sites
.\scripts\local\02_generate-data.ps1 -Stage frames -Sites chuquicamata,escondida
.\scripts\local\02_generate-data.ps1 -Release              # write data/derived (the canonical bake)
```

```bash
./scripts/local/02_generate-data.sh
STAGE=frames SITES=chuquicamata,escondida ./scripts/local/02_generate-data.sh
RELEASE=1 ./scripts/local/02_generate-data.sh
```

Raw downloads and intermediate chips go to the data root, `RAJO_DATA_ROOT` (default: `data/cache` inside
the repo, git-ignored). Set it to a large disk for a full bake.

## `03_dev`

Runs the Vite dev server over the committed artifacts (`copy-data.mjs` copies them into the gitignored
`frontend/public/data` overlay; it never runs science and never writes back).

```powershell
.\scripts\local\03_dev.ps1
.\scripts\local\03_dev.ps1 -Port 5190
.\scripts\local\03_dev.ps1 -Preview      # build, then serve the built site
```

```bash
./scripts/local/03_dev.sh
PORT=5190 ./scripts/local/03_dev.sh
PREVIEW=1 ./scripts/local/03_dev.sh
```

## Release gates

```powershell
.\.venv\Scripts\python.exe -m ruff check data-pipeline tests scripts
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe scripts\check_artifacts.py
.\.venv\Scripts\python.exe scripts\check_content_standards.py
.\.venv\Scripts\python.exe scripts\check_repo_standards.py
cd frontend ; npm run typecheck ; npm run test ; npm run build ; npm run e2e
```
