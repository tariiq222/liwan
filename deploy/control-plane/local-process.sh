#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
mode="${1:-}"; name="${2:-}"
case "$mode:$name" in start:api|start:worker|start:runtime|stop:api|stop:worker|stop:runtime|status:api|status:worker|status:runtime|recover:runtime) ;; *) printf 'Usage: local-process.sh start|stop|status|recover api|worker|runtime\n' >&2; exit 2;; esac
HOME_DIR="${NASQ_CONTROL_HOME:-$HOME/.local/share/nasq-saas-control-local}"
ROOT="${NASQ_REPOSITORY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
NODE_BIN="${NASQ_NODE_BIN:-/opt/homebrew/opt/node@22/bin}"
state="$HOME_DIR/processes"; mkdir -p "$HOME_DIR"; chmod 700 "$HOME_DIR"; [[ ! -e "$state" || ( -d "$state" && ! -L "$state" ) ]] || { printf 'Process path is not a private directory; refusing.\n' >&2; exit 12; }; [[ -d "$state" ]] || mkdir -m 700 "$state"; chmod 700 "$state"
RECORD_NAMES=(generation runtime.pid runtime.start api.pid api.start api.generation worker.pid worker.start worker.generation)
if [[ -z "${NASQ_PROCESS_LOCK_FD:-}" ]]; then exec python3 "$(dirname "$0")/process_lock.py" --hold /bin/bash "$0" "$@"; fi
proc_start() { ps -p "$1" -o lstart= 2>/dev/null | xargs || true; }
expected() { case "$1" in api) printf '%s' "$NODE_BIN/node $ROOT/node_modules/tsx/dist/cli.mjs $ROOT/apps/control-plane/src/main.ts";; worker) printf '%s' "$NODE_BIN/node $ROOT/node_modules/tsx/dist/cli.mjs $ROOT/apps/control-plane/src/worker-main.ts";; runtime) printf '%s' "bash $ROOT/deploy/control-plane/run-local.sh";; esac; }
command_matches() {
 local name="$1" command="$2" expected_command index
 local -a actual expected_argv
 expected_command="$(expected "$name")"
 read -r -a actual <<< "$command"
 read -r -a expected_argv <<< "$expected_command"
 [[ ${#actual[@]} -eq ${#expected_argv[@]} && ${#actual[@]} -gt 0 ]] || return 1
 [[ "${actual[0]}" == "${expected_argv[0]}" || "${actual[0]}" -ef "${expected_argv[0]}" ]] || return 1
 for ((index=1; index<${#expected_argv[@]}; index++)); do
   [[ "${actual[$index]}" == "${expected_argv[$index]}" ]] || return 1
 done
}
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
# bash may duplicate the held lock to a high descriptor, so closing only fd 3 in a
# child subshell does not release it. Close every descriptor that is the lifecycle
# lock file (inode-verified, bounded scan) and drop the inherited capability.
close_lock_descriptors() {
 local lock="$HOME_DIR/processes.lock" ino n fdino
 unset NASQ_PROCESS_LOCK_FD
 [[ -e "$lock" ]] || return 0
 ino="$(/usr/bin/stat -f '%i' "$lock" 2>/dev/null || true)"; [[ -n "$ino" ]] || return 0
 for n in $(seq 3 63); do
  fdino="$(/usr/bin/stat -f '%i' "/dev/fd/$n" 2>/dev/null || true)"
  [[ -n "$fdino" && "$fdino" == "$ino" ]] || continue
  eval "exec ${n}>&-"
 done
}
valid() {
 local n="$1" pid start actual command gen
 [[ -f "$state/$n.pid" && -f "$state/$n.start" ]] || return 1
 pid="$(<"$state/$n.pid")"; start="$(<"$state/$n.start")"; start="$(printf '%s' "$start" | xargs)"; [[ "$pid" =~ ^[0-9]+$ && -n "$start" ]] || return 1
 actual="$(proc_start "$pid")"; [[ "$actual" == "$start" ]] || return 1
 command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
 if [[ "$n" == runtime ]]; then runtime_command_ok "$command" || return 1
 else
   command_matches "$n" "$command" || return 1
   [[ -f "$state/$n.generation" && -f "$state/generation" ]] || return 1
   gen="$(<"$state/$n.generation")"; [[ "$gen" == "$(<"$state/generation")" && "$gen" =~ ^[a-f0-9]{32}$ ]] || return 1
 fi
}
start_one() {
 python3 "$(dirname "$0")/process_lock.py" --check >/dev/null || { printf 'Lifecycle lock capability is invalid.\n' >&2; return 12; }
 local n="$1" pid start script
 [[ ! -e "$state/$n.pid" && ! -e "$state/$n.start" ]] || { printf 'Existing %s owner record; refusing duplicate start.\n' "$n" >&2; return 3; }
 [[ -f "$HOME_DIR/runtime.env" ]] || { printf 'Missing private runtime environment.\n' >&2; return 4; }
 if [[ "$n" == runtime ]]; then
   if valid api || valid worker; then printf 'Existing child process; refusing overlap.\n' >&2; return 5; fi
   (umask 077; exec 3>&- bash "$ROOT/deploy/control-plane/run-local.sh" runtime) >>"$HOME_DIR/logs/runtime.log" 2>&1 &
 else
   valid runtime && { printf 'Runtime supervisor owns children.\n' >&2; return 6; }
   [[ -f "$state/generation" ]] || { printf 'Runtime generation marker missing.\n' >&2; return 7; }
   cat "$state/generation" > "$state/$n.generation"; chmod 600 "$state/$n.generation"
   script=main; [[ "$n" != worker ]] || script=worker-main
   (umask 077; set -a; . "$HOME_DIR/runtime.env"; set +a; export PATH="$NODE_BIN:$PATH"; close_lock_descriptors; exec "$NODE_BIN/node" "$ROOT/node_modules/tsx/dist/cli.mjs" "$ROOT/apps/control-plane/src/$script.ts") >>"$HOME_DIR/logs/$n.log" 2>&1 &
 fi
 pid=$!; printf '%s\n' "$pid" > "$state/$n.pid"
 for _ in $(seq 1 30); do
   if ! kill -0 "$pid" 2>/dev/null; then printf '%s start failed; owner record kept.\n' "$n" >&2; return 8; fi
   start="$(proc_start "$pid")"
   if [[ -n "$start" ]]; then printf '%s\n' "$start" > "$state/$n.start"; chmod 600 "$state/$n.pid" "$state/$n.start"; valid "$n" && return 0; fi
   sleep 1
 done
 printf '%s identity uncertain; owner record retained.\n' "$n" >&2; return 9
}
if [[ -z "${NASQ_PROCESS_LOCK_FD:-}" ]]; then
  exec python3 "$(dirname "$0")/process_lock.py" /bin/bash "$0" "$@"
fi
if [[ "$mode" != recover ]]; then
  python3 "$(dirname "$0")/process_lock.py" --check >/dev/null || { printf 'Lifecycle lock capability is invalid.\n' >&2; exit 12; }
fi

recover_dead_generation() {
 python3 "$(dirname "$0")/recover_generation.py" "$HOME_DIR" "$state" || return $?
 return 0
}

# ESRCH-only proof for one recorded PID, reusing the recover_generation helper so
# there is no second definition of "definitively gone".
owner_absent() {
 python3 - "$(dirname "$0")" "$1" <<'PY'
import sys
sys.path.insert(0, sys.argv[1])
from recover_generation import pid_is_absent
print('absent' if pid_is_absent(int(sys.argv[2])) else 'present')
PY
}

# Classify every owner BEFORE any signal: exactly live (valid) or definitively
# ESRCH-absent. Reused-live, mismatched, EPERM/uncertain or incomplete records
# refuse. Sets OWNER_STATE_<name>; returns 1 on any uncertainty.
prevalidate_owners() {
 local n pid gen
 printf -v OWNER_STATE_runtime '%s' missing
 printf -v OWNER_STATE_api '%s' missing
 printf -v OWNER_STATE_worker '%s' missing
 [[ -f "$state/generation" && -f "$state/api.generation" && -f "$state/worker.generation" ]] || { printf 'Generation records are incomplete; refusing partial stop.\n' >&2; return 1; }
 gen="$(<"$state/generation")"
 [[ "$gen" =~ ^[a-f0-9]{32}$ && "$(<"$state/api.generation")" == "$gen" && "$(<"$state/worker.generation")" == "$gen" ]] || { printf 'Generation records are incoherent; refusing partial stop.\n' >&2; return 1; }
 for n in runtime api worker; do
  [[ -f "$state/$n.pid" && -f "$state/$n.start" ]] || { printf 'Owner %s record is incomplete; refusing partial stop.\n' "$n" >&2; return 1; }
  if valid "$n"; then
   printf -v "OWNER_STATE_$n" '%s' live
  else
   pid="$(<"$state/$n.pid")"
   if [[ "$pid" =~ ^[0-9]+$ ]] && [[ "$(owner_absent "$pid")" == absent ]]; then
    printf -v "OWNER_STATE_$n" '%s' dead
   else
    printf 'Owner %s is neither exactly owned nor provably gone; refusing signal.\n' "$n" >&2
    return 1
   fi
  fi
 done
 return 0
}

# Preserve the complete historical record set before touching anything. Used only
# when at least one owner is already gone; copied, never edited or invented.
archive_record_set() {
 local gen="$1" archive="$HOME_DIR/processes-archive-mixed-$1-$$" f
 [[ -e "$archive" ]] && { printf 'Archive destination already exists.\n' >&2; return 1; }
 mkdir -m 700 "$archive" || return 1
 for f in "${RECORD_NAMES[@]}"; do
  [[ -e "$state/$f" ]] || continue
  cp -p "$state/$f" "$archive/$f" || return 1
 done
 chmod -R go-rwx "$archive" 2>/dev/null || true
 printf '%s' "$archive"
}

stop_one() {
 python3 "$(dirname "$0")/process_lock.py" --check >/dev/null || { printf 'Lifecycle lock capability is invalid.\n' >&2; return 12; }
 local n="$1" pid start
 if [[ -e "$state/$n.pid" || -e "$state/$n.start" ]]; then
   valid "$n" || { printf 'Exact process identity mismatch for %s; refusing signal.\n' "$n" >&2; return 10; }
   pid="$(<"$state/$n.pid")"; start="$(<"$state/$n.start")"; command kill -TERM "$pid" 2>/dev/null || [[ "$(proc_start "$pid")" != "$start" ]] || return 10
   for _ in $(seq 1 30); do if ! kill -0 "$pid" 2>/dev/null || [[ "$(proc_start "$pid")" != "$start" ]]; then rm -f "$state/$n.pid" "$state/$n.start" "$state/$n.generation"; return 0; fi; sleep 1; done
   printf 'Stop timeout for %s; owner records retained.\n' "$n" >&2; return 11
 fi
}
case "$mode" in
 start) start_one "$name";;
 recover) [[ "$name" == runtime ]] || { printf 'Recovery is generation-wide; use runtime.\n' >&2; exit 2; }; recover_dead_generation;;
 stop)
    if [[ "$name" == runtime ]]; then
      prevalidate_owners || exit 10
      if [[ "$OWNER_STATE_runtime" == dead && "$OWNER_STATE_api" == dead && "$OWNER_STATE_worker" == dead ]]; then
        recover_dead_generation || exit $?
        printf 'Owned runtime stopped; dead generation archived; DB/data retained.\n'
        exit 0
      fi
      mixed=0
      [[ "$OWNER_STATE_runtime" == dead || "$OWNER_STATE_api" == dead || "$OWNER_STATE_worker" == dead ]] && mixed=1
      if [[ "$mixed" == 1 ]]; then archive="$(archive_record_set "$(<"$state/generation")")" || exit 10; fi
      [[ "$OWNER_STATE_api" == live ]] && { stop_one api || exit $?; }
      [[ "$OWNER_STATE_worker" == live ]] && { stop_one worker || exit $?; }
      if [[ "$OWNER_STATE_runtime" == live ]]; then
        pid="$(<"$state/runtime.pid")"; start="$(<"$state/runtime.start")"
        printf '%s %s\n' "$pid" "$(<"$state/generation")" > "$state/stop-handoff"
        chmod 600 "$state/stop-handoff"
        command kill -TERM "$pid" 2>/dev/null || [[ "$(proc_start "$pid")" != "$start" ]] || exit 10
        for _ in $(seq 1 30); do if ! kill -0 "$pid" 2>/dev/null || [[ "$(proc_start "$pid")" != "$start" ]]; then break; fi; sleep 1; done
        [[ "$(proc_start "$pid")" != "$start" ]] || { printf 'Stop timeout for runtime; owner records retained.\n' >&2; exit 11; }
      fi
      rm -f "$state/runtime.pid" "$state/runtime.start" "$state/stop-handoff" "$state/generation" \
            "$state/api.pid" "$state/api.start" "$state/api.generation" \
            "$state/worker.pid" "$state/worker.start" "$state/worker.generation"
      if [[ "$mixed" == 1 ]]; then printf 'Owned runtime stopped; dead owner records archived; DB/data retained.\n'
      else printf 'Owned runtime stopped; DB/data retained.\n'; fi
    else stop_one "$name"; fi;;
 status) valid "$name" || { printf '%s process is not confirmed.\n' "$name" >&2; exit 1; }; printf '%s exact argv/start-time ownership verified.\n' "$name"; if [[ "$name" == runtime ]]; then valid api && valid worker || { printf 'Child identity mismatch.\n' >&2; exit 2; }; curl -fsS http://127.0.0.1:14179/healthz >/dev/null && printf 'API/database HTTP 200.\n' || exit 3; fi;;
 *) printf 'Usage: local-process.sh start|stop|status|recover api|worker|runtime\n' >&2; exit 2;;
esac
