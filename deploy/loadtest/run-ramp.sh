#!/usr/bin/env bash
# run-ramp.sh — wrapper for the k6 load-test scripts.
#
# Usage: run-ramp.sh BASE_URL [smoke|ramp|storm]
#
# Runs the selected k6 scenario against BASE_URL, writing the console log
# and the k6 --summary-export into results/ next to this script.
set -euo pipefail

usage() {
  echo "Usage: $(basename "$0") BASE_URL [smoke|ramp|storm]" >&2
  exit 1
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage

BASE_URL="$1"
SCENARIO="${2:-smoke}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

if ! command -v k6 >/dev/null 2>&1; then
  echo "Error: k6 is not on PATH. Install it first (https://k6.io/docs/getting-started/installation/)." >&2
  exit 1
fi

case "$SCENARIO" in
  smoke) K6_SCRIPT="$SCRIPT_DIR/k6/smoke.js" ;;
  ramp)  K6_SCRIPT="$SCRIPT_DIR/k6/ramp.js" ;;
  storm) K6_SCRIPT="$SCRIPT_DIR/k6/auth-storm.js" ;;
  *)     usage ;;
esac

if [ ! -f "$K6_SCRIPT" ]; then
  echo "Error: k6 script not found: $K6_SCRIPT" >&2
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$RESULTS_DIR/${SCENARIO}-${STAMP}.log"
SUMMARY_FILE="$RESULTS_DIR/${SCENARIO}-${STAMP}.json"

echo "Running k6 scenario '$SCENARIO' against $BASE_URL"
echo "  log:     $LOG_FILE"
echo "  summary: $SUMMARY_FILE"

k6 run \
  -e BASE="$BASE_URL" \
  --summary-export="$SUMMARY_FILE" \
  "$K6_SCRIPT" \
  2>&1 | tee "$LOG_FILE"

echo
echo "--- last 20 lines of $LOG_FILE ---"
tail -n 20 "$LOG_FILE"
