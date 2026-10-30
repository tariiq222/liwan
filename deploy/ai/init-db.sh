#!/bin/sh
# LiwanOS AI keeps its run state in its own database, owned by its own role, never inside a tenant
# database and never as the Postgres superuser. Runs once, on a fresh db_data volume only.
# The password reaches SQL only through a psql variable, quoted with format('%L').
set -eu

if [ -z "${AI_DB_PASSWORD:-}" ]; then
  echo "liwan-ai: AI_DB_PASSWORD is empty, skipping the liwan_ai role and database"
  exit 0
fi

psql -v ON_ERROR_STOP=1 -v ai_password="$AI_DB_PASSWORD" --username "$POSTGRES_USER" --dbname postgres <<'SQL'
SELECT format('CREATE ROLE liwan_ai LOGIN PASSWORD %L', :'ai_password') \gexec
CREATE DATABASE liwan_ai OWNER liwan_ai;
REVOKE CONNECT ON DATABASE liwan_ai FROM PUBLIC;
-- liwan_ai may connect to its own database only: close every other database that exists now.
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', datname)
  FROM pg_database WHERE datname <> 'liwan_ai' \gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM liwan_ai', datname)
  FROM pg_database WHERE datname <> 'liwan_ai' \gexec
SQL
