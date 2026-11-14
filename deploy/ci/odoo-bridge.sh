#!/usr/bin/env bash
# CI stage: one LiwanOS bridge with its two sides.
#   deploy/ci/odoo-bridge.sh <bridge>     a rank-5 module of tools/arch_layers.json (matrix: app_isolation.py matrix bridges)
# Installs only the bridge's two sides on a fresh scratch database: the bridge must auto-install and its tests
# pass, and nothing else may come along. A side with a rank in tools/arch_layers.json is a LiwanOS module; the
# other side of a bridge such as liwan_api_account is a stock Odoo module (stock account) that the bridge's
# auto_install names and that has no rank and no LiwanOS entitlement. The route probe then runs with every
# feature on, and once per LiwanOS side with the OTHER LiwanOS side's features switched off: an application
# side's routes keep answering (a shared-service side's routes only must not fail), the switched-off side's
# routes refuse with feature_not_included (nothing leaks), and the bridge's routes fail with no server error.
# There is nothing to switch off for a stock side, so it takes no probe of its own.
# Two LiwanOS shared services have no application to open routes gated on registered keys. For those bridges,
# require the services and their bridge to answer without a server error.
set -euo pipefail
cd "$(dirname "$0")/../.."
BRIDGE="${1:?usage: odoo-bridge.sh <bridge>}"
# shellcheck source=lib/odoo-isolation.sh
. deploy/ci/lib/odoo-isolation.sh
IFS=, read -r -a SIDES <<< "$(python3 -B tools/app_isolation.py install "$BRIDGE")"
test "${#SIDES[@]}" -eq 2 || { echo "$BRIDGE is not a rank-5 bridge with two sides" >&2; exit 1; }
LIWAN_SIDES=()
LIWAN_RANKS=()
STOCK_SIDES=()
for side in "${SIDES[@]}"; do
  # `rank` fails for a module that tools/arch_layers.json does not rank: the stock side of the bridge.
  if rank="$(python3 -B tools/app_isolation.py rank "$side" 2>/dev/null)"; then
    LIWAN_SIDES+=("$side")
    LIWAN_RANKS+=("$rank")
  else
    STOCK_SIDES+=("$side")
  fi
done
test "${#LIWAN_SIDES[@]}" -ge 1 || { echo "$BRIDGE has no LiwanOS side" >&2; exit 1; }
if [ "${#STOCK_SIDES[@]}" -gt 0 ]; then
  for stock in "${STOCK_SIDES[@]}"; do
    echo "--- $stock is a stock Odoo module: no rank and no LiwanOS entitlement, so there is nothing to switch off"
  done
fi
isolation_setup "$BRIDGE"
isolation_install_and_test "$(IFS=,; echo "${SIDES[*]}")" "/$BRIDGE"
isolation_check "$BRIDGE"
applications=()
services=()
for index in "${!LIWAN_SIDES[@]}"; do
  if [ "${LIWAN_RANKS[$index]}" = 4 ]; then
    applications+=("${LIWAN_SIDES[$index]}")
  else
    services+=("${LIWAN_SIDES[$index]}")
  fi
done
if [ "${#applications[@]}" -eq 0 ]; then
  LIWAN_PROBE_CALM="$(IFS=,; echo "${LIWAN_SIDES[*]}"),$BRIDGE" isolation_probe "$BRIDGE: no application side"
else
  LIWAN_PROBE_ANSWER="$(IFS=,; echo "${applications[*]}")" \
    LIWAN_PROBE_ALSO_ANSWER="$BRIDGE" \
    LIWAN_PROBE_CALM="$(IFS=,; echo "${services[*]}")" \
    isolation_probe "$BRIDGE with both sides on"
fi
for index in "${!LIWAN_SIDES[@]}"; do
  off="${LIWAN_SIDES[$index]}"
  other=""
  other_rank=""
  if [ "${#LIWAN_SIDES[@]}" -eq 2 ]; then
    other="${LIWAN_SIDES[$((1 - index))]}"
    other_rank="${LIWAN_RANKS[$((1 - index))]}"
  fi
  if [ "${LIWAN_RANKS[$index]}" != 4 ]; then
    echo "--- $off is not a rank-4 application and owns no entitlement of its own: there is nothing to switch off"
  elif [ -n "$other" ] && [ "$other_rank" = 4 ]; then
    LIWAN_PROBE_ANSWER="$other" LIWAN_PROBE_OFF="$off" LIWAN_PROBE_CALM="$BRIDGE" \
      isolation_probe "$BRIDGE: $other on, $off switched off"
  elif [ -n "$other" ]; then
    # A shared service gates its routes on the keys the applications register, so with the application side
    # switched off it refuses too (feature_not_included): it must not fail, it need not answer.
    LIWAN_PROBE_OFF="$off" LIWAN_PROBE_CALM="$other,$BRIDGE" \
      isolation_probe "$BRIDGE: shared service $other kept, $off switched off"
  else
    # The bridge's single LiwanOS side is its application; the stock side has no feature to switch off, so only
    # the application's refusal and the bridge's own routes (which may refuse) are checked.
    LIWAN_PROBE_OFF="$off" LIWAN_PROBE_CALM="$BRIDGE" \
      isolation_probe "$BRIDGE: $off switched off, its stock side kept"
  fi
done
echo "$BRIDGE: auto-install, tests, isolation and every switched-off LiwanOS side passed"
