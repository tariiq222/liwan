#!/bin/sh
# LiwanOS runtime database role. The image bootstraps the admin role (POSTGRES_USER=postgres, tooling only);
# Odoo, its release run and pgbouncer connect as role `odoo`, which holds no superuser, database, role,
# replication or row-security-bypass power. Runs once, on a fresh db_data volume only, before 20-liwan-ai.sh.
# It may connect to the `postgres` database (Odoo's cron and health probe do); the grant is made to the role
# itself, so the PUBLIC revoke in 20-liwan-ai.sh leaves it in place. Each tenant database gets its own grants
# from deploy/release/tenant_postgres.py.
# The password reaches SQL only through psql's \getenv, quoted with format('%L'); it is never put on a command line.
set -eu

if [ -z "${ODOO_DB_PASSWORD:-}" ]; then
  echo "liwan-runtime-role: ODOO_DB_PASSWORD is empty, refusing to initialise the database" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv odoo_password ODOO_DB_PASSWORD
SELECT format('CREATE ROLE odoo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
              :'odoo_password') \gexec
GRANT CONNECT ON DATABASE postgres TO odoo;
SQL
