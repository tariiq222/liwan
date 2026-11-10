#!/usr/bin/env bash
# CI stage: static checks (lint, policies, Python and Node unit tests), in three independent parts.
#   deploy/ci/static.sh            run every part in order (the local full check)
#   deploy/ci/static.sh <part>     run one part: policies | tests | types
# The workflow runs the parts as the matrix of one `static` job, so the stage passes only when every part passes.
# CI_BASE_REF is the commit the change is compared with; the workflow supplies it.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE_REF="${CI_BASE_REF:-origin/main}"
PARTS=(policies tests types)

DEPENDENCIES_INSTALLED=false
install_dependencies() {
  # The setup action has already run `npm ci --ignore-scripts` on the runner; only a local caller needs it here,
  # and once for all the parts it runs.
  if [ "${GITHUB_ACTIONS:-}" != true ] && [ "$DEPENDENCIES_INSTALLED" = false ]; then
    npm ci --ignore-scripts
    DEPENDENCIES_INSTALLED=true
  fi
}

# Python lint, repository policies, the Python and Node unit tests of the deploy and release code.
policies() {
  ruff check odoo-addons
  # Release packages require their canonical name and installed jiti; run below.
  # Deployment suites parse Compose files. CI uses the interpreter prepared by the
  # setup action; local callers supply PyYAML in their own test environment.
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    python3 -m pip install --quiet pyyaml==6.0.3
  fi
  PYTHONPATH=deploy python3 -B -m unittest deploy/test_*.py
  # The staging definition lives in its own package, so `deploy/test_*.py` does not
  # match it; run it explicitly or its checks silently never execute in CI.
  PYTHONPATH=deploy python3 -B -m unittest discover -s deploy/staging -t . -p 'test_*.py'
  python3 -B -m unittest tools/shared_saas_lifecycle/test_*.py
  python3 -B tools/catalog_check.py
  python3 -B tools/migration_guard.py --base "$BASE_REF"
  python3 -B tools/git_policy.py --base "$BASE_REF"
  python3 -B tools/arch_policy.py --base "$BASE_REF"
  # The generated API files are checked in the nightly run only: task branches may not regenerate them
  # (tools/git_policy.py), so a pull request that adds a route would fail a check it cannot fix.
  if [ "${GITHUB_EVENT_NAME:-}" = schedule ]; then
    python3 -B tools/api_surface.py --check
  fi
  python3 -B tools/semgrep_gate.py --base "$BASE_REF"
  # The retired product name stays out of the tree. The local checkout path keeps its folder name.
  python3 -B tools/forbidden_terms.py --terms tools/retired_terms.txt --exceptions tools/retired_terms_exceptions.txt \
    --allow-string /code/webvue
  # Report form, not `--check`: an unpublished liwan-* digest is the owner's pending registry decision, so
  # only that is reported here; a tag-only, drifted, missing or stale pin still fails, and this line starts
  # failing on unpublished entries too the moment production-images.json claims a registry account.
  python3 -B deploy/image_pins.py
  install_dependencies
  # Dependency advisories gate only a change to the dependency set; new advisories against an
  # unchanged set are reported by the daily audit workflow instead of failing unrelated PRs.
  if ! git diff --quiet "$(git merge-base "$BASE_REF" HEAD)" HEAD -- package.json package-lock.json ':(glob)**/package.json'; then
    npm run check:audit
  fi
  python3 -B -m unittest discover -s deploy/releases -t . -p 'test_*.py'
  node --test deploy/shared/release-guard.test.mjs deploy/shared/release-assets.test.mjs deploy/shared/release-routes.test.mjs deploy/releases/test_dedicated_guard.mjs \
    deploy/shared/guard.test.mjs deploy/shared/boundary-regressions.test.mjs deploy/shared/guard-rate-limit.test.mjs \
    deploy/shared/securityHeaders.test.mjs \
    deploy/shared/image-routes.test.mjs deploy/shared/tiktok-relay.test.mjs tools/shared_isolation_acceptance/ssr-boundary.test.mjs
}

# `npm test`: the tools tests and every workspace's unit tests. Two web tests drive Chromium, so only this part installs it.
tests() {
  install_dependencies
  npm -w apps/web run postinstall
  npm -w apps/vendor-admin run postinstall
  npx playwright install chromium
  npm test
}

# The web app type check (vue-tsc --build) over the Nuxt types that `nuxt prepare` generates.
types() {
  install_dependencies
  npm -w apps/web run postinstall
  # vue-tsc --build over the whole web app exceeds the default Node heap on the 16 GB runner (exit 250).
  NODE_OPTIONS=--max-old-space-size=8192 npm -w apps/web run lint
}

part="${1:-all}"
case "$part" in
  all) for each in "${PARTS[@]}"; do "$each"; done ;;
  policies | tests | types) "$part" ;;
  *) echo "usage: static.sh [policies|tests|types]" >&2; exit 2 ;;
esac
