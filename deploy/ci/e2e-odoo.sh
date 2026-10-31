#!/usr/bin/env bash
# CI stage: the real-Odoo Playwright specs. Every release module is installed on a scratch database, tools/e2e_seed.py
# and the acceptance fixture create the accounts and records through Odoo, then a production Nuxt build serves the UI
# against that Odoo and the specs that write real data run in a browser. Deterministic: no model call, no API key.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD"
OCA_PATH="$(python3 -B tools/oca_addons.py path --check)"
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${ODOO_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}"
# The daily dev stack owns 8069 and 3000; test traffic never goes there (as tools/e2e_isolated.mjs).
[ "$ODOO_PORT" != 8069 ] || { echo "e2e-odoo: refusing ODOO_PORT 8069, the daily dev stack" >&2; exit 2; }
# The specs pin the origin (localhost:44300) and tools/e2e_seed.py and the fixture refuse any other database name.
SCRATCH_DB="liwan_scratch_e2e"
WEB_PORT=44300
[ "$WEB_PORT" != 3000 ] || { echo "e2e-odoo: refusing web port 3000" >&2; exit 2; }
SCRATCH_ROOT="$(mktemp -d)"
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
FIXTURE_DIR="$ROOT/.superpowers/real-odoo"
mkdir -p "$FIXTURE_DIR"
cleanup() {
  for pid in "${WEB_PID:-}" "${ODOO_PID:-}"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" 2>/dev/null || true
  rm -rf "$SCRATCH_ROOT"; rm -f "$FIXTURE_DIR/fixtures.json"
}
trap cleanup EXIT
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB"
export LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/odoo-classification.json"
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode saas --output "$LIWAN_COMMERCIAL_CONFIG"
cat > "$SCRATCH_ROOT/odoo.conf" <<CONF
[options]
addons_path = $ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$ROOT/odoo-addons,$OCA_PATH
db_host = $PGHOST
db_port = $PGPORT
db_user = $PGUSER
db_name = $SCRATCH_DB
dbfilter = ^${SCRATCH_DB}$
data_dir = $SCRATCH_ROOT/data
logfile = $SCRATCH_ROOT/logs/odoo.log
http_port = $ODOO_PORT
http_interface = 127.0.0.1
workers = 0
max_cron_threads = 0
list_db = False
CONF
odoo() { "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$SCRATCH_ROOT/odoo.conf" -d "$SCRATCH_DB" "$@"; }
odoo_shell() { "$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" shell -c "$SCRATCH_ROOT/odoo.conf" -d "$SCRATCH_DB" --no-http; }
dump_log() { tail -n 80 "$SCRATCH_ROOT/logs/odoo.log" >&2 || true; }
trap 'dump_log' ERR
odoo -i "$(python3 -B tools/catalog_check.py --release-modules)" --without-demo=all --stop-after-init
odoo_shell < tools/e2e_seed.py
E2E_REAL_FIXTURE_OUTPUT="$FIXTURE_DIR/fixtures.json" odoo_shell < apps/web/e2e/fixtures/real-odoo-acceptance.py
test -s "$FIXTURE_DIR/fixtures.json"
odoo > "$SCRATCH_ROOT/logs/odoo-stdout.log" 2>&1 &
ODOO_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$ODOO_PID"
  if curl -fs "http://127.0.0.1:$ODOO_PORT/web/health" >/dev/null; then break; fi
  sleep 2
done
curl -fs "http://127.0.0.1:$ODOO_PORT/web/health" >/dev/null
npm -w apps/web run postinstall
npx playwright install chromium
cd apps/web
export NUXT_ODOO_URL="http://127.0.0.1:$ODOO_PORT" NUXT_ODOO_DB="$SCRATCH_DB"
export NUXT_PUBLIC_WS_URL="ws://127.0.0.1:$ODOO_PORT/websocket"
npx nuxt build
PORT="$WEB_PORT" node .output/server/index.mjs > "$SCRATCH_ROOT/logs/nuxt.log" 2>&1 &
WEB_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$WEB_PID"
  if curl -fs "http://localhost:$WEB_PORT/login" >/dev/null; then break; fi
  sleep 2
done
curl -fs "http://localhost:$WEB_PORT/login" >/dev/null
export E2E_REAL_ODOO=1 E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_REAL_FIXTURE="$FIXTURE_DIR/fixtures.json"
npx playwright test e2e/real-odoo-acceptance.spec.ts e2e/real-odoo-services.spec.ts
