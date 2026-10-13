#!/usr/bin/env bash
# Control-plane CI tests on scratch PostgreSQL databases.
#
# Some live suites pin their own database name, so one shared database cannot run
# them all: the payment suites require nasq_control_scratch_payfinal, and the
# commercial restore suite connects to nasq_control_scratch_restorec. This script
# creates the three scratch databases, runs the suites serially in two groups, and
# drops the databases on exit. It refuses a non-loopback host.
#
# Environment: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (nasq_test), PGPASSWORD (required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
HOST="${PGHOST:-127.0.0.1}"
PORT="${PGPORT:-5432}"
USER_NAME="${PGUSER:-nasq_test}"
[ -n "${PGPASSWORD-}" ] || { echo "PGPASSWORD is required" >&2; exit 2; }
export PGPASSWORD

case "$HOST" in 127.0.0.1|localhost|::1) ;; *) echo "refusing non-loopback host: $HOST" >&2; exit 2 ;; esac

MAIN_DB=nasq_control_scratch_ci
PAYMENT_DB=nasq_control_scratch_payfinal
RESTORE_DB=nasq_control_scratch_restorec
DBS=("$MAIN_DB" "$PAYMENT_DB" "$RESTORE_DB")

drop_all() { for db in "${DBS[@]}"; do dropdb -h "$HOST" -p "$PORT" -U "$USER_NAME" --if-exists "$db" 2>/dev/null || true; done; }
trap drop_all EXIT
drop_all
for db in "${DBS[@]}"; do createdb -h "$HOST" -p "$PORT" -U "$USER_NAME" "$db"; done

url() { printf 'postgres://%s:%s@%s:%s/%s' "$USER_NAME" "$PGPASSWORD" "$HOST" "$PORT" "$1"; }

cd "$ROOT"
# The registry suite imports apps/web server code, which needs the generated Nuxt tsconfig.
[ -f apps/web/.nuxt/tsconfig.app.json ] || npm -w apps/web run postinstall
npm -w packages/commercial-contracts run test

# Suites that require the payfinal database by name.
PAYMENT_SUITES=(commercial-payment-events commercial-payment-simulator-settle commercial-renewals)

# Group 1: every other suite. The restore suite swaps the database name itself.
EXCLUDES=()
for s in "${PAYMENT_SUITES[@]}"; do EXCLUDES+=(--exclude "**/$s.test.ts"); done
CONTROL_TEST_DATABASE_URL="$(url "$MAIN_DB")" npm -w apps/control-plane test -- "${EXCLUDES[@]}"

# Group 2: the payment suites on their own database.
CONTROL_TEST_DATABASE_URL="$(url "$PAYMENT_DB")" npm -w apps/control-plane test -- "${PAYMENT_SUITES[@]}"

npm -w packages/commercial-contracts run build
npm -w apps/control-plane run build
