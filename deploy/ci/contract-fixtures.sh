#!/usr/bin/env bash
# Nightly CI job: the committed contract fixtures still match what the Odoo serializers return.
#   deploy/ci/contract-fixtures.sh
# Installs every release module on a fresh scratch database and runs the tests of the fixture addons ONLY (the
# addons of packages/contracts/fixtures/manifest.json), with LIWAN_CONTRACT_FIXTURES set so LiwanApiCase records each
# listed route. That is the run `tools/contract_fixtures.py --check` makes locally: the recorder keeps the largest response
# any running test produced, so the result depends on which addons run together and must not be mixed with other tests.
# The recorded structure (key paths, JSON types, nullness) is then compared with the committed fixtures
# (`tools/contract_fixtures.py --compare`). Refresh locally with `python3 -B tools/contract_fixtures.py`.
set -euo pipefail
cd "$(dirname "$0")/../.."
OCA_PATH="$(python3 -B tools/oca_addons.py path --check)"
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${ODOO_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
ADDONS="$(python3 -B tools/contract_fixtures.py --addons)"
TAGS="$(printf '%s' "$ADDONS" | sed -E 's#(^|,)#\1/#g')"
SCRATCH_DB="liwan_scratch_ci_cf_${GITHUB_RUN_ID}"
SCRATCH_ROOT="$(mktemp -d)"
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs" "$SCRATCH_ROOT/fixtures"
cleanup() {
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" 2>/dev/null || true
  rm -rf "$SCRATCH_ROOT"
}
trap cleanup EXIT
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" || true
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode saas --output "$SCRATCH_ROOT/classification.json"
LOG="$SCRATCH_ROOT/logs/odoo.log"
odoo_rc=0
# Same verdict rule as deploy/ci/odoo.sh: Odoo exited 0 AND its log carries a green result with at least one test.
LIWAN_CONTRACT_FIXTURES="$SCRATCH_ROOT/fixtures" LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/classification.json" \
  "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons,$OCA_PATH" \
  --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  -d "$SCRATCH_DB" --db-filter="^${SCRATCH_DB}$" \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$LOG" \
  -i "$MODULES" \
  --test-tags "$TAGS" \
  --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test 2>&1 | tee "$SCRATCH_ROOT/odoo-test.log" || odoo_rc=$?
[ "$odoo_rc" -eq 0 ] \
  && grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' "$LOG" \
  || { echo "contract fixtures: odoo exited $odoo_rc or did not report 0 failures; errors and last log lines:" >&2
       grep -E ' (ERROR|CRITICAL) ' "$LOG" | head -n 40 >&2 || true; tail -n 80 "$LOG" >&2; exit 1; }
echo "contract fixtures: $(grep -E 'odoo.tests.result: ' "$LOG" | tail -n 1 | sed -E 's/.*odoo.tests.result: //')"
python3 -B tools/contract_fixtures.py --compare "$SCRATCH_ROOT/fixtures"
echo "contract fixtures: the recorded structure matches packages/contracts/fixtures"
