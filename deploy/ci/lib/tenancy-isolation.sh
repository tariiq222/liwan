#!/usr/bin/env bash
# Tenant isolation on the built Nuxt server (AUDIT-014), run by deploy/ci/e2e-mock.sh after its dedicated build:
# - isolation-matrix: ten tenants through the real guard and the shared-mode build, 90 directional pairs per surface;
# - operational-ssr: authenticated SSR payloads, browser hydration and entitlement revocation across two tenants;
# - build-mode: each build refuses a mismatched, invalid or mutated LIWAN_TENANCY_MODE.
# The upstream is synthetic in all three; real-Odoo isolation is out of scope here.
# The dedicated build in apps/web/.output is moved aside while the shared one is built, and put back on exit.
set -euo pipefail
cd "$(dirname "$0")/../../.."
test -f apps/web/.output/server/index.mjs
WORK="$(mktemp -d)"
restore() {
  rm -rf apps/web/.output
  mv "$WORK/dedicated" apps/web/.output
  rm -rf "$WORK"
}
mv apps/web/.output "$WORK/dedicated"
trap restore EXIT
LIWAN_TENANCY_MODE=shared npm -w apps/web exec -- nuxt build
LIWAN_ACCEPTANCE_ARTIFACT="$PWD/apps/web/.output" LIWAN_ACCEPTANCE_DEDICATED_ARTIFACT="$WORK/dedicated" \
  node --test tools/shared_isolation_acceptance/isolation-matrix.test.mjs tools/shared_isolation_acceptance/operational-ssr.test.mjs \
  tools/shared_isolation_acceptance/build-mode.test.mjs
