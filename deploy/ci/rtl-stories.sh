#!/usr/bin/env bash
# CI stage: every Storybook story must render in Arabic (RTL) at desktop and mobile width with no page
# error and no sideways page scroll (apps/web/e2e-rtl). Builds Storybook; needs no server.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm -w apps/web run postinstall
cd apps/web
npx playwright install chromium
npm run test:rtl
