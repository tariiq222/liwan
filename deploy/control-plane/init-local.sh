#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
DEPLOY="$ROOT/deploy/control-plane"
HOME_DIR="${NASQ_CONTROL_HOME:-$HOME/.local/share/nasq-saas-control-local}"
export NASQ_CONTROL_HOME="$HOME_DIR"
NODE_BIN="${NASQ_NODE_BIN:-$(dirname "$(command -v node)")}"
NODE="$NODE_BIN/node"
COMPOSE=(docker compose -p nasq-saas-control-local -f "$DEPLOY/compose.yml")
if [[ ! -x "$NODE" ]] || [[ "$($NODE --version)" != v22.* ]]; then printf 'Node 22 is required; set NASQ_NODE_BIN to its bin directory.\n' >&2; exit 2; fi
for port in 55432 14179; do if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then printf 'Required loopback port %s is occupied.\n' "$port" >&2; exit 3; fi; done
mkdir -p "$HOME_DIR"; chmod 700 "$HOME_DIR"
for path in "$HOME_DIR/logs" "$HOME_DIR/operator-state" "$HOME_DIR/processes"; do mkdir -p "$path"; chmod 700 "$path"; done
for f in control-db-password control-service-key control-database-url inventory-v2.json runtime.env; do if [[ -e "$HOME_DIR/$f" ]]; then printf 'Refusing to overwrite existing runtime file: %s\n' "$f" >&2; exit 4; fi; done
if docker inspect nasq-saas-control-local-control-db-1 >/dev/null 2>&1 || docker volume inspect nasq-saas-control-local-db >/dev/null 2>&1 || docker network inspect nasq-saas-control-local-private >/dev/null 2>&1; then printf 'Refusing to initialize: isolated Compose resources already exist.\n' >&2; exit 5; fi
umask 077
openssl rand -hex 32 > "$HOME_DIR/control-db-password"
openssl rand -hex 48 > "$HOME_DIR/control-service-key"
DB_PASSWORD="$(<"$HOME_DIR/control-db-password")"
printf 'postgresql://nasq_control:%s@127.0.0.1:55432/nasq_control' "$DB_PASSWORD" > "$HOME_DIR/control-database-url"
printf '{"version":2,"targets":{}}\n' > "$HOME_DIR/inventory-v2.json"
cat > "$HOME_DIR/runtime.env" <<EOF
export CONTROL_INSTALLATION_ID=nasq-local-management
export CONTROL_HOST=127.0.0.1
export CONTROL_PORT=14179
export CONTROL_DATABASE_URL='$(<"$HOME_DIR/control-database-url")'
export CONTROL_SERVICE_KEY='$(<"$HOME_DIR/control-service-key")'
export NASQ_CLI_INVENTORY='$HOME_DIR/inventory-v2.json'
export NASQ_CLI_STATE_DIR='$HOME_DIR/operator-state'
export NASQ_REPOSITORY_ROOT='$ROOT'
export NASQ_CLI_PYTHON='/Users/tariq/code/odoo/.venv/bin/python'
EOF
chmod 600 "$HOME_DIR"/{control-db-password,control-service-key,control-database-url,runtime.env,inventory-v2.json}
unset DB_PASSWORD
printf 'Initialized private runtime configuration at %s; no service was started.\n' "$HOME_DIR"
printf 'Credentials are synthetic, stored mode 0600, and never printed. Inventory starts empty.\n'
