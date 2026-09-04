# 04 Deploy

Rajo is a static site (`vps-static`): nginx serves the built `frontend/dist` from a web root on the
production host; there is no backend, no port, no service and no environment file. The live instance is
`https://rajo.fasl-work.com`. The deploy is one script with refusals before and after the ship.

```powershell
$env:RAJO_SSH_KEY = "<vault>\credentials\general\ssh\hetzner_fasl_prod"
.\deploy\deploy.ps1                # guards, typecheck, unit tests, build, ship, live content check
.\deploy\deploy.ps1 -SkipTests     # when the gates ran a minute ago
```

```bash
RAJO_SSH_KEY=<vault>/credentials/general/ssh/hetzner_fasl_prod ./deploy/deploy.sh
```

## What the script does, in order

1. `scripts/check_artifacts.py`: every file named in a manifest exists with its declared bytes and
   sha256, one engine version, LF text artifacts.
2. `scripts/check_repo_standards.py`: VERSION, `package.json` and the CHANGELOG agree, no local path
   leaked, executable bits, no heavy data outside `data/derived`.
3. `npm run typecheck`, `npm run test` (skipped with `-SkipTests`), `npm run build` (which runs
   `copy-data.mjs`: `data/derived`, `models/` and the onnxruntime-web runtime overlaid into `public/`).
4. Refuses to continue without `dist/index.html` and a `<title>`.
5. Ships `dist/` with tar over ssh into a fresh release directory
   (`/var/www/<domain>.releases/<stamp>`), swaps the web root symlink atomically, tests and reloads
   nginx, keeps the last three releases. The PowerShell twin runs the pipeline in Git's own
   `bin\bash.exe` with MSYS paths (`/d/...`), `set -o pipefail` and `--no-same-owner` on the remote
   tar: a bare `bash` from PowerShell is the WSL launcher on a machine with WSL installed, where neither
   `D:/` nor `/d/` exists, and GNU tar reads `D:/...` as a remote host (both measured on the first
   deploy, 2026-09-03). A long ship is best launched detached with its output redirected to a log.
6. Fetches the live `index.html` and `catalog.json` with a cache-busting query and refuses to report
   success unless the live title equals the build's, the live catalog is byte-identical to the build's,
   `/?site=chuquicamata` answers 200, every client-side route (`/data`, `/data/`, `/methods`, `/atlas`,
   `/about`) answers 200 as `text/html` without a redirect, `index.html` is `text/html`, the hashed module
   named by it is `javascript`, the forest file is not the app shell, and a missing tile answers 404. A
   200 from an SPA fallback proves only that nginx is up, which is why the content checks exist.
7. After the script, run the live smoke by hand: a Playwright spec pointed at the live URL that loads
   the observatory, screenshots both themes and languages and the pages, and counts console errors. It
   found the `/data` route answering 404 and a stale footer version that the script's checks had passed.

## First-time host setup (once per domain)

```bash
scp -i <key> deploy/rajo.fasl-work.com.nginx root@<host>:/etc/nginx/sites-available/rajo.fasl-work.com
ssh -i <key> root@<host> "mkdir -p /var/www/rajo.fasl-work.com; \
  ln -sf /etc/nginx/sites-available/rajo.fasl-work.com /etc/nginx/sites-enabled/; nginx -t && systemctl reload nginx; \
  certbot --nginx -d rajo.fasl-work.com --non-interactive --agree-tos -m <email> --redirect"
```

The nginx site includes the standard MIME table first and then adds the types the app needs (onnx,
bin, wasm, geojson): a `types` block at server level replaces the whole table, so without the include
the app shell and the hashed modules are served as `application/octet-stream`. It sets `no-cache` on
`index.html` (it names the hashed assets), immutable caching on `/assets/`, one day on `/data/` and
`/svg/`, seven days on `/models/` and `/ort/`, gzip including wasm and geo+json. The SPA fallback
applies to routes only: `/assets/`, `/data/`, `/svg/`, `/models/` and `/ort/` answer 404 for a missing
file (the browser decoders treat a non-PNG tile as missing), and because the Data PAGE route `/data`
shares its name with the artifact prefix, exact `location = /data` and `location = /data/` blocks serve
the app shell. On the host, certbot appends its TLS and redirect blocks to the installed file: a change
to the repo file is applied by rebuilding the installed file from the repo file plus those blocks,
`nginx -t`, and a reload. DNS is a wildcard on the domain; no record is added per host.

## Before a release

- Bump `VERSION` (X.XX.XXX) and `frontend/package.json` (the semver form), move the `Unreleased` entries
  of `CHANGELOG.md` under the new version with the date, commit, tag `vX.XX.XXX`.
- Run the browser gates on the built tree: `npx playwright test` (fit, chrome, timeline, live, learned,
  series, relief, docs). They run against `npm run preview` on the registered port 4901 and assert the
  Rajo title before anything else.
- Merge the task branch into `develop`, then `develop` into `main`; deploy from the tagged commit.

## After a release

- Open the live URL in both themes and both languages, click through every tab of the instrument, the
  series drawer, the Relief tab, the architecture modal, the Methods and Data pages.
- Record the deploy (version, date, evidence) in the management repository's deployment record.
