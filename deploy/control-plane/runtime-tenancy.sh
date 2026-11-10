#!/usr/bin/env bash
# Sourced by run-local.sh, local-process.sh and status-local.sh: the one reader of the
# tenancy mode of a local runtime. runtime.env is the operator-owned private file every
# child is launched from, so it alone decides; a value exported in the caller's shell
# must not. Callers assign the result, so a missing file stops them under `set -e`.
runtime_tenancy_mode() {
  [[ -f "$HOME_DIR/runtime.env" ]] || { printf 'Missing private runtime environment.\n' >&2; return 4; }
  ( unset LIWAN_TENANCY_MODE; set -a; . "$HOME_DIR/runtime.env"; set +a; printf '%s' "${LIWAN_TENANCY_MODE:-}" )
}
# A shared runtime must run the shared worker. A leftover record in a dedicated one is
# still checked, so a damaged generation is never reported healthy.
shared_worker_expected() { [[ "$1" == shared || -f "$2/shared-worker.pid" ]]; }
