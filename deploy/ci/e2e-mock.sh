#!/usr/bin/env bash
# CI stage: the mock-backed Playwright specs against a production Nuxt build.
#   deploy/ci/e2e-mock.sh              run every spec (the local full check)
#   deploy/ci/e2e-mock.sh --shard k/N  run shard k of N of the main spec list; the long-list specs run in shard N only
# The first shard (or the unsharded run, at its end) also runs the tenant-isolation checks on the built server
# (deploy/ci/lib/tenancy-isolation.sh): they need a second, shared-mode build, so they stay out of the long-list shard.
set -euo pipefail
cd "$(dirname "$0")/../.."
SHARD=""
case "${1:-}" in
  "") ;;
  --shard) SHARD="${2:?usage: e2e-mock.sh --shard k/N}" ;;
  *) echo "usage: e2e-mock.sh [--shard k/N]" >&2; exit 2 ;;
esac
if [ -n "$SHARD" ] && ! { [[ "$SHARD" =~ ^([1-9][0-9]*)/([1-9][0-9]*)$ ]] && [ "${BASH_REMATCH[1]}" -le "${BASH_REMATCH[2]}" ]; }; then
  echo "e2e-mock.sh: --shard needs k/N with 1 <= k <= N, got '${SHARD}'" >&2
  exit 2
fi
: "${MOCK_PORT:?}" "${AI_MOCK_PORT:?}" "${WEB_PORT:?}"
npm -w apps/web run postinstall
cd apps/web
npx playwright install chromium
test -s e2e/ci-mock-specs.txt
export PROJECTS_UI_PREVIEW=1 MODULE_UI_PREVIEW=1
export NUXT_ODOO_URL="http://127.0.0.1:$MOCK_PORT" NUXT_ODOO_DB=liwan_ui_mock_only
export NUXT_PUBLIC_WS_URL="ws://127.0.0.1:$MOCK_PORT/websocket"
export E2E_BASE_URL="http://localhost:$WEB_PORT" E2E_PROJECT_POPUPS=1
node e2e/internal-ui-audit-mock.mjs > mock.log 2>&1 &
MOCK_PID=$!
node e2e/ai-service-mock.mjs > ai-mock.log 2>&1 &
AI_MOCK_PID=$!
cleanup() {
  for pid in "${LONG_SERVER_PID:-}" "${SERVER_PID:-}"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  done
  kill "$MOCK_PID" "$AI_MOCK_PID" "${LONG_MOCK_PID:-}" 2>/dev/null || true; wait "$MOCK_PID" "$AI_MOCK_PID" ${LONG_MOCK_PID:-} 2>/dev/null || true
}
trap cleanup EXIT
# Built WITHOUT NUXT_AI_SERVICE_URL on purpose: /ai must follow the runtime value, not the build environment.
# A production build shows /ai only with a service token as well, so the run passes a fresh random one.
AI_MOCK_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
npx nuxt build
# The customer commercial pages (/subscription, /invite/accept) are switched on at runtime and read the mock's stub control plane.
NUXT_CUSTOMER_COMMERCIAL_ENABLED=true NUXT_PUBLIC_CUSTOMER_COMMERCIAL_ENABLED=true \
  NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL="http://127.0.0.1:$MOCK_PORT" NUXT_CUSTOMER_COMMERCIAL_SERVICE_KEY="mock-commercial-service-key-0123456789abcdef" \
  NUXT_CUSTOMER_COMMERCIAL_ISSUER=liwan-e2e-mock NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN="$E2E_BASE_URL" NUXT_CUSTOMER_COMMERCIAL_TENANT_ID=tenant-e2e \
  NUXT_AI_SERVICE_URL="http://127.0.0.1:$AI_MOCK_PORT" NUXT_AI_SERVICE_TOKEN="$AI_MOCK_TOKEN" \
  PORT="$WEB_PORT" node .output/server/index.mjs > nuxt.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$MOCK_PID" "$AI_MOCK_PID" "$SERVER_PID"
  if curl -fs "$E2E_BASE_URL/login" >/dev/null; then break; fi
  sleep 2
done
curl -fs "$E2E_BASE_URL/login" >/dev/null
mapfile -t SPECS < <(sed 's#^#e2e/#' e2e/ci-mock-specs.txt)
npx playwright test ${SHARD:+--shard="$SHARD"} "${SPECS[@]}"
FIRST_SHARD=true
if [ -n "$SHARD" ] && [ "${SHARD%/*}" != 1 ]; then FIRST_SHARD=false; fi
tenancy_isolation() {
  cleanup
  ../../deploy/ci/lib/tenancy-isolation.sh
}
# The long-list specs below run once, in the last shard.
if [ -n "$SHARD" ] && [ "${SHARD%/*}" != "${SHARD#*/}" ]; then
  if [ "$FIRST_SHARD" = true ]; then tenancy_isolation; fi
  exit 0
fi

# The scroll and navigation specs need lists taller than a viewport: a second mock pads the task fixture to 60 rows and a
# second server from the same build serves it. The default fixture keeps its four tasks for every other spec.
LONG_MOCK_PORT=$((MOCK_PORT + 10))
LONG_WEB_PORT=$((WEB_PORT + 10))
MOCK_PORT="$LONG_MOCK_PORT" MOCK_TASK_COUNT=60 node e2e/internal-ui-audit-mock.mjs > mock-long.log 2>&1 &
LONG_MOCK_PID=$!
NUXT_ODOO_URL="http://127.0.0.1:$LONG_MOCK_PORT" NUXT_PUBLIC_WS_URL="ws://127.0.0.1:$LONG_MOCK_PORT/websocket" \
  PORT="$LONG_WEB_PORT" node .output/server/index.mjs > nuxt-long.log 2>&1 &
LONG_SERVER_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$LONG_MOCK_PID" "$LONG_SERVER_PID"
  if curl -fs "http://localhost:$LONG_WEB_PORT/login" >/dev/null; then break; fi
  sleep 2
done
curl -fs "http://localhost:$LONG_WEB_PORT/login" >/dev/null
test -s e2e/ci-mock-long-list-specs.txt
mapfile -t LONG_SPECS < <(sed 's#^#e2e/#' e2e/ci-mock-long-list-specs.txt)
E2E_BASE_URL="http://localhost:$LONG_WEB_PORT" npx playwright test "${LONG_SPECS[@]}"
if [ "$FIRST_SHARD" = true ]; then tenancy_isolation; fi
