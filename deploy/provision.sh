#!/usr/bin/env bash
# One command = one customer environment.
#   deploy/provision.sh app.customer.sa customerdb
# Requires deploy/.env (copy .env.example) and deploy/branding.json (+ logo).
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "deploy/.env missing (copy .env.example)"; exit 1; }
[ -f branding.json ] || { echo "deploy/branding.json missing (copy branding.example.json)"; exit 1; }

# .env first, then the positional arguments: the domain and the database name are
# arguments to this script, so they must override whatever the environment carries.
set -a; source .env; set +a
DOMAIN="${1:?usage: provision.sh <domain> <db name>}"
DB_NAME="${2:?usage: provision.sh <domain> <db name>}"
export DOMAIN DB_NAME

case "${VENDOR_PASSWORD:-}" in
  ''|change-me)
    echo "VENDOR_PASSWORD in deploy/.env must be a real password (it becomes the admin login)"
    exit 1
    ;;
esac

mkdir -p data
envsubst < odoo.conf > data/odoo.conf

# Only branding.json and the logo it names are mounted into the seed container —
# never the whole deploy/ directory, which holds .env.
rm -rf data/seed
mkdir -p data/seed
cp branding.json data/seed/branding.json
cp seed_branding.py data/seed/seed_branding.py
LOGO_PATH="$(sed -n 's/.*"logo_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' branding.json | head -n 1)"
if [ -n "$LOGO_PATH" ]; then
  [ -f "$LOGO_PATH" ] || { echo "branding.json names logo_path '$LOGO_PATH' but deploy/$LOGO_PATH is missing"; exit 1; }
  mkdir -p "data/seed/$(dirname "$LOGO_PATH")"
  cp "$LOGO_PATH" "data/seed/$LOGO_PATH"
fi

docker compose up -d db
# The install run below connects straight away; postgres is not accepting connections yet.
for _ in $(seq 1 60); do
  docker compose exec -T db pg_isready -U odoo >/dev/null 2>&1 && break
  sleep 1
done
docker compose exec -T db pg_isready -U odoo >/dev/null 2>&1 || { echo "db not ready after 60s"; exit 1; }

docker compose run --rm -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" odoo \
  odoo -c /etc/odoo/odoo.conf -d "$DB_NAME" -i nasq_core,nasq_api,web_theme_shadcn --stop-after-init
docker compose run --rm -e VENDOR_PASSWORD -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" -v "$PWD/data/seed:/seed:ro" odoo \
  sh -c "odoo shell -c /etc/odoo/odoo.conf -d $DB_NAME --no-http < /seed/seed_branding.py"
docker compose up -d
echo "https://$DOMAIN is provisioning; vendor login: admin / (VENDOR_PASSWORD from .env)."
