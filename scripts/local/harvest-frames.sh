#!/usr/bin/env bash
# Rajo: harvest the frames baked by parallel workers into data/derived, then export + validate.
# Bash parity of harvest-frames.ps1.
#
#   ./scripts/local/harvest-frames.sh                      # every complete site under build/par
#   FROM=build/par SITES=antamina,centinela ./scripts/local/harvest-frames.sh
#   DRY_RUN=1 ./scripts/local/harvest-frames.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

FROM="${FROM:-build/par}"; SITES="${SITES:-}"; DRY_RUN="${DRY_RUN:-0}"; NO_STAGES="${NO_STAGES:-0}"
VP=".venv/bin/python"; [ -x "$VP" ] || VP=".venv/Scripts/python.exe"
[ -x "$VP" ] || { echo "no .venv. Run: ./scripts/local/01_init.sh" >&2; exit 1; }

args=("data-pipeline/harvest.py" "--from" "$FROM")
[ -n "$SITES" ] && args+=("--sites" "$SITES")
[ "$DRY_RUN" = "1" ] && args+=("--dry-run")
[ "$NO_STAGES" = "1" ] && args+=("--no-stages")

exec "$VP" "${args[@]}"
