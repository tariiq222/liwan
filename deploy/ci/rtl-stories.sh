#!/usr/bin/env bash
# CI stage: every Storybook story must render in Arabic (RTL) at desktop and mobile width with no page
# error and no sideways page scroll (apps/web/e2e-rtl). Builds Storybook; needs no server.
# The Storybook behaviour specs in apps/web/e2e (density, shell, templates, display templates, my-tasks geometry) run on the
# same build, once: unsharded, or in the last shard.
#   deploy/ci/rtl-stories.sh              run every story (the local full check)
#   deploy/ci/rtl-stories.sh --shard k/N  build Storybook, then run shard k of N of the story tests
set -euo pipefail
cd "$(dirname "$0")/../.."
SHARD=""
case "${1:-}" in
  "") ;;
  --shard) SHARD="${2:?usage: rtl-stories.sh --shard k/N}" ;;
  *) echo "usage: rtl-stories.sh [--shard k/N]" >&2; exit 2 ;;
esac
if [ -n "$SHARD" ] && ! { [[ "$SHARD" =~ ^([1-9][0-9]*)/([1-9][0-9]*)$ ]] && [ "${BASH_REMATCH[1]}" -le "${BASH_REMATCH[2]}" ]; }; then
  echo "rtl-stories.sh: --shard needs k/N with 1 <= k <= N, got '${SHARD}'" >&2
  exit 2
fi
npm -w apps/web run postinstall
cd apps/web
npx playwright install chromium
npm run test:rtl ${SHARD:+-- --shard="$SHARD"}
if [ -n "$SHARD" ] && [ "${SHARD%/*}" != "${SHARD#*/}" ]; then exit 0; fi
LIWAN_REQUIRE_STORYBOOK=1 npx playwright test \
  e2e/storybook-density.spec.ts e2e/storybook-display-templates.spec.ts e2e/storybook-shell.spec.ts \
  e2e/storybook-templates.spec.ts e2e/my-tasks-visual.spec.ts
