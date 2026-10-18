#!/usr/bin/env bash
# CI stage: the whole release installed on a scratch database with its Odoo tests.
set -euo pipefail
cd "$(dirname "$0")/../.."
# Pinned OCA repositories (deploy/oca-addons.json), fetched by the setup action; appended after the WebVue addons.
OCA_PATH="$(python3 -B tools/oca_addons.py path --check)"
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${ODOO_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"
SCRATCH_DB="webvue_scratch_ci_${GITHUB_RUN_ID}"
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
TAGS="/${MODULES//,/,/}"
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
  --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test 2>&1 | tee "$SCRATCH_ROOT/odoo-test.log"
# --logfile keeps Odoo's log out of stdout, so the verdict is read from the logfile itself.
grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' "$SCRATCH_ROOT/logs/odoo.log" \
  || { echo "odoo tests did not report 0 failures; last log lines:" >&2; tail -n 80 "$SCRATCH_ROOT/logs/odoo.log" >&2; exit 1; }
