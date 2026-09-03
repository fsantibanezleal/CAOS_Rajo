# deploy/

Rajo is a static site (`vps-static`): nginx serves the built `frontend/dist` from the web root
`/var/www/rajo.fasl-work.com/`. There is no backend, no port, no systemd unit and no environment file.

| File | Purpose |
|---|---|
| `rajo.fasl-work.com.nginx` | the nginx site: SPA fallback, cache headers, explicit MIME types for `.onnx` and `.wasm`, gzip |
| `deploy.ps1`, `deploy.sh` | build, verify, ship over SSH with an atomic swap, reload nginx, then check the LIVE content |

The scripts refuse to ship when: the artifact contract fails (`scripts/check_artifacts.py`), the tests or
the guards fail, the build did not produce `dist/index.html`, or, after shipping, the live page title or
the live `catalog.json` disagree with the local build. A 200 from an SPA fallback proves only that nginx
is up, which is why the content check exists.

First-time setup on the host (once per domain): copy the nginx site into `sites-available`, symlink it
into `sites-enabled`, `nginx -t && systemctl reload nginx`, then `certbot --nginx -d rajo.fasl-work.com`.
The deploy scripts assume the site and the certificate exist.
