#!/usr/bin/env bash
# CI stage: control-plane tests and build.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${LIWAN_MAILPIT_SMTP_PORT:?}" "${LIWAN_MAILPIT_API_PORT:?}"
# Creates the scratch databases the live suites pin by name, runs them in
# four groups against Mailpit, fails on any skipped test, runs the backup live test,
# builds, and drops the databases (see the script header).
deploy/control-plane/ci-test.sh
