#!/usr/bin/env bash
# CI stage: the whole release installed on a scratch database with its Odoo tests.
#   deploy/ci/odoo.sh                run the tests of every release module (single run, the local full check)
#   deploy/ci/odoo.sh --shard k/N    install every release module, run only shard k of N (tools/odoo_shards.py)
set -euo pipefail
cd "$(dirname "$0")/../.."
# Pinned OCA repositories (deploy/oca-addons.json), fetched by the setup action; appended after the WebVue addons.
OCA_PATH="$(python3 -B tools/oca_addons.py path --check)"
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${ODOO_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"
SHARD=""
case "${1:-}" in
  "") ;;
  --shard) SHARD="${2:?usage: odoo.sh --shard k/N}" ;;
  *) echo "usage: odoo.sh [--shard k/N]" >&2; exit 2 ;;
esac
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
if [ -n "$SHARD" ]; then
  SCRATCH_DB="webvue_scratch_ci_${GITHUB_RUN_ID}_s${SHARD%/*}"
  TAGS="$(python3 -B tools/odoo_shards.py tags "$SHARD")"
else
  SCRATCH_DB="webvue_scratch_ci_${GITHUB_RUN_ID}"
  TAGS="/${MODULES//,/,/}"
fi
SCRATCH_ROOT="$(mktemp -d)"
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
cleanup() { dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" 2>/dev/null || true; rm -rf "$SCRATCH_ROOT"; }
trap cleanup EXIT
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" || true
export WEBVUE_COMMERCIAL_CONFIG="$SCRATCH_ROOT/odoo-classification.json"
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode saas --output "$WEBVUE_COMMERCIAL_CONFIG"
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons,$OCA_PATH" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d "$SCRATCH_DB" --db-filter="^${SCRATCH_DB}$" \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
  -i "$MODULES" \
  --test-tags "$TAGS" \
  --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test 2>&1 | tee "$SCRATCH_ROOT/odoo-test.log" || odoo_rc=$?
# The stage passes only when Odoo exited 0 AND its log carries a green verdict with at least one test. The exit
# code is captured (not discarded) so a crash after a green result line still fails, and a failing run reaches
# the report below before the scratch root is removed.
# --logfile keeps Odoo's log out of stdout, so the verdict is read from the logfile itself.
[ "${odoo_rc:-0}" -eq 0 ] \
  && grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' "$SCRATCH_ROOT/logs/odoo.log" \
  || { echo "odoo exited ${odoo_rc:-0} or did not report 0 failures; errors and last log lines:" >&2; grep -E ' (ERROR|CRITICAL) ' "$SCRATCH_ROOT/logs/odoo.log" | head -n 40 >&2 || true; tail -n 80 "$SCRATCH_ROOT/logs/odoo.log" >&2; exit 1; }
echo "shard ${SHARD:-all}: $(grep -E "odoo.tests.result: " "$SCRATCH_ROOT/logs/odoo.log" | tail -n 1 | sed -E "s/.*odoo.tests.result: //")"
