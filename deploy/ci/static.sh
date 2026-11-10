#!/usr/bin/env bash
# CI stage: static checks (lint, policies, Python and Node unit tests), in three independent parts.
#   deploy/ci/static.sh            run every part in order (the local full check)
#   deploy/ci/static.sh <part>     run one part: policies | tests | types
# The workflow runs the parts as the matrix of one `static` job, so the stage passes only when every part passes.
# CI_BASE_REF is the commit the change is compared with; the workflow supplies it.
# A part is made of units (see tools/ci_static_profile.py): policies = gates, deploy-suites; tests = repo, tools and one
# unit per workspace; types = types. CI_STATIC_UNITS, set only on pull requests, names the units of the one part to run;
# unset (a local run, a push to main, the nightly and manual runs) runs every unit of the part.
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

PYYAML_INSTALLED=false
install_pyyaml() {
  # Deployment suites and the image pin check parse Compose files. CI uses the interpreter prepared by the
  # setup action; local callers supply PyYAML in their own test environment.
  if [ "${GITHUB_ACTIONS:-}" = true ] && [ "$PYYAML_INSTALLED" = false ]; then
    python3 -m pip install --quiet pyyaml==6.0.3
    PYYAML_INSTALLED=true
  fi
}

# Python lint and the repository policies; each is cheap and reads the diff, so every pull request runs them.
unit_gates() {
  ruff check odoo-addons
  install_pyyaml
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
}

# The Python and Node unit tests of the deploy and release code.
unit_deploy_suites() {
  # Release packages require their canonical name and installed jiti; run below.
  install_pyyaml
  PYTHONPATH=deploy python3 -B -m unittest deploy/test_*.py
  # The staging definition lives in its own package, so `deploy/test_*.py` does not
  # match it; run it explicitly or its checks silently never execute in CI.
  PYTHONPATH=deploy python3 -B -m unittest discover -s deploy/staging -t . -p 'test_*.py'
  python3 -B -m unittest tools/shared_saas_lifecycle/test_*.py
  install_dependencies
  python3 -B -m unittest discover -s deploy/releases -t . -p 'test_*.py'
  # Every deploy/shared/*.test.mjs runs (a new one is picked up by the glob); the isolation acceptance files that need a
  # built Nuxt server (isolation-matrix, operational-ssr) are registered in tools/ci_not_run.json instead.
  node --test deploy/shared/*.test.mjs deploy/releases/test_dedicated_guard.mjs \
    tools/shared_isolation_acceptance/ssr-boundary.test.mjs tools/shared_isolation_acceptance/acceptance.test.mjs \
    tools/shared_isolation_acceptance/known-regressions.test.mjs tools/shared_isolation_acceptance/t17-image-negative.test.mjs
  PYTHONPATH=deploy/shared python3 -B -m unittest deploy/shared/test_odoo_config.py
  # The only control-plane runtime test that mocks every dependency; the others drive the macOS local runtime (see tools/ci_not_run.json).
  python3 -B -m unittest deploy/control-plane/test_resource_guard.py
  python3 -B -m unittest tools/continuous_updates_acceptance/test_*.py
  PYTHONPATH=tools/documents_acceptance python3 -B -m unittest tools/documents_acceptance/test_acceptance.py
}

policies() {
  if unit_selected gates; then unit_gates; fi
  if unit_selected deploy-suites; then unit_deploy_suites; fi
}

# `npm test`: the repository policy scripts, the tools tests and every workspace's unit tests. Two web tests drive
# Chromium, so only a run of the web tests installs it.
tests() {
  install_dependencies
  # The repository policy scripts read the Nuxt types of apps/web (tools/ui_catalog.mjs).
  npm -w apps/web run postinstall
  if unit_selected apps/vendor-admin; then npm -w apps/vendor-admin run postinstall; fi
  if unit_selected apps/web; then npx playwright install chromium; fi
  if unit_selected repo; then heavy npm run test:repo; fi
  if unit_selected tools; then heavy npm run test:tools; fi
  if [ -z "${CI_STATIC_UNITS:-}" ]; then
    heavy npm run test:workspaces
  else
    for unit in $CI_STATIC_UNITS; do
      case "$unit" in repo | tools) ;; *) heavy npm -w "$unit" run test ;; esac
    done
  fi
}

# The web app type check (vue-tsc --build) over the Nuxt types that `nuxt prepare` generates.
types() {
  install_dependencies
  npm -w apps/web run postinstall
  # vue-tsc --build over the whole web app exceeds the default Node heap on the 16 GB runner (exit 250).
  NODE_OPTIONS=--max-old-space-size=8192 npm -w apps/web run lint
}

# Heavy test commands queue in the machine-wide test slots when run locally; CI runners have their own machine.
heavy() {
  if [ "${GITHUB_ACTIONS:-}" = true ]; then "$@"; else python3 -B tools/test_slot.py -- "$@"; fi
}

# Whether the unit runs: always without CI_STATIC_UNITS, otherwise only when listed.
unit_selected() {
  [ -z "${CI_STATIC_UNITS:-}" ] && return 0
  case " $CI_STATIC_UNITS " in *" $1 "*) return 0 ;; esac
  return 1
}

# Refuse a unit the part does not own, so a typo in the selection cannot silently run nothing.
validate_units() {
  local part="$1" unit
  for unit in ${CI_STATIC_UNITS:-}; do
    case "$part:$unit" in
      policies:gates | policies:deploy-suites | tests:repo | tests:tools | types:types) ;;
      # A workspace unit is exactly a workspace that `npm test` runs.
      tests:*) grep '^ *"test:workspaces":' package.json | grep -Fq -- "npm -w $unit run test" || { echo "unknown static unit for $part: $unit" >&2; exit 2; } ;;
      *) echo "unknown static unit for $part: $unit" >&2; exit 2 ;;
    esac
  done
}

part="${1:-all}"
case "$part" in
  all)
    [ -z "${CI_STATIC_UNITS:-}" ] || { echo "CI_STATIC_UNITS selects units of one part: name the part" >&2; exit 2; }
    for each in "${PARTS[@]}"; do "$each"; done ;;
  policies | tests | types) validate_units "$part"; "$part" ;;
  *) echo "usage: static.sh [policies|tests|types]" >&2; exit 2 ;;
esac
