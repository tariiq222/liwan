#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
HOME_DIR="${LIWAN_CONTROL_HOME:-$HOME/.local/share/liwan-saas-control-local}"
export LIWAN_CONTROL_HOME="$HOME_DIR"
NODE_BIN="${LIWAN_NODE_BIN:-/opt/homebrew/opt/node@22/bin}"
export PATH="$NODE_BIN:$PATH"
NODE="$NODE_BIN/node"
NPM="$NODE_BIN/npm"
TEST_DB=liwan_control_scratch_p1tests5
RUNTIME_DB=liwan_control
[[ "$($NODE --version)" == v22.* ]] || { printf 'Node 22 is required.\n' >&2; exit 2; }
[[ -f "$HOME_DIR/control-db-password" && -f "$HOME_DIR/control-database-url" ]] || { printf 'Initialize local runtime first.\n' >&2; exit 3; }
[[ ! -e "$HOME_DIR/processes/runtime.pid" ]] || { printf 'Stop only the owned runtime first; refusing concurrent test mutation.\n' >&2; exit 4; }
[[ ! -e "$HOME_DIR/$TEST_DB.created" ]] || { printf 'Refusing to reuse a previous test database.\n' >&2; exit 5; }
CONTROL_DSN="$(<"$HOME_DIR/control-database-url")"
[[ "$CONTROL_DSN" == "postgresql://liwan_control:"*"@127.0.0.1:55432/liwan_control" ]] || { printf 'Runtime DSN is not the expected isolated control DB; refusing tests.\n' >&2; exit 6; }
export LIWAN_CONTROL_DB_PASSWORD="$(<"$HOME_DIR/control-db-password")"
export CONTROL_TEST_DATABASE_URL="postgresql://liwan_control:${LIWAN_CONTROL_DB_PASSWORD}@127.0.0.1:55432/$TEST_DB"
[[ "$CONTROL_TEST_DATABASE_URL" != "$CONTROL_DSN" && "$TEST_DB" != "liwan_control" && "$CONTROL_TEST_DATABASE_URL" == "postgresql://liwan_control:"*"@127.0.0.1:55432/$TEST_DB" ]] || { printf 'Test DSN does not select the fresh isolated scratch DB.\n' >&2; exit 6; }
COMPOSE=(docker compose -p liwan-saas-control-local -f "$ROOT/deploy/control-plane/compose.yml")
"${COMPOSE[@]}" ps --status running --services | grep -qx control-db || { printf 'Own isolated PostgreSQL is not running; start with run-local.sh.\n' >&2; exit 7; }
EXISTS="$("${COMPOSE[@]}" exec -T control-db psql -U liwan_control -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname='$TEST_DB'")"
[[ -z "$EXISTS" ]] || { printf 'Test database name already exists; refusing to reuse it.\n' >&2; exit 8; }
"${COMPOSE[@]}" exec -T control-db createdb -U liwan_control --encoding=UTF8 --template=template0 "$TEST_DB"
touch "$HOME_DIR/$TEST_DB.created"
chmod 600 "$HOME_DIR/$TEST_DB.created"
set +e
(cd "$ROOT" && "$NPM" -w apps/control-plane run build && CONTROL_TEST_DATABASE_URL="$CONTROL_TEST_DATABASE_URL" "$NPM" -w apps/control-plane run test -- --reporter=verbose) > "$HOME_DIR/logs/test-local.log" 2>&1
CODE=$?
set -e
if [[ $CODE -ne 0 ]]; then printf 'Control-plane local checks failed (exit %s); see private log file; no log content printed.\n' "$CODE" >&2; exit "$CODE"; fi
printf 'Control-plane build and tests passed; PostgreSQL integration used only newly-created %s on isolated port 55432. The DB and private logs are retained.\n' "$TEST_DB"
