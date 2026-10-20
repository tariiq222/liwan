#!/usr/bin/env bash
# CI stage: one WebVue bridge with its two sides.
#   deploy/ci/odoo-bridge.sh <bridge>     a rank-5 module of tools/arch_layers.json (matrix: app_isolation.py matrix bridges)
# Installs only the bridge's two sides on a fresh scratch database: the bridge must auto-install and its tests
# pass, and nothing else may come along. The route probe then runs with every feature on, and once per side
# with the OTHER side's features switched off: an application side's routes keep answering (a shared-service
# side's routes only must not fail), the switched-off side's routes refuse with feature_not_included (nothing
# leaks), and the bridge's routes fail with no server error.
set -euo pipefail
cd "$(dirname "$0")/../.."
BRIDGE="${1:?usage: odoo-bridge.sh <bridge>}"
# shellcheck source=lib/odoo-isolation.sh
. deploy/ci/lib/odoo-isolation.sh
IFS=, read -r -a SIDES <<< "$(python3 -B tools/app_isolation.py install "$BRIDGE")"
test "${#SIDES[@]}" -eq 2 || { echo "$BRIDGE is not a rank-5 bridge with two sides" >&2; exit 1; }
isolation_setup "$BRIDGE"
isolation_install_and_test "${SIDES[0]},${SIDES[1]}" "/$BRIDGE"
isolation_check "$BRIDGE"
WEBVUE_PROBE_ANSWER="${SIDES[0]},${SIDES[1]}" WEBVUE_PROBE_ALSO_ANSWER="$BRIDGE" \
  isolation_probe "$BRIDGE with both sides on"
for side in 0 1; do
  kept="${SIDES[$side]}"
  off="${SIDES[$((1 - side))]}"
  if [ "$(python3 -B tools/app_isolation.py rank "$off")" != 4 ]; then
    echo "--- $off is a shared service with no entitlement of its own: there is nothing to switch off"
  elif [ "$(python3 -B tools/app_isolation.py rank "$kept")" = 4 ]; then
    WEBVUE_PROBE_ANSWER="$kept" WEBVUE_PROBE_OFF="$off" WEBVUE_PROBE_CALM="$BRIDGE" \
      isolation_probe "$BRIDGE: $kept on, $off switched off"
  else
    # A shared service gates its routes on the keys the applications register, so with the application side
    # switched off it refuses too (feature_not_included): it must not fail, it need not answer.
    WEBVUE_PROBE_OFF="$off" WEBVUE_PROBE_CALM="$kept,$BRIDGE" \
      isolation_probe "$BRIDGE: shared service $kept kept, $off switched off"
  fi
done
echo "$BRIDGE: auto-install, tests, isolation and both switched-off sides passed"
