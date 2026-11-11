#!/usr/bin/env bash
# CI stage: the whole release installed on a scratch database with its Odoo tests.
#   deploy/ci/odoo.sh                run the tests of every release module (single run, the local full check)
#   deploy/ci/odoo.sh --shard k/N    install every release module, run only shard k of N (tools/odoo_shards.py)
#   ODOO_TEST_MODULES=a,b deploy/ci/odoo.sh --shard k/N
#                                    same, but N shards split only the modules a,b (a pull request's affected set)
set -euo pipefail
cd "$(dirname "$0")/../.."
# Pinned OCA repositories (deploy/oca-addons.json), fetched by the setup action; appended after the LiwanOS addons.
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
  SCRATCH_DB="liwan_scratch_ci_${GITHUB_RUN_ID}_s${SHARD%/*}"
  TAGS="$(python3 -B tools/odoo_shards.py tags "$SHARD" ${ODOO_TEST_MODULES:+--modules "$ODOO_TEST_MODULES"})"
else
  SCRATCH_DB="liwan_scratch_ci_${GITHUB_RUN_ID}"
  TAGS="$(python3 -B tools/odoo_shards.py tags 1/1)"
fi
# The image starts Odoo through deploy/security/odoo_secure.py, which must keep pypdf's bounded decompressor after Odoo's
# import-time patch. Its test needs this stage's Odoo checkout and virtualenv; one run is enough, so only shard 1 (or the
# single run) executes it.
if [ -z "$SHARD" ] || [ "${SHARD%/*}" = 1 ]; then
  LIWAN_ODOO_ROOT="$ODOO_ROOT" "$ODOO_PYTHON" -B -m unittest discover -s deploy/security -p 'test_odoo_secure.py' -v
fi
SCRATCH_ROOT="$(mktemp -d)"
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
PROBE_DB="${SCRATCH_DB}_probe"
cleanup() {
  for db in "$SCRATCH_DB" "$PROBE_DB"; do dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$db" 2>/dev/null || true; done
  rm -rf "$SCRATCH_ROOT"
}
trap cleanup EXIT
# run_tests LABEL DATABASE INSTALL_MODULES TEST_TAGS: install the modules on a fresh scratch database and run the tagged tests.
# The stage passes only when Odoo exited 0 AND its log carries a green verdict with at least one test. The exit
# code is captured (not discarded) so a crash after a green result line still fails, and a failing run reaches
# the report below before the scratch root is removed.
# --logfile keeps Odoo's log out of stdout, so the verdict is read from the logfile itself.
run_tests() {
  local label="$1" db="$2" install="$3" tags="$4" odoo_rc=0
  local key="${label//[^A-Za-z0-9]/_}"
  local log="$SCRATCH_ROOT/logs/$key.log"
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$db" || true
  python3 deploy/classification.py fixture --database "$db" --mode saas --output "$SCRATCH_ROOT/$key-classification.json"
  LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/$key-classification.json" "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" \
    --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons,$OCA_PATH" \
    --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
    -d "$db" --db-filter="^${db}$" \
    --data-dir="$SCRATCH_ROOT/data" --logfile="$log" \
    -i "$install" \
    --test-tags "$tags" \
    --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test 2>&1 | tee "$SCRATCH_ROOT/$key-test.log" || odoo_rc=$?
  [ "$odoo_rc" -eq 0 ] \
    && grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' "$log" \
    || { echo "$label: odoo exited $odoo_rc or did not report 0 failures; errors and last log lines:" >&2; grep -E ' (ERROR|CRITICAL) ' "$log" | head -n 40 >&2 || true; tail -n 80 "$log" >&2; exit 1; }
  echo "$label: $(grep -E "odoo.tests.result: " "$log" | tail -n 1 | sed -E "s/.*odoo.tests.result: //")"
}
run_tests "shard ${SHARD:-all}" "$SCRATCH_DB" "$MODULES" "$TAGS"
# liwan_registry_probe is test-only: it adds a capability and a feature to the registries, so it must never share the
# database of the release tests or the release module list (tools/catalog_check.py TEST_ONLY_MODULES). Its tests need
# their own database; one run is enough, so only shard 1 (or the single run) executes it.
if [ -z "$SHARD" ] || [ "${SHARD%/*}" = 1 ]; then
  run_tests "registry-probe" "$PROBE_DB" liwan_registry_probe /liwan_registry_probe
fi
