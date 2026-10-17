#!/usr/bin/env bash
# CI stage: webvue_tasks ALONE: no webvue_pmo, hook defaults, no projects.
# The module list is hard-coded on purpose: the `odoo` stage installs the whole release (where PMO's own
# record rule hides the webvue_tasks company clause), this one installs only part of it.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${TASKS_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"
SCRATCH_DB="webvue_scratch_ci_tasks_alone_${GITHUB_RUN_ID}"
MODULES="webvue_tasks"
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
  --test-tags "/webvue_tasks" \
  --http-port="$TASKS_PORT" --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test 2>&1 | tee "$SCRATCH_ROOT/odoo-test.log"
# --logfile keeps Odoo's log out of stdout, so the verdict is read from the logfile itself.
grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' "$SCRATCH_ROOT/logs/odoo.log" \
  || { echo "odoo tests did not report 0 failures; last log lines:" >&2; tail -n 80 "$SCRATCH_ROOT/logs/odoo.log" >&2; exit 1; }
grep -E 'odoo.tests.result:' "$SCRATCH_ROOT/logs/odoo.log" | tail -n 1
# The standalone proof is void if the PMO addons came along: webvue_tasks must not pull them in.
pmo_installed="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -At -v ON_ERROR_STOP=1 -c "SELECT name FROM ir_module_module WHERE name IN ('webvue_pmo', 'webvue_tasks_pmo') AND state = 'installed' ORDER BY name")"
echo "PMO addons installed (expected empty): '$pmo_installed'"
test -z "$pmo_installed" || { echo "webvue_tasks alone installed PMO addons: $pmo_installed" >&2; exit 1; }
tasks_state="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -At -v ON_ERROR_STOP=1 -c "SELECT state FROM ir_module_module WHERE name = 'webvue_tasks'")"
echo "webvue_tasks state: $tasks_state"
test "$tasks_state" = installed || { echo "webvue_tasks state is '$tasks_state', expected installed" >&2; exit 1; }
