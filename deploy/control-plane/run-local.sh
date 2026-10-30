#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
mode="${1:-runtime}"
[[ "$mode" == runtime ]] || { printf 'Only runtime mode is externally supported.\n' >&2; exit 2; }
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
DEPLOY="$ROOT/deploy/control-plane"
HOME_DIR="${LIWAN_CONTROL_HOME:-$HOME/.local/share/liwan-saas-control-local}"
NODE_BIN="${LIWAN_NODE_BIN:-/opt/homebrew/opt/node@22/bin}"
NODE="$NODE_BIN/node"; NPM="$NODE_BIN/npm"
COMPOSE=(docker compose -p liwan-saas-control-local -f "$DEPLOY/compose.yml")
[[ -x "$NODE" && "$($NODE --version)" == v22.* ]] || { printf 'Node 22 required.\n' >&2; exit 2; }
for f in control-db-password control-service-key control-database-url inventory-v2.json runtime.env; do [[ -f "$HOME_DIR/$f" ]] || { printf 'Missing private runtime file: %s\n' "$f" >&2; exit 3; }; done
mkdir -p "$HOME_DIR"; chmod 700 "$HOME_DIR"
if [[ -e "$HOME_DIR/processes" ]]; then [[ -d "$HOME_DIR/processes" && ! -L "$HOME_DIR/processes" ]] || { printf 'Process path is not a private directory; refusing.\n' >&2; exit 4; }; else mkdir -m 700 "$HOME_DIR/processes"; fi
chmod 700 "$HOME_DIR/processes"
export LIWAN_CONTROL_HOME="$HOME_DIR" LIWAN_REPOSITORY_ROOT="$ROOT" LIWAN_NODE_BIN="$NODE_BIN"
if [[ -z "${LIWAN_PROCESS_LOCK_FD:-}" ]]; then exec python3 "$DEPLOY/process_lock.py" --hold python3 "$DEPLOY/startup_handoff.py" "$HOME_DIR" /bin/bash "$0" "$@"; fi
python3 "$DEPLOY/process_lock.py" --check || { printf 'Lifecycle lock capability is invalid.\n' >&2; exit 4; }
python3 "$DEPLOY/begin_generation.py" "$HOME_DIR" || { printf 'Existing runtime records could not be safely recovered.\n' >&2; exit 4; }
[[ -f "$HOME_DIR/processes/generation" && ! -L "$HOME_DIR/processes/generation" ]] || { printf 'Runtime generation reservation missing; refusing start.\n' >&2; exit 4; }
generation="$(<"$HOME_DIR/processes/generation")"
[[ "$generation" =~ ^[a-f0-9]{32}$ ]] || { printf 'Invalid reserved generation; refusing start.\n' >&2; exit 4; }
if lsof -nP -iTCP:14179 -sTCP:LISTEN >/dev/null 2>&1; then printf 'API port 14179 occupied.\n' >&2; exit 5; fi
export PATH="$NODE_BIN:$PATH" LIWAN_CONTROL_HOME="$HOME_DIR" LIWAN_REPOSITORY_ROOT="$ROOT" LIWAN_NODE_BIN="$NODE_BIN"
resource_present=0
if docker ps -aq --filter label=com.docker.compose.project=liwan-saas-control-local | grep -q . || docker inspect liwan-saas-control-local-control-db-1 >/dev/null 2>&1 || docker volume inspect liwan-saas-control-local-db >/dev/null 2>&1 || docker network inspect liwan-saas-control-local-private >/dev/null 2>&1; then resource_present=1; fi
if [[ "$resource_present" == 1 ]]; then
  if ! docker inspect liwan-saas-control-local-control-db-1 >/dev/null 2>&1; then printf 'Dedicated database volume/network exists without its container; refusing to attach or initialize.\n' >&2; exit 6; fi
  if ! python3 "$DEPLOY/resource_guard.py" >/dev/null; then printf 'Existing database resources do not match the recorded isolated runtime identity; refusing changes.\n' >&2; exit 6; fi
  docker inspect liwan-saas-control-local-control-db-1 --format '{{.State.Status}}' | grep -qx running || { printf 'Verified owned database is not running; refusing implicit start/recreate.\n' >&2; exit 6; }
else
  lsof -nP -iTCP:55432 -sTCP:LISTEN >/dev/null 2>&1 && { printf 'DB port 55432 occupied.\n' >&2; exit 5; }
  LIWAN_CONTROL_DB_PASSWORD="$(<"$HOME_DIR/control-db-password")" "${COMPOSE[@]}" up -d --wait --wait-timeout 60 control-db >/dev/null
  if ! python3 "$DEPLOY/resource_guard.py" >/dev/null; then printf 'New database identity could not be verified; do not retry automatically.\n' >&2; exit 6; fi
fi
ready=0
for _ in $(seq 1 60); do if docker exec liwan-saas-control-local-control-db-1 pg_isready -U liwan_control -d liwan_control >/dev/null 2>&1; then ready=1; break; fi; sleep 1; done
[[ "$ready" == 1 ]] || { printf 'Isolated DB failed readiness.\n' >&2; exit 7; }
set -a; . "$HOME_DIR/runtime.env"; set +a
"$NPM" -w apps/control-plane run migrate >/dev/null
# The lock descriptor remains held while all process owner records are published.
"$DEPLOY/local-process.sh" start api
"$DEPLOY/local-process.sh" start worker
printf '%s\n' "$$" > "$HOME_DIR/processes/runtime.pid"
ps -p $$ -o lstart= | xargs > "$HOME_DIR/processes/runtime.start"
chmod 600 "$HOME_DIR/processes/runtime."{pid,start} "$HOME_DIR/processes/generation"
for n in api worker; do printf '%s\n' "$generation" > "$HOME_DIR/processes/$n.generation"; chmod 600 "$HOME_DIR/processes/$n.generation"; done
source "$DEPLOY/runtime-trap.sh"
trap 'control_runtime_trap || exit $?; exit 0' TERM INT
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:14179/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:14179/healthz >/dev/null || { printf 'API readiness failed.\n' >&2; exit 9; }
printf 'Local control API ready at 127.0.0.1:14179; worker running.\n'
exec 3>&-
unset LIWAN_PROCESS_LOCK_FD
while :; do sleep 2; done
