#!/usr/bin/env bash
# One command = one customer environment.
#   deploy/provision.sh app.customer.sa customerdb
# Requires deploy/.env (copy .env.example) and deploy/branding.json (+ logo).
#   deploy/provision.sh --stage-only
#     Stages branding.json + its logo into data/seed and exits — no docker,
#     no DOMAIN/DB_NAME required. Used to exercise stage_branding() in isolation.
#   deploy/provision.sh --public-origin app.customer.sa customerdb
#     After a DOMAIN change of a provisioned environment: pins the database's public
#     origin (web.base.url) to https://<domain> again and exits.
set -euo pipefail
cd "$(dirname "$0")"

[ -f .env ] || { echo "deploy/.env missing (copy .env.example)"; exit 1; }
# The AI service refuses to run without its token, so when the ai profile is enabled we generate the missing
# AI_SERVICE_TOKEN and AI_DB_PASSWORD once. An existing value is never printed or rotated.
if grep -Eq '^COMPOSE_PROFILES=([^#]*,)?ai(,|$|[[:space:]])' .env; then
  sh ai/ensure_secrets.sh .env
  # `ai` has no internet route of its own: every outbound call goes through the ai-egress host allowlist.
  # An operator-set AI_EGRESS_HOSTS is kept as it is; when it is empty or absent it is derived once from the
  # provider (and AI_BASE_URL, when set) so a fresh deployment can reach its provider without another step.
  if ! grep -Eq '^AI_EGRESS_HOSTS=.' .env; then
    env_file_value() { awk -v key="$1" 'index($0, key "=") == 1 { print substr($0, length(key) + 2); exit }' .env; }
    provider="$(env_file_value AI_PROVIDER)"
    [ -n "$provider" ] || provider=ollama
    egress_hosts="$(sh ai/egress_hosts.sh "$provider" "$(env_file_value AI_BASE_URL)")" \
      || { echo "provision: could not derive AI_EGRESS_HOSTS from AI_PROVIDER/AI_BASE_URL in deploy/.env" >&2; exit 1; }
    # Same write rule as ai/ensure_secrets.sh: replace one assignment in place, append otherwise, never echo a value.
    # The temporary file holds every secret in .env, so it is created in a subshell whose umask is owner-only.
    ( umask 077
      AI_EGRESS_HOSTS="$egress_hosts" awk '
        index($0, "AI_EGRESS_HOSTS=") == 1 {
          if (!written) { print "AI_EGRESS_HOSTS=" ENVIRON["AI_EGRESS_HOSTS"]; written = 1 }
          next
        }
        { print }
        END { if (!written) print "AI_EGRESS_HOSTS=" ENVIRON["AI_EGRESS_HOSTS"] }
      ' .env > .env.tmp
      mv .env.tmp .env
    )
    chmod 600 .env
    echo "provision: AI_EGRESS_HOSTS=$egress_hosts (edit deploy/.env to allow another provider host)"
  fi
fi
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
  cp seed_legacy_policy.py data/seed/seed_legacy_policy.py

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

# Stock Odoo builds absolute links (payment return and webhook URLs, mail links) from
# web.base.url; the tenant's public origin is pinned to the domain and frozen.
set_public_origin() {
  docker compose run --rm -T -e DOMAIN -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" odoo \
    shell -d "$DB_NAME" --no-http < seed_public_origin.py
}

MODE=provision
if [ "${1:-}" = "--public-origin" ]; then
  MODE=public-origin
  shift
fi

# .env first, then the positional arguments: the domain and the database name are
# arguments to this script, so they must override whatever the environment carries.
set -a; source .env; set +a
DOMAIN="${1:?usage: provision.sh <domain> <db name>}"
DB_NAME="${2:?usage: provision.sh <domain> <db name>}"
[[ "$DB_NAME" =~ ^[a-zA-Z0-9_]+$ ]] || { echo "db name must be [a-zA-Z0-9_]+" >&2; exit 1; }
# With the ai profile the tenant database name also becomes the AI tenant id and the AI database name, which
# the service accepts only as ^[a-z][a-z0-9_]{0,62}$. Refuse it here, before any install work starts.
if grep -Eq '^COMPOSE_PROFILES=([^#]*,)?ai(,|$|[[:space:]])' .env; then
  [[ "$DB_NAME" =~ ^[a-z][a-z0-9_]{0,62}$ ]] \
    || { echo "db name '$DB_NAME' must match ^[a-z][a-z0-9_]{0,62}$ when the ai profile is enabled" >&2; exit 1; }
fi
# The public origin is https://<domain>: a lowercase DNS name, no port, no trailing dot.
[ "${#DOMAIN}" -le 253 ] && [[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$ ]] \
  || { echo "domain must be a lowercase DNS name" >&2; exit 1; }
export DOMAIN DB_NAME

if [ "$MODE" = public-origin ]; then
  [ -f data/odoo.conf ] || { echo "provision: data/odoo.conf missing; provision $DB_NAME first" >&2; exit 1; }
  export ODOO_COMMIT="$(cat "$PWD/odoo/ODOO_COMMIT")"
  export LIWAN_IMAGE_TAG="${LIWAN_IMAGE_TAG:?set LIWAN_IMAGE_TAG to the running image tag}"
  set_public_origin
  exit 0
fi

for var in DB_PASSWORD ODOO_ADMIN_PASSWORD VENDOR_PASSWORD; do
  eval "value=\${$var:-}"
  case "$value" in
    ''|change-me|changeme|validation-only|odoo|admin)
      echo "provision: $var is empty or a known placeholder; set a real secret in deploy/.env" >&2
      exit 1 ;;
  esac
  [ "${#value}" -ge 16 ] || { echo "provision: $var must be at least 16 characters" >&2; exit 1; }
done

# Explicit classification is required before starting any Docker service.
# Keep the validated snapshot separate from branding's replaceable staging directory.
CLASSIFICATION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/liwan-classification.XXXXXX")"
trap 'rm -rf -- "$CLASSIFICATION_DIR"' EXIT
python3 classification.py stage \
  --file "${LIWAN_COMMERCIAL_CONFIG:?set LIWAN_COMMERCIAL_CONFIG to an absolute operator mapping file}" \
  --output "$CLASSIFICATION_DIR/classification.json" --database "$DB_NAME" \
  --expected-valid-until none --fresh
export LIWAN_CLASSIFICATION_FILE="$CLASSIFICATION_DIR/classification.json"
# Directory traversal for the container's unprivileged UID; input contains no secrets.
chmod 0755 "$CLASSIFICATION_DIR"

export ODOO_COMMIT="$(cat "$PWD/odoo/ODOO_COMMIT")"
export LIWAN_IMAGE_TAG="${LIWAN_IMAGE_TAG:-$(git -C "$PWD/.." rev-parse --short HEAD)}"

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

# Every pillar must be listed explicitly: pillars depend on liwan_api, not the other way round.
docker compose -f docker-compose.yml -f docker-compose.classification.yml run --rm \
  -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" odoo \
  -d "$DB_NAME" -i liwan_core,liwan_platform,liwan_api,liwan_ai,liwan_ai_notify,liwan_directory,liwan_documents,liwan_notify,liwan_meetings,liwan_operations,liwan_pmo,liwan_meetings_pmo,liwan_operations_pmo,liwan_pmo_ai,liwan_hr,liwan_access_hr,liwan_documents_hr,liwan_hr_operations,liwan_integrations_sa,liwan_finance,liwan_hr_finance,liwan_pmo_finance,liwan_payments,liwan_chat,liwan_tasks,liwan_tasks_pmo,liwan_crm,liwan_appointments,liwan_appointments_payments,liwan_inbox,liwan_inbox_payments --stop-after-init
docker compose run --rm -T -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" -v "$PWD/data/seed:/seed:ro" odoo \
  shell -d "$DB_NAME" --no-http < data/seed/seed_legacy_policy.py
docker compose run --rm -T -e VENDOR_PASSWORD -v "$PWD/data/odoo.conf:/etc/odoo/odoo.conf:ro" -v "$PWD/data/seed:/seed:ro" odoo \
  shell -d "$DB_NAME" --no-http < data/seed/seed_branding.py
set_public_origin
# Close the tenant database to PUBLIC and give LiwanOS AI's role its own schema there, with no access to
# schema public (ai/tenant_schema.sql). A no-op when the liwan_ai role does not exist (deployments
# without AI); a real error still stops provisioning.
docker compose exec -T db psql -U odoo -d postgres -v ON_ERROR_STOP=1 -v tenant_db="$DB_NAME" \
  < ai/tenant_schema.sql
# The runtime validates AI state and never runs DDL: the operator bootstrap creates the tables in that
# schema, so it runs here for every tenant while the ai profile is enabled. The control state comes first (once per
# deployment, idempotent: it validates an existing state), so the service does not restart-loop on
# ai_control_state_uninitialized.
if grep -Eq '^COMPOSE_PROFILES=([^#]*,)?ai(,|$|[[:space:]])' .env; then
  docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-control
  docker compose run --rm -T ai python -m liwan_ai_service.store --initialize-tenant "$DB_NAME"
fi
docker compose up -d
echo "https://$DOMAIN is provisioning; vendor login: admin / (VENDOR_PASSWORD from .env)."
