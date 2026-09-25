#!/usr/bin/env bash
# Direct TERM/INT cleanup when no external stop already owns the lifecycle lock.
set +x
set +v
set -euo pipefail
for n in api worker; do
  "$DEPLOY/local-process.sh" stop "$n" || exit 10
done
rm -f "$HOME_DIR/processes/runtime.pid" "$HOME_DIR/processes/runtime.start" "$HOME_DIR/processes/generation"
