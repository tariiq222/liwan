#!/usr/bin/env bash
# CI stage: the vendor admin app (apps/vendor-admin, port 3100): type check, unit tests, a production build and the
# Playwright specs against that build and the mock control service (apps/vendor-admin/e2e; ports 3113 and 4711).
# It is a separate Nuxt application with its own layers (packages/ui, packages/commercial-ui),
# so the web stages do not cover it.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm ci --ignore-scripts
cd apps/vendor-admin
npx nuxt prepare
npm run lint
npm run test
npm run build
# The job's setup skips npm ci, and with it the setup action's browser install, so the system libraries come here.
npx playwright install --with-deps chromium
npx playwright test --project=prod
