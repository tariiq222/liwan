#!/usr/bin/env bash
set -euo pipefail

# Usage: run-probe.sh BASE_URL PATH COOKIE '100 500 1000 2000 5000'
# Loops the given concurrency levels, running probe.cjs once per level.

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 BASE_URL PATH COOKIE '100 500 1000 2000 5000'" >&2
  exit 1
fi

BASE_URL="$1"
# probe.cjs reads the target from BASE, not BASE_URL.
BASE="$BASE_URL"
PATH_="$2"
COOKIE="$3"
LEVELS="$4"

DIR="$(cd "$(dirname "$0")" && pwd)"

for CONC in $LEVELS; do
  TOTAL=$((2 * CONC))
  export CONC TOTAL COOKIE PATH_ BASE_URL
  echo "=== concurrency=${CONC} total=${TOTAL} path=${PATH_} ==="
  (cd "$DIR" && node probe.cjs)
  sleep 2
done
