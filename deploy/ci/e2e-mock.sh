#!/usr/bin/env bash
# CI stage: the mock-backed Playwright specs against a production Nuxt build.
set -euo pipefail
cd "$(dirname "$0")/../.."
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
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  kill "$MOCK_PID" "$AI_MOCK_PID" 2>/dev/null || true; wait "$MOCK_PID" "$AI_MOCK_PID" 2>/dev/null || true
}
trap cleanup EXIT
# Built WITHOUT NUXT_AI_SERVICE_URL on purpose: /ai must follow the runtime value, not the build environment.
npx nuxt build
# The customer commercial pages (/subscription, /invite/accept) are switched on at runtime and read the mock's stub control plane.
NUXT_CUSTOMER_COMMERCIAL_ENABLED=true NUXT_PUBLIC_CUSTOMER_COMMERCIAL_ENABLED=true \
  NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL="http://127.0.0.1:$MOCK_PORT" NUXT_CUSTOMER_COMMERCIAL_SERVICE_KEY="mock-commercial-service-key-0123456789abcdef" \
  NUXT_CUSTOMER_COMMERCIAL_ISSUER=liwan-e2e-mock NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN="$E2E_BASE_URL" NUXT_CUSTOMER_COMMERCIAL_TENANT_ID=tenant-e2e \
  NUXT_AI_SERVICE_URL="http://127.0.0.1:$AI_MOCK_PORT" PORT="$WEB_PORT" node .output/server/index.mjs > nuxt.log 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$MOCK_PID" "$AI_MOCK_PID" "$SERVER_PID"
  if curl -fs "$E2E_BASE_URL/login" >/dev/null; then break; fi
  sleep 2
done
curl -fs "$E2E_BASE_URL/login" >/dev/null
mapfile -t SPECS < <(sed 's#^#e2e/#' e2e/ci-mock-specs.txt)
npx playwright test "${SPECS[@]}"
