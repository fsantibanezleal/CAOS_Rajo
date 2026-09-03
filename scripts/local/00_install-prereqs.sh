#!/usr/bin/env bash
# Rajo, step 0: system-level prerequisites. Bash parity of 00_install-prereqs.ps1.
# This version only ever CHECKS and names what is missing; there is no package manager to assume.
#
#   ./scripts/local/00_install-prereqs.sh
set -euo pipefail

PY_MIN="3.12"; NODE_MIN="22.0"
missing=0

vernum() { printf '%s' "$1" | grep -oE '[0-9]+\.[0-9]+' | head -1; }
atleast() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

printf '\nRajo prerequisites\n\n'

PY=""
for c in python3.12 python3 python; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -n "$PY" ]; then
  v=$(vernum "$("$PY" --version 2>&1)")
  if atleast "$v" "$PY_MIN"; then printf '  Python %s (%s), at or above the %s CI pin\n' "$v" "$PY" "$PY_MIN"
  else printf '  Python %s is below the %s CI pin\n' "$v" "$PY_MIN"; missing=1; fi
else
  printf '  Python not found\n'; missing=1
fi

if command -v node >/dev/null 2>&1; then
  v=$(vernum "$(node --version 2>&1)")
  if atleast "$v" "$NODE_MIN"; then printf '  Node %s, at or above the %s CI pin\n' "$v" "$NODE_MIN"
  else printf '  Node %s is below the %s CI pin\n' "$v" "$NODE_MIN"; missing=1; fi
else
  printf '  Node not found\n'; missing=1
fi

if command -v git >/dev/null 2>&1; then printf '  git present\n'; else printf '  git not found\n'; missing=1; fi

if command -v nvidia-smi >/dev/null 2>&1; then printf '  nvidia-smi present: the GPU training lane is available (GPU=1 01_init)\n'
else printf '  no nvidia-smi: the U-Net trains on CPU (slow) or reuse the committed ONNX\n'; fi

printf '\n'
if [ "$missing" = "1" ]; then
  printf '  Something is missing. Nothing was installed. Install it with your package manager and re-run.\n\n'
  exit 1
fi
printf '  All prerequisites present. Nothing installed.\n  Next:  ./scripts/local/01_init.sh\n\n'
