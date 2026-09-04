#!/usr/bin/env bash
# Rajo: build, verify, ship to the VPS as a static site (vps-static), then check the LIVE content.
# Bash parity of deploy.ps1. The SSH key stays out of this repo.
#
#   RAJO_SSH_KEY=<vault>/credentials/general/ssh/hetzner_fasl_prod ./deploy/deploy.sh
#   SKIP_TESTS=1 ./deploy/deploy.sh
#
# Refuses to ship when: the artifact contract fails, the tests or the guards fail, the build did not
# produce dist/index.html, or, after shipping, the live page title or the live catalog.json disagree
# with the local build. First-time host setup (nginx site, certbot) is in deploy/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${RAJO_SSH_KEY:?set RAJO_SSH_KEY to the vault SSH key path}"
DOMAIN="${RAJO_DOMAIN:-rajo.fasl-work.com}"
TARGET="${RAJO_TARGET:-root@91.99.199.70}"
WEBROOT="/var/www/${DOMAIN}"
VP=".venv/bin/python"; [ -x "$VP" ] || VP=".venv/Scripts/python.exe"
[ -x "$VP" ] || { echo "no .venv. Run: ./scripts/local/01_init.sh" >&2; exit 1; }
VERSION=$(tr -d '[:space:]' < VERSION)
step() { echo "[deploy $(date +%H:%M:%S)] $*"; }

step "version ${VERSION} -> https://${DOMAIN}"
step "artifact contract"; "$VP" scripts/check_artifacts.py
step "repository standards"; "$VP" scripts/check_repo_standards.py
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  step "typecheck + unit tests"; (cd frontend && npm run typecheck && npm run test)
fi
step "build (copy-data overlays the committed data/derived)"; (cd frontend && npm run build)

DIST="frontend/dist"
[ -f "$DIST/index.html" ] || { echo "build produced no dist/index.html" >&2; exit 1; }
LOCAL_TITLE=$(grep -oE "<title>[^<]*</title>" "$DIST/index.html" | head -1 | sed -E 's#</?title>##g')
[ -n "$LOCAL_TITLE" ] || { echo "dist/index.html has no <title>" >&2; exit 1; }

STAMP=$(date +%Y%m%d-%H%M%S)
RELEASE="${WEBROOT}.releases/${STAMP}"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$TARGET")
step "ship: tar over ssh into ${RELEASE}, atomic swap"
"${SSH[@]}" "mkdir -p ${RELEASE}"
tar -C "$DIST" -cf - . | "${SSH[@]}" "tar -C ${RELEASE} -xf -"
"${SSH[@]}" "set -e; test -f ${RELEASE}/index.html; rm -rf ${WEBROOT}.previous; if [ -d ${WEBROOT} ] && [ ! -L ${WEBROOT} ]; then mv ${WEBROOT} ${WEBROOT}.previous; fi; ln -sfn ${RELEASE} ${WEBROOT}.next && mv -Tf ${WEBROOT}.next ${WEBROOT}; nginx -t >/dev/null 2>&1 && systemctl reload nginx; ls -1d ${WEBROOT}.releases/* | head -n -3 | xargs -r rm -rf"

step "live content check"
LIVE_TITLE=$(curl -fsS -H "Cache-Control: no-cache" "https://${DOMAIN}/?v=${STAMP}" | grep -oE "<title>[^<]*</title>" | head -1 | sed -E 's#</?title>##g')
[ "$LIVE_TITLE" = "$LOCAL_TITLE" ] || { echo "live title '${LIVE_TITLE}' differs from the build '${LOCAL_TITLE}'" >&2; exit 1; }
if ! cmp -s <(curl -fsS "https://${DOMAIN}/data/catalog.json?v=${STAMP}") "$DIST/data/catalog.json"; then
  echo "live catalog.json differs from the build" >&2; exit 1
fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/?site=chuquicamata")
[ "$CODE" = "200" ] || { echo "deep link answered ${CODE}" >&2; exit 1; }
# the server must name the types (a server-level `types` block without the mime include served the app
# shell and the hashed modules as application/octet-stream), and a missing artifact must answer 404
INDEX_TYPE=$(curl -sI "https://${DOMAIN}/index.html?v=${STAMP}" | grep -i "^content-type:" | tr -d '\r')
case "$INDEX_TYPE" in *text/html*) ;; *) echo "index.html served as '${INDEX_TYPE}', not text/html" >&2; exit 1;; esac
ASSET=$(curl -fsS "https://${DOMAIN}/?v=${STAMP}" | grep -oE 'src="/assets/[^"]+\.js"' | head -1 | sed -E 's/src="([^"]+)"/\1/')
[ -n "$ASSET" ] || { echo "index.html names no /assets/*.js module" >&2; exit 1; }
ASSET_TYPE=$(curl -sI "https://${DOMAIN}${ASSET}" | grep -i "^content-type:" | tr -d '\r')
case "$ASSET_TYPE" in *javascript*) ;; *) echo "${ASSET} served as '${ASSET_TYPE}', not javascript" >&2; exit 1;; esac
FOREST_TYPE=$(curl -sI "https://${DOMAIN}/models/rf/rf-v1.forest.bin" | grep -i "^content-type:" | tr -d '\r')
case "$FOREST_TYPE" in *text/html*) echo "the forest file answers as the app shell (not shipped or no 404 rule)" >&2; exit 1;; esac
MISSING=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/data/sites/chuquicamata/terrain/13/0/0.png")
[ "$MISSING" = "404" ] || { echo "a missing tile answered ${MISSING} instead of 404" >&2; exit 1; }
step "live: title '${LIVE_TITLE}', catalog identical, deep link 200 -> https://${DOMAIN} (v${VERSION})"
