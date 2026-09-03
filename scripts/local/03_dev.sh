#!/usr/bin/env bash
# Rajo, step 3: run the app locally. Bash parity of 03_dev.ps1.
#
#   ./scripts/local/03_dev.sh
#   PORT=5190 ./scripts/local/03_dev.sh
#   PREVIEW=1 ./scripts/local/03_dev.sh     # build, then serve the built site
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${PORT:-5901}"; PREVIEW="${PREVIEW:-0}"
[ -d frontend/node_modules ] || { echo "frontend packages are not installed. Run: ./scripts/local/01_init.sh" >&2; exit 1; }

# copy-data.mjs COPIES the committed artifacts into the gitignored public/data overlay. It never runs
# science and never writes back.
cd frontend
node copy-data.mjs

if [ "$PREVIEW" = "1" ]; then
  printf '\nBuilding, then serving the built site.\n'
  npm run build
  printf '\n  http://localhost:%s\n\n' "$PORT"
  npx vite preview --port "$PORT" --strictPort
else
  printf '\n  http://localhost:%s\n  Ctrl+C to stop.\n\n' "$PORT"
  npx vite --port "$PORT" --strictPort
fi
