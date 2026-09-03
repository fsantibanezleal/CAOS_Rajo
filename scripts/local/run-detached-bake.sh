#!/usr/bin/env bash
# Rajo: launch the canonical bake detached (nohup, logs written directly). Bash parity of
# run-detached-bake.ps1.
#
#   ./scripts/local/run-detached-bake.sh
#   STAGE=frames SITES=chuquicamata,escondida SANDBOX=1 ./scripts/local/run-detached-bake.sh
#   RAJO_DATA_ROOT=/data/rajo ./scripts/local/run-detached-bake.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

STAGE="${STAGE:-all}"; SITES="${SITES:-}"; YEARS="${YEARS:-}"; SANDBOX="${SANDBOX:-0}"
VP=".venv/bin/python"; [ -x "$VP" ] || VP=".venv/Scripts/python.exe"
[ -x "$VP" ] || { echo "no .venv. Run: ./scripts/local/01_init.sh" >&2; exit 1; }

LOGDIR="${LOGDIR:-${RAJO_DATA_ROOT:-data/cache}/logs}"
mkdir -p "$LOGDIR"
STAMP=$(date +%Y%m%d-%H%M%S)
LOG="$LOGDIR/bake-$STAGE-$STAMP.log"; ERR="$LOGDIR/bake-$STAGE-$STAMP.err"

args=("data-pipeline/run.py" "$STAGE" "--resume")
[ -n "$SITES" ] && args+=("--sites" "$SITES")
[ -n "$YEARS" ] && args+=("--years" "$YEARS")
if [ "$SANDBOX" = "1" ]; then args+=("--output" "build/local"); else args+=("--release"); fi

nohup "$VP" "${args[@]}" >"$LOG" 2>"$ERR" &
echo "launched pid $!"
echo "  log: $LOG"
echo "  err: $ERR"
