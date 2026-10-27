#!/usr/bin/env bash
# CI stage: static checks (lint, policies, Python and Node unit tests).
# CI_BASE_REF is the commit the change is compared with; the workflow supplies it.
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE_REF="${CI_BASE_REF:-origin/main}"
ruff check odoo-addons
# Release packages require their canonical name and installed jiti; run below.
PYTHONPATH=deploy python3 -B -m unittest deploy/test_*.py
python3 -B -m unittest tools/shared_saas_lifecycle/test_*.py
python3 -B tools/catalog_check.py
python3 -B tools/migration_guard.py --base "$BASE_REF"
python3 -B tools/git_policy.py --base "$BASE_REF"
python3 -B tools/arch_policy.py --base "$BASE_REF"
python3 -B tools/semgrep_gate.py --base "$BASE_REF"
npm ci --ignore-scripts
# Dependency advisories gate only a change to the dependency set; new advisories against an
# unchanged set are reported by the daily audit workflow instead of failing unrelated PRs.
if ! git diff --quiet "$(git merge-base "$BASE_REF" HEAD)" HEAD -- package.json package-lock.json ':(glob)**/package.json'; then
  npm run check:audit
fi
python3 -B -m unittest discover -s deploy/releases -t . -p 'test_*.py'
node --test deploy/shared/release-guard.test.mjs deploy/shared/release-assets.test.mjs deploy/shared/release-routes.test.mjs deploy/releases/test_dedicated_guard.mjs
npm -w apps/web run postinstall
npm -w apps/vendor-admin run postinstall
npx playwright install chromium
npm test
npm -w apps/web run lint
