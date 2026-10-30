# Shared steps of the odoo-app-standalone and odoo-bridge stages; sourced by them, never run alone.
# The module lists come from tools/app_isolation.py (ranks of tools/arch_layers.json), never from the release list:
# these stages install only part of the product, the `odoo` stage installs all of it.

: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${ISOLATION_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"

# isolation_setup <module>: a fresh scratch database and temporary root for this run, removed on exit.
isolation_setup() {
  OCA_PATH="$(python3 -B tools/oca_addons.py path --check)"
  SCRATCH_DB="liwan_scratch_ci_iso_${1}_${GITHUB_RUN_ID}"
  SCRATCH_ROOT="$(mktemp -d)"
  mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
  trap 'dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" 2>/dev/null || true; rm -rf "$SCRATCH_ROOT"' EXIT
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" || true
  export LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/odoo-classification.json"
  python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode saas --output "$LIWAN_COMMERCIAL_CONFIG"
  ODOO_ARGS=(
    --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons,$OCA_PATH"
    --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER"
    -d "$SCRATCH_DB" --db-filter="^${SCRATCH_DB}$" --data-dir="$SCRATCH_ROOT/data"
  )
}

# isolation_install_and_test <modules> <test tags>: install on the scratch database and run those tests.
# The stage passes only when Odoo exited 0 AND its log carries a green verdict with at least one test.
isolation_install_and_test() {
  local odoo_rc=0
  "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" "${ODOO_ARGS[@]}" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
    -i "$1" --test-tags "$2" \
    --http-port="$ISOLATION_PORT" --workers=0 --max-cron-threads=0 --stop-after-init --log-level=test \
    2>&1 | tee "$SCRATCH_ROOT/odoo-test.log" || odoo_rc=$?
  [ "$odoo_rc" -eq 0 ] \
    && grep -Eq 'odoo.tests.result: 0 failed, 0 error\(s\) of [1-9][0-9]* tests when loading database' "$SCRATCH_ROOT/logs/odoo.log" \
    || { echo "odoo exited $odoo_rc or did not report 0 failures; errors and last log lines:" >&2
         grep -E ' (ERROR|CRITICAL) ' "$SCRATCH_ROOT/logs/odoo.log" | head -n 40 >&2 || true
         tail -n 80 "$SCRATCH_ROOT/logs/odoo.log" >&2; exit 1; }
  echo "tests: $(grep -E 'odoo.tests.result: ' "$SCRATCH_ROOT/logs/odoo.log" | tail -n 1 | sed -E 's/.*odoo.tests.result: //')"
}

# isolation_check <module>: no application or bridge beyond the ones this run asked for is installed.
isolation_check() {
  local installed
  installed="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -At -v ON_ERROR_STOP=1 \
    -c "SELECT string_agg(name, ',' ORDER BY name) FROM ir_module_module WHERE state = 'installed' AND name LIKE 'liwan%'")"
  echo "installed LiwanOS modules: $installed"
  python3 -B tools/app_isolation.py check "$1" --installed "$installed"
}

# isolation_probe <label>: deploy/ci/odoo_route_probe.py in an Odoo shell; the caller exports LIWAN_PROBE_*.
isolation_probe() {
  echo "--- route probe: $1"
  "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" shell "${ODOO_ARGS[@]}" --logfile="$SCRATCH_ROOT/logs/probe.log" --no-http \
    < deploy/ci/odoo_route_probe.py | tee "$SCRATCH_ROOT/probe.out" \
    || { echo "route probe '$1' failed; errors from its log:" >&2; grep -E ' (ERROR|CRITICAL) ' -A20 "$SCRATCH_ROOT/logs/probe.log" | head -n 60 >&2 || true; exit 1; }
  tail -n 1 "$SCRATCH_ROOT/probe.out" | grep -qx ROUTE_PROBE_OK \
    || { echo "route probe '$1' did not end with ROUTE_PROBE_OK" >&2; exit 1; }
}
