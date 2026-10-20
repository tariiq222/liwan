#!/usr/bin/env bash
# CI stage: one WebVue application ALONE with the foundation and its declared engines, or the foundation alone.
#   deploy/ci/odoo-app-standalone.sh <module>   an entry of `tools/app_isolation.py matrix apps`: the foundation top
#                                               (webvue_api) or a rank-4 application of tools/arch_layers.json
# Installs only <module> on a fresh scratch database and runs its own tests (the foundation run: every foundation
# module's tests), fails when any application or bridge came along, then calls the parameterless GET routes with
# the features on (route probe). The foundation run also manages an account's whole lifecycle with no HR.
set -euo pipefail
cd "$(dirname "$0")/../.."
APP="${1:?usage: odoo-app-standalone.sh <module>}"
# shellcheck source=lib/odoo-isolation.sh
. deploy/ci/lib/odoo-isolation.sh
MODULES="$(python3 -B tools/app_isolation.py install "$APP")"
test "$MODULES" = "$APP" || { echo "$APP is neither the foundation top nor a rank-4 application" >&2; exit 1; }
TAGS="$(python3 -B tools/app_isolation.py tags "$APP")"
isolation_setup "$APP"
isolation_install_and_test "$APP" "$TAGS"
isolation_check "$APP"
if [ "$APP" = "$(python3 -B tools/app_isolation.py foundation)" ]; then
  WEBVUE_PROBE_ANSWER="$APP" WEBVUE_PROBE_ACCOUNTS=1 isolation_probe "foundation alone: routes and account lifecycle"
else
  WEBVUE_PROBE_ANSWER="$APP" isolation_probe "$APP alone, features on"
fi
echo "$APP: standalone install, tests, isolation and routes passed"
