# Usage: source tools/saas_commercial_acceptance/scratch-env.sh   (never prints the password)
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
export NASQ_COMMERCIAL_PG_PORT="${NASQ_COMMERCIAL_PG_PORT:-55491}"
export NASQ_COMMERCIAL_PG_PASSWORD="$(cat "$_d/.secrets/pg_password")"
export NASQ_COMMERCIAL_COMPOSE_FILE="$_d/compose.scratch.yml"
# control DB name must match ^nasq_control_scratch_[a-z0-9]+$ (live-tenant-databases.ts)
export CONTROL_TEST_DATABASE_URL="postgres://nasq_test:${NASQ_COMMERCIAL_PG_PASSWORD}@127.0.0.1:${NASQ_COMMERCIAL_PG_PORT}/nasq_control_scratch_commercial"
