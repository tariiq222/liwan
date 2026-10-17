#!/usr/bin/env bash
# CI stage: control-plane tests and build.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}"
# Creates the scratch databases the live suites pin by name, runs them in
# three groups, builds, and drops the databases (see the script header).
deploy/control-plane/ci-test.sh
