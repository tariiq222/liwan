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
# A listener left on either port would take the traffic while our own server dies at start-up, and the stage
# would report a failure from the previous run's process. Refuse it up front, naming the port.
for port in "$ODOO_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "e2e-odoo: port $port is already in use; stop that process before running this stage" >&2
    exit 2
  fi
done
FIXTURE_DIR="$ROOT/.superpowers/real-odoo"
mkdir -p "$FIXTURE_DIR"
cleanup() {
  # Stop the servers first (Nuxt, then Odoo) so no connection holds the scratch database, then drop it.
  for pid in "${WEB_PID:-}" "${ODOO_PID:-}"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -9 "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists --force "$SCRATCH_DB" 2>/dev/null || true
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
# Started directly, not through odoo(): a backgrounded shell function would make $! the subshell, and the cleanup
# would leave Odoo running on the port.
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" -c "$SCRATCH_ROOT/odoo.conf" -d "$SCRATCH_DB" > "$SCRATCH_ROOT/logs/odoo-stdout.log" 2>&1 &
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
# The websocket goes through the same host the specs browse (localhost): a browser session cookie is bound
# to `localhost`, so a socket opened at `127.0.0.1` connects as the public user, delivers no push and leaves
# the realtime journeys to the polling fallback. Odoo answers on the loopback interface for both names.
export NUXT_PUBLIC_WS_URL="ws://localhost:$ODOO_PORT/websocket"
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
# A spec joins REAL_ODOO_SPECS only after it passes on a scratch database. `grep -rl E2E_REAL_ODOO apps/web/e2e` lists
# every guarded spec, and `tools/test_ci_scope.py` fails when one is in neither list, so a new spec cannot be forgotten.
REAL_ODOO_SPECS=(
  e2e/real-odoo-acceptance.spec.ts
  e2e/real-odoo-services.spec.ts
)
# Run here on 2026-11-08 and failing before their first assertion: each signs in with a single step as `admin`/`admin`,
# an account the scratch seed does not create (its accounts are `e2e_*` and sign in with a password and then a
# remembered device). They stay out by name until each is moved to the two-step sign-in.
# docs/verification/2026-11-08-e2e-odoo-run.md records the per-file result and reason.
EXCLUDED_REAL_ODOO_SPECS=(
  e2e/access-admin.spec.ts
  e2e/account.spec.ts
  e2e/activity.spec.ts
  e2e/appearance-user.spec.ts
  e2e/board.spec.ts
  e2e/hr-leave.spec.ts
  e2e/hr-people-access.spec.ts
  e2e/notifications.spec.ts
  e2e/project-admin.spec.ts
  e2e/projects-phase2.spec.ts
  e2e/realtime.spec.ts
  e2e/task-lifecycle.spec.ts
)
if [ "${#REAL_ODOO_SPECS[@]}" -eq 0 ]; then
  echo "e2e-odoo: REAL_ODOO_SPECS is empty; a green stage must run at least one journey" >&2; exit 2
fi
npx playwright test "${REAL_ODOO_SPECS[@]}"
