# deploy/

Rajo is a static site (`vps-static`): nginx serves the built `frontend/dist` from the web root
`/var/www/rajo.fasl-work.com/`. There is no backend, no port, no systemd unit and no environment file.
The build overlays three trees into `dist/`: `data/` (the committed `data/derived`), `models/` (the ONNX
files and their registry and benchmark JSON from `../models`) and `ort/` (the onnxruntime-web WASM
runtime, loaded only when a learned method runs). Releases live under `/var/www/rajo.fasl-work.com.releases/`
and the web root is a symlink swapped atomically; the last three releases are kept.

| File | Purpose |
|---|---|
| `rajo.fasl-work.com.nginx` | the nginx site: the standard MIME table included first, then `.onnx`, `.bin`, `.wasm`, `.geojson`; SPA fallback for routes only (a missing file under `/assets/`, `/data/`, `/models/`, `/ort/` answers 404, never the app shell); cache headers; gzip. On the host, certbot appends its TLS and redirect blocks to this file, so a change here is applied by rebuilding the installed file from this one plus those blocks, then `nginx -t` and a reload |
| `deploy.ps1`, `deploy.sh` | build, verify, ship over SSH with an atomic swap, reload nginx, then check the LIVE content (title, catalog, every route as text/html, module and forest content types, 404 on a missing artifact). The PowerShell twin runs the tar-over-ssh pipeline in Git's `bin\bash.exe` with MSYS paths: a bare `bash` is the WSL launcher where WSL is installed |

The scripts refuse to ship when: the artifact contract fails (`scripts/check_artifacts.py`), the tests or
the guards fail, the build did not produce `dist/index.html`, or, after shipping, the live page title or
the live `catalog.json` disagree with the local build. A 200 from an SPA fallback proves only that nginx
is up, which is why the content check exists.

First-time setup on the host (once per domain): copy the nginx site into `sites-available`, symlink it
into `sites-enabled`, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d rajo.fasl-work.com`.
The deploy scripts assume the site and the certificate exist.
