#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
HOME_DIR="${LIWAN_CONTROL_HOME:-$HOME/.local/share/liwan-saas-control-local}"
ROOT="${LIWAN_REPOSITORY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
NODE_BIN="${LIWAN_NODE_BIN:-/opt/homebrew/opt/node@22/bin}"
state="$HOME_DIR/processes"
proc_start() { ps -p "$1" -o lstart= 2>/dev/null | xargs || true; }
# The supervisor is exec'd through startup_handoff as /bin/bash, while a direct
# launch uses bash; both name this exact script with these exact arguments.
runtime_command_ok() {
 local command="$1" script="$ROOT/deploy/control-plane/run-local.sh"; local -a argv
 read -r -a argv <<< "$command"
 [[ ${#argv[@]} -ge 2 && ${#argv[@]} -le 3 ]] || return 1
 case "$(basename "${argv[0]}")" in bash|sh) ;; *) return 1;; esac
 [[ "${argv[1]}" == "$script" ]] || return 1
 [[ ${#argv[@]} -eq 2 || "${argv[2]}" == runtime ]] || return 1
}
valid() {
 local name="$1" pid start expected actual command gen
 [[ -f "$state/$name.pid" && -f "$state/$name.start" ]] || return 1
 pid="$(<"$state/$name.pid")"; start="$(<"$state/$name.start")"; start="$(printf '%s' "$start" | xargs)"; [[ "$pid" =~ ^[0-9]+$ && -n "$start" ]] || return 1
 actual="$(proc_start "$pid")"; [[ "$actual" == "$start" ]] || return 1
 case "$name" in runtime) expected="";; api) expected="$NODE_BIN/node $ROOT/node_modules/tsx/dist/cli.mjs $ROOT/apps/control-plane/src/main.ts";; worker) expected="$NODE_BIN/node $ROOT/node_modules/tsx/dist/cli.mjs $ROOT/apps/control-plane/src/worker-main.ts";; esac
 command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
 if [[ "$name" == runtime ]]; then runtime_command_ok "$command" || return 1
 else [[ "$command" == "$expected" ]] || return 1; fi
 if [[ "$name" != runtime ]]; then [[ -f "$state/$name.generation" && -f "$state/generation" ]] || return 1; gen="$(<"$state/$name.generation")"; [[ "$gen" == "$(<"$state/generation")" && "$gen" =~ ^[a-f0-9]{32}$ ]] || return 1; fi
}
for name in runtime api worker; do valid "$name" || { printf '%s exact process identity not confirmed.\n' "$name" >&2; exit 2; }; done
printf 'Runtime/API/worker exact argv, start times and generation ownership verified.\n'
curl -fsS http://127.0.0.1:14179/healthz >/dev/null && printf 'Control API/database health HTTP 200.\n' || { printf 'Control API unavailable.\n' >&2; exit 3; }
