#!/usr/bin/env bash
# CI stage runner for one job of the odoo-app-standalone / odoo-bridge matrix (tools/app_isolation.py matrix).
#   deploy/ci/lib/isolation-group.sh deploy/ci/odoo-app-standalone.sh|deploy/ci/odoo-bridge.sh <module>...
# Runs the stage script once per module, each in its own process and scratch database, keeps going after a
# failure and fails at the end, naming every module that did not pass.
set -uo pipefail
cd "$(dirname "$0")/../../.."
STAGE="${1:?usage: isolation-group.sh deploy/ci/odoo-app-standalone.sh|deploy/ci/odoo-bridge.sh <module>...}"
shift
case "$STAGE" in deploy/ci/odoo-app-standalone.sh|deploy/ci/odoo-bridge.sh) ;; *) echo "unknown isolation stage: $STAGE" >&2; exit 2 ;; esac
test "$#" -gt 0 || { echo "no module given" >&2; exit 2; }
failed=()
for module in "$@"; do
  echo "::group::$STAGE $module"
  bash "$STAGE" "$module" || failed+=("$module")
  echo "::endgroup::"
done
if [ "${#failed[@]}" -gt 0 ]; then
  echo "$STAGE failed for: ${failed[*]}" >&2
  exit 1
fi
echo "$STAGE passed for: $*"
