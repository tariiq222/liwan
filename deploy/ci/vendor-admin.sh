#!/usr/bin/env bash
# CI stage: the vendor admin app (apps/vendor-admin, port 3100): type check, unit tests and a production build.
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
