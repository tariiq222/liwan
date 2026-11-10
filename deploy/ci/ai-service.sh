#!/usr/bin/env bash
# CI stage: the AI service (apps/ai-service) advisory audit, lint and tests on a throwaway Postgres database.
# Packages install from the hashed lock (requirements-dev.txt), exactly the versions the image gets from requirements.txt.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_PYTHON:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"
AUDIT_PYTHON="$ODOO_PYTHON" deploy/ci/lib/ai-service-audit.sh
cd apps/ai-service
"$ODOO_PYTHON" -m venv .venv
.venv/bin/pip install --quiet --require-hashes -r requirements-build.txt -r requirements-dev.txt
.venv/bin/pip install --quiet --no-deps --no-build-isolation -e .
.venv/bin/ruff check src tests
# The Postgres state tests need a throwaway database, dropped on exit (the control-plane stage's conventions).
AI_DB="liwan_ai_ci_${GITHUB_RUN_ID}"
trap 'dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$AI_DB"' EXIT
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$AI_DB"
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$AI_DB"
AI_TEST_DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$AI_DB" .venv/bin/pytest -q
