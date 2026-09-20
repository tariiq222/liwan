#!/usr/bin/env bash
# One command = one customer environment.
#   deploy/provision.sh app.customer.sa customerdb
# Requires deploy/.env (copy .env.example) and deploy/branding.json (+ logo).
#   deploy/provision.sh --stage-only
#     Stages branding.json + its logo into data/seed and exits — no docker,
#     no DOMAIN/DB_NAME required. Used to exercise stage_branding() in isolation.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "deploy/.env missing (copy .env.example)"; exit 1; }
[ -f branding.json ] || { echo "deploy/branding.json missing (copy branding.example.json)"; exit 1; }

# Copies branding.json + the logo it names into data/seed/, resolving a
# relative logo_path against deploy/ (an absolute logo_path is used as-is)
# and rewriting the staged branding.json so seed_branding.py only ever sees
# a bare filename under /seed. Only branding.json and the logo are mounted
# into the seed container — never the whole deploy/ directory, which holds
# .env.
stage_branding() {
  rm -rf data/seed
  mkdir -p data/seed
  cp branding.json data/seed/branding.json
  cp seed_branding.py data/seed/seed_branding.py

  local logo_path resolved_path staged_name
  logo_path="$(sed -n 's/.*"logo_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' branding.json | head -n 1)"
  [ -n "$logo_path" ] || return 0

  case "$logo_path" in
    /*) resolved_path="$logo_path" ;;
    *) resolved_path="$PWD/$logo_path" ;;
  esac
  [ -f "$resolved_path" ] || { echo "branding.json: logo_path '$logo_path' not found" >&2; exit 1; }

  staged_name="logo.${resolved_path##*.}"
  cp "$resolved_path" "data/seed/$staged_name"
  python3 - "data/seed/branding.json" "$staged_name" <<'PY'
import json
import sys

path, name = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
data["logo_path"] = name
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
PY
}

if [ "${1:-}" = "--stage-only" ]; then
  stage_branding
  exit 0
fi

# .env first, then the positional arguments: the domain and the database name are
# arguments to this script, so they must override whatever the environment carries.
set -a; source .env; set +a
DOMAIN="${1:?usage: provision.sh <domain> <db name>}"
DB_NAME="${2:?usage: provision.sh <domain> <db name>}"
[[ "$DB_NAME" =~ ^[a-zA-Z0-9_]+$ ]] || { echo "db name must be [a-zA-Z0-9_]+" >&2; exit 1; }
export DOMAIN DB_NAME

for var in DB_PASSWORD ODOO_ADMIN_PASSWORD VENDOR_PASSWORD; do
  eval "value=\${$var:-}"
  case "$value" in
    ''|change-me|changeme|validation-only|odoo|admin)
      echo "provision: $var is empty or a known placeholder; set a real secret in deploy/.env" >&2
      exit 1 ;;
  esac
  [ "${#value}" -ge 16 ] || { echo "provision: $var must be at least 16 characters" >&2; exit 1; }
done

export ODOO_COMMIT="$(cat "$PWD/odoo/ODOO_COMMIT")"
export NASQ_IMAGE_TAG="${NASQ_IMAGE_TAG:-$(git -C "$PWD/.." rev-parse --short HEAD)}"

mkdir -p data
envsubst < odoo.conf > data/odoo.conf

stage_branding

docker compose up -d db
# The install run below connects straight away; postgres is not accepting connections yet.
for _ in $(seq 1 60); do
  docker compose exec -T db pg_isready -U odoo >/dev/null 2>&1 && break
  sleep 1
done
docker compose exec -T db pg_isready -U odoo >/dev/null 2>&1 || { echo "db not ready after 60s"; exit 1; }

# Every pillar must be listed explicitly: pillars depend on nasq_api, not the other way round.
docker compose run --rm -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" odoo \
  -d "$DB_NAME" -i nasq_core,nasq_platform,nasq_api,nasq_pmo,nasq_hr,nasq_chat,web_theme_shadcn --stop-after-init
docker compose run --rm -T -e VENDOR_PASSWORD -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" -v "$PWD/data/seed:/seed:ro" odoo \
  shell -d "$DB_NAME" --no-http < data/seed/seed_branding.py
docker compose up -d
echo "https://$DOMAIN is provisioning; vendor login: admin / (VENDOR_PASSWORD from .env)."
