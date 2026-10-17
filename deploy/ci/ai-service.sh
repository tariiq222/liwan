#!/usr/bin/env bash
# CI stage: the AI service (apps/ai-service) lint and tests on a throwaway Postgres database.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_PYTHON:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}" "${GITHUB_RUN_ID:?}"
cd apps/ai-service
"$ODOO_PYTHON" -m venv .venv
.venv/bin/pip install --quiet -e '.[dev]'
.venv/bin/ruff check src tests
# The Postgres state tests need a throwaway database, dropped on exit (the control-plane stage's conventions).
AI_DB="webvue_ai_ci_${GITHUB_RUN_ID}"
trap 'dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$AI_DB"' EXIT
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$AI_DB"
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$AI_DB"
AI_TEST_DATABASE_URL="postgresql://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$AI_DB" .venv/bin/pytest -q
