#!/usr/bin/env bash
# Rajo, step 2: the offline bake. Bash parity of 02_generate-data.ps1.
# Writes to a sandbox (build/local) unless RELEASE=1.
#
#   ./scripts/local/02_generate-data.sh
#   STAGE=frames SITES=chuquicamata,escondida ./scripts/local/02_generate-data.sh
#   RELEASE=1 ./scripts/local/02_generate-data.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

STAGE="${STAGE:-all}"; SITES="${SITES:-}"; RELEASE="${RELEASE:-0}"; RESUME="${RESUME:-0}"
VP=".venv/bin/python"; [ -x "$VP" ] || VP=".venv/Scripts/python.exe"
[ -x "$VP" ] || { echo "no .venv. Run: ./scripts/local/01_init.sh" >&2; exit 1; }

args=("data-pipeline/run.py" "$STAGE")
[ -n "$SITES" ] && args+=("--sites" "$SITES")
if [ "$RELEASE" = "1" ]; then args+=("--release"); else args+=("--output" "build/local"); fi
[ "$RESUME" = "1" ] && args+=("--resume")
"$VP" "${args[@]}"
