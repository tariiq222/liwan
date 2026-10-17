#!/usr/bin/env bash
# CI stage: webvue_tasks with the PMO bridge only (webvue_tasks_pmo auto-installs; its dependencies come along).
# The module list is hard-coded on purpose: the `odoo` stage installs the whole release, this one installs only part of it.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${BRIDGE_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"
SCRATCH_DB="webvue_scratch_ci_tasks_bridge_${GITHUB_RUN_ID}"
MODULES="webvue_tasks,webvue_pmo,webvue_tasks_pmo"
SCRATCH_ROOT="$(mktemp -d)"
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
cleanup() { dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" 2>/dev/null || true; rm -rf "$SCRATCH_ROOT"; }
trap cleanup EXIT
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" || true
export WEBVUE_COMMERCIAL_CONFIG="$SCRATCH_ROOT/odoo-classification.json"
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode saas --output "$WEBVUE_COMMERCIAL_CONFIG"
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d "$SCRATCH_DB" --db-filter="^${SCRATCH_DB}$" \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
  -i "$MODULES" \
  --test-tags "/webvue_tasks,/webvue_tasks_pmo" \
  --http-port="$BRIDGE_PORT" --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test 2>&1 | tee "$SCRATCH_ROOT/odoo-test.log"
# --logfile keeps Odoo's log out of stdout, so the verdict is read from the logfile itself.
grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' "$SCRATCH_ROOT/logs/odoo.log" \
  || { echo "odoo tests did not report 0 failures; last log lines:" >&2; tail -n 80 "$SCRATCH_ROOT/logs/odoo.log" >&2; exit 1; }
grep -E 'odoo.tests.result:' "$SCRATCH_ROOT/logs/odoo.log" | tail -n 1
# The bridge must have auto-installed with its two parents.
bridge_state="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -At -v ON_ERROR_STOP=1 -c "SELECT state FROM ir_module_module WHERE name = 'webvue_tasks_pmo'")"
echo "webvue_tasks_pmo state: $bridge_state"
test "$bridge_state" = installed || { echo "webvue_tasks_pmo state is '$bridge_state', expected installed" >&2; exit 1; }
