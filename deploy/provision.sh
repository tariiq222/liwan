#!/usr/bin/env bash
# One command = one customer environment.
#   deploy/provision.sh app.customer.sa customerdb
# Requires deploy/.env (copy .env.example) and deploy/branding.json (+ logo).
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:?domain}"; DB_NAME="${2:?db name}"
[ -f .env ] || { echo "deploy/.env missing (copy .env.example)"; exit 1; }
[ -f branding.json ] || { echo "deploy/branding.json missing (copy branding.example.json)"; exit 1; }
set -a; source .env; set +a
export DOMAIN DB_NAME

mkdir -p data
envsubst < odoo.conf > data/odoo.conf

docker compose up -d db
docker compose run --rm -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" odoo \
  odoo -c /etc/odoo/odoo.conf -d "$DB_NAME" -i nasq_core,nasq_api,web_theme_shadcn --stop-after-init
docker compose run --rm -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" -v "$PWD:/seed:ro" odoo \
  sh -c "odoo shell -c /etc/odoo/odoo.conf -d $DB_NAME --no-http < /seed/seed_branding.py"
docker compose up -d
echo "https://$DOMAIN is provisioning; vendor login: admin / $ODOO_ADMIN_PASSWORD (change it)."
