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
   nginx, keeps the last three releases.
6. Fetches the live `index.html` and `catalog.json` with a cache-busting query and refuses to report
   success unless the live title equals the build's, the live catalog is byte-identical to the build's,
   and `/?site=chuquicamata` answers 200. A 200 from an SPA fallback proves only that nginx is up, which
   is why the content check exists.

## First-time host setup (once per domain)

```bash
scp -i <key> deploy/rajo.fasl-work.com.nginx root@<host>:/etc/nginx/sites-available/rajo.fasl-work.com
ssh -i <key> root@<host> "mkdir -p /var/www/rajo.fasl-work.com; \
  ln -sf /etc/nginx/sites-available/rajo.fasl-work.com /etc/nginx/sites-enabled/; nginx -t && systemctl reload nginx; \
  certbot --nginx -d rajo.fasl-work.com --non-interactive --agree-tos -m <email> --redirect"
```

The nginx site sets `no-cache` on `index.html` (it names the hashed assets), immutable caching on
`/assets/`, one day on `/data/`, seven days on `.onnx` and `.wasm`, gzip including wasm and geo+json, and
the MIME types the app needs (onnx, wasm, geojson). DNS is a wildcard on the domain; no record is added
per host.

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
