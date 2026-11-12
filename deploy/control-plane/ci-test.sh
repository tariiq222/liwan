#!/usr/bin/env bash
# Control-plane CI tests on scratch PostgreSQL databases.
#
# Some live suites pin their own database name, so one shared database cannot run
# them all: the payment suites require liwan_control_scratch_payfinal, and the
# commercial restore suite connects to liwan_control_scratch_restorec, and the
# analytics suite requires liwan_control_scratch_analytics, and the AI provider suite
# requires liwan_control_scratch_aiprovider. This script creates five scratch
# databases (plus liwan_scratch_backup_ci for the release backup live test), runs the
# suites serially in four groups, and drops the databases on exit. It refuses a
# non-loopback host.
#
# No suite may skip here: each vitest group writes a JSON report and vitest_skip_gate.py
# fails the stage on any skipped, pending or todo test. The mail suites need Mailpit, and
# deploy/releases/test_backup_live.py needs a superuser PGUSER, psycopg2 and a trust-auth server
# (its fixture roles have no password): LIWAN_BACKUP_PGPORT names one, default PGPORT.
#
# Environment: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (liwan_test), PGPASSWORD (required),
# LIWAN_BACKUP_PGPORT (optional, default PGPORT), LIWAN_MAILPIT_SMTP_PORT and LIWAN_MAILPIT_API_PORT (required, a local Mailpit; start one with
# docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.27.10).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
HOST="${PGHOST:-127.0.0.1}"
PORT="${PGPORT:-5432}"
USER_NAME="${PGUSER:-liwan_test}"
[ -n "${PGPASSWORD-}" ] || { echo "PGPASSWORD is required" >&2; exit 2; }
export PGPASSWORD
: "${LIWAN_MAILPIT_SMTP_PORT:?Mailpit is required: docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit:v1.27.10, then set LIWAN_MAILPIT_SMTP_PORT=1025 LIWAN_MAILPIT_API_PORT=8025}"
: "${LIWAN_MAILPIT_API_PORT:?Mailpit is required: set LIWAN_MAILPIT_API_PORT (8025 for the docker command in the header)}"
export LIWAN_MAILPIT_SMTP_PORT LIWAN_MAILPIT_API_PORT

case "$HOST" in 127.0.0.1|localhost|::1) ;; *) echo "refusing non-loopback host: $HOST" >&2; exit 2 ;; esac

MAIN_DB=liwan_control_scratch_ci
PAYMENT_DB=liwan_control_scratch_payfinal
RESTORE_DB=liwan_control_scratch_restorec
ANALYTICS_DB=liwan_control_scratch_analytics
AI_PROVIDER_DB=liwan_control_scratch_aiprovider
BACKUP_DB=liwan_scratch_backup_ci
BACKUP_PORT="${LIWAN_BACKUP_PGPORT:-$PORT}"
DBS=("$MAIN_DB" "$PAYMENT_DB" "$RESTORE_DB" "$ANALYTICS_DB" "$AI_PROVIDER_DB")
REPORTS="$(mktemp -d)"

drop_all() {
  for db in "${DBS[@]}"; do dropdb -h "$HOST" -p "$PORT" -U "$USER_NAME" --if-exists "$db" 2>/dev/null || true; done
  dropdb -h "$HOST" -p "$BACKUP_PORT" -U "$USER_NAME" --if-exists "$BACKUP_DB" 2>/dev/null || true
}
trap 'drop_all; rm -rf "$REPORTS"' EXIT
drop_all
for db in "${DBS[@]}"; do createdb -h "$HOST" -p "$PORT" -U "$USER_NAME" "$db"; done
createdb -h "$HOST" -p "$BACKUP_PORT" -U "$USER_NAME" "$BACKUP_DB"

url() { printf 'postgres://%s:%s@%s:%s/%s' "$USER_NAME" "$PGPASSWORD" "$HOST" "$PORT" "$1"; }

cd "$ROOT"
# Mailpit comes up asynchronously as a service container: wait for its API (bounded), never skip the mail suites.
for _ in $(seq 30); do curl -fsS "http://127.0.0.1:$LIWAN_MAILPIT_API_PORT/api/v1/info" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$LIWAN_MAILPIT_API_PORT/api/v1/info" >/dev/null || { echo "Mailpit API not reachable on 127.0.0.1:$LIWAN_MAILPIT_API_PORT" >&2; exit 2; }

# vitest group <number> <test arguments...>: runs the control-plane suites and writes $REPORTS/group<number>.json.
vitest_group() {
  local number="$1"; shift
  npm -w apps/control-plane test -- --reporter=default --reporter=json --outputFile.json="$REPORTS/group$number.json" "$@"
}

# The registry suite imports apps/web server code, which needs the generated Nuxt tsconfig.
[ -f apps/web/.nuxt/tsconfig.app.json ] || npm -w apps/web run postinstall
npm -w packages/commercial-contracts run test

# Suites that require the payfinal database by name.
PAYMENT_SUITES=(commercial-payment-events commercial-payment-simulator-settle commercial-renewals)

# Group 1: every other suite. The restore suite swaps the database name itself.
EXCLUDES=(--exclude '**/commercial-analytics.test.ts' --exclude '**/ai-provider.test.ts')
for s in "${PAYMENT_SUITES[@]}"; do EXCLUDES+=(--exclude "**/$s.test.ts"); done
CONTROL_TEST_DATABASE_URL="$(url "$MAIN_DB")" vitest_group 1 "${EXCLUDES[@]}"

# Group 2: the payment suites on their own database.
CONTROL_TEST_DATABASE_URL="$(url "$PAYMENT_DB")" vitest_group 2 "${PAYMENT_SUITES[@]}"

# Group 3: analytics owns its database independently of the payment and main fixtures.
CONTROL_TEST_DATABASE_URL="$(url "$ANALYTICS_DB")" vitest_group 3 commercial-analytics

# Group 4: the AI provider suite pins its own database (it writes the provider file and its audit rows).
CONTROL_TEST_DATABASE_URL="$(url "$AI_PROVIDER_DB")" vitest_group 4 ai-provider.test

# No skipped, pending or todo test in any group.
python3 -B deploy/control-plane/vitest_skip_gate.py "$REPORTS"/group{1,2,3,4}.json

# The release backup live test on its own scratch database (loopback, superuser to create its fixture roles).
if [ "${GITHUB_ACTIONS:-}" = true ]; then
  python3 -m pip install --quiet psycopg2-binary==2.9.10
fi
# The test builds role connections from a DSN without credentials (trust auth), so PGUSER/PGPASSWORD carry the admin login.
LIWAN_BACKUP_TEST_DSN="postgresql://$HOST:$BACKUP_PORT/$BACKUP_DB" PGUSER="$USER_NAME" PYTHONPATH=. python3 -B deploy/control-plane/unittest_no_skip.py deploy.releases.test_backup_live

npm -w packages/commercial-contracts run build
npm -w apps/control-plane run build
