#!/usr/bin/env bash
# Rajo, step 1: one-stop setup from a fresh clone. Idempotent. Bash parity of 01_init.ps1.
#
#   ./scripts/local/01_init.sh
#   FORCE=1 ./scripts/local/01_init.sh    # rebuild .venv and node_modules
#   GPU=1 ./scripts/local/01_init.sh      # also install the CUDA torch build
set -euo pipefail
cd "$(dirname "$0")/../.."

FORCE="${FORCE:-0}"; GPU="${GPU:-0}"
PY=""
for c in python3.12 python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.12 or newer is required. Run: ./scripts/local/00_install-prereqs.sh" >&2; exit 1; }

printf '\nRajo init\n\n'
v=$("$PY" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
nv=$(node --version 2>&1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
printf '  [1/3] Python %s, Node %s\n' "$v" "$nv"

[ "$FORCE" = "1" ] && rm -rf .venv
[ -d .venv ] || "$PY" -m venv .venv
VP=".venv/bin/python"; [ -x "$VP" ] || VP=".venv/Scripts/python.exe"
"$VP" -m pip install --upgrade pip -q
"$VP" -m pip install -q -r requirements-precompute.txt -r requirements-dev.txt
if [ "$GPU" = "1" ]; then
  "$VP" -m pip install -q -r requirements-gpu.txt --index-url https://download.pytorch.org/whl/cu124
  printf '  [2/3] .venv ready, torch CUDA available: %s\n' "$("$VP" -c 'import torch;print(torch.cuda.is_available())')"
else
  printf '  [2/3] .venv ready (bake lane; GPU=1 for the training lane)\n'
fi

( cd frontend
  [ "$FORCE" = "1" ] && rm -rf node_modules
  if [ ! -d node_modules ]; then
    if [ -f package-lock.json ]; then npm ci; else npm install; fi
  fi )
printf '  [3/3] frontend packages installed\n'

# THERE IS NO .env AND NOTHING TO PROVISION: no backend, no database, no secret.
printf '\n  Ready. Next:  ./scripts/local/03_dev.sh\n'
printf '  (the offline bake is ./scripts/local/02_generate-data.sh; not needed to run the app)\n\n'
