#!/usr/bin/env bash
# Signal handler for run-local. Caller controls whether external stop owns cleanup.
control_runtime_trap() {
  exec 3>&-
  unset LIWAN_PROCESS_LOCK_FD
  local runtime_pid generation handoff
  runtime_pid="$(<"$HOME_DIR/processes/runtime.pid")"
  generation="$(<"$HOME_DIR/processes/generation")"
  handoff="$HOME_DIR/processes/stop-handoff"
  if [[ -f "$handoff" && ! -L "$handoff" && "$(<"$handoff")" == "$runtime_pid $generation" && "$runtime_pid" == "$$" && "$generation" =~ ^[a-f0-9]{32}$ ]]; then
    rm -f "$HOME_DIR/processes/runtime.pid" "$HOME_DIR/processes/runtime.start"
    exit 0
  fi
  source "$DEPLOY/runtime-trap-cleanup.sh"
  exit 0
}
