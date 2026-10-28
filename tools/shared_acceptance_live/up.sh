#!/usr/bin/env bash
# Shared acceptance live harness — full lifecycle provisioning.
# NOT deployment authorization.
#
# Compose invocation: the working directory is `deploy/`, which is also the
# directory of the first -f file. Every relative bind-mount source therefore
# resolves against `deploy/`, so the committed `./shared/*` mounts in
# deploy/docker-compose.shared.yml resolve to real files and this tooling is
# addressed as `../tools/shared_acceptance_live/...`. Do NOT add
# --project-directory: pointing the project directory at the repo root breaks the
# committed `./shared/*` mounts (and bare relative mount sources then parse as
# named volumes).
set -eEuo pipefail
umask 022

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOL_DIR="$REPO_ROOT/tools/shared_acceptance_live"
DEVDIR="$REPO_ROOT/deploy"
STATE_FILE="$TOOL_DIR/.state"
PROJECT_NAME="webvue-accept-$(date +%s)"
TMPDIR_BASE="$(mktemp -d /tmp/webvue-accept-live.XXXXXX)"
# 0755 so the unprivileged in-container users (guard/web `node`, odoo uid 10001)
# can traverse to the registry and odoo.conf bind mounts.
chmod 0755 "$TMPDIR_BASE"

: "${WEBVUE_IMAGE_TAG:?set WEBVUE_IMAGE_TAG to the built image tag, e.g. 28b6c04}"

COMPOSE=(
  docker compose
  -f docker-compose.yml
  -f docker-compose.shared.yml
  -f ../tools/shared_acceptance_live/acceptance.override.yml
)
compose() { (cd "$DEVDIR" && "${COMPOSE[@]}" -p "$PROJECT_NAME" "$@"); }

# --- Preflight: refuse if ports are in use or stale state exists ---
if [ -f "$STATE_FILE" ]; then
  echo "ERROR: state file exists ($STATE_FILE). Run down.sh first or remove it." >&2
  exit 1
fi
for PORT in 443 80; do
  if lsof -iTCP:"$PORT" -sTCP:LISTEN -P >/dev/null 2>&1; then
    echo "ERROR: 127.0.0.1:${PORT} is already in use. Refusing to start." >&2
    rm -rf "$TMPDIR_BASE"
    exit 1
  fi
done

# Write the state file. Every value here is safe to persist (no secrets) and is
# exactly what a later `docker compose down` must interpolate, so down.sh can tear
# this project down even when up.sh failed and the operator's shell no longer holds
# these variables. Values are single-quoted because DOMAIN contains a space.
write_state() {
  local tag="${WEBVUE_IMAGE_TAG:-unknown}"
  cat > "$STATE_FILE" << STATE_EOF
PROJECT_NAME='$PROJECT_NAME'
TMPDIR_BASE='$TMPDIR_BASE'
PROJECT_DIR='$DEVDIR'
COMPOSE_FILES='docker-compose.yml,docker-compose.shared.yml,../tools/shared_acceptance_live/acceptance.override.yml'
WEBVUE_IMAGE_TAG='$tag'
ODOO_COMMIT='${ODOO_COMMIT:-}'
DOMAIN='${DOMAIN:-}'
DB_NAME='${DB_NAME:-}'
WEBVUE_TENANT_REGISTRY_DIR='${WEBVUE_TENANT_REGISTRY_DIR:-}'
WEBVUE_SHARED_ODOO_CONFIG='${WEBVUE_SHARED_ODOO_CONFIG:-}'
WEBVUE_COMMERCIAL_CONFIG_DIR='${WEBVUE_COMMERCIAL_CONFIG_DIR:-}'
WEBVUE_EDGE_BIND='${WEBVUE_EDGE_BIND:-127.0.0.1}'
WEBVUE_EDGE_HTTPS_PORT='${WEBVUE_EDGE_HTTPS_PORT:-443}'
WEBVUE_EDGE_HTTP_PORT='${WEBVUE_EDGE_HTTP_PORT:-80}'
STATE_EOF
  chmod 0600 "$STATE_FILE"
}

cleanup_fail() {
  echo "up.sh failed at line ${BASH_LINENO[0]:-?}; partial state: project=$PROJECT_NAME tmp=$TMPDIR_BASE" >&2
  echo "Run tools/shared_acceptance_live/down.sh to remove it." >&2
  # Leave temp dir for debugging; write full state so down.sh can clean up.
  write_state
}
trap cleanup_fail ERR

# --- Secrets (never echoed, never on command lines) ---
PROXY_TOKEN="$(openssl rand -hex 32)"
SESSION_KEY_1="$(openssl rand -hex 32)"
SESSION_KEY_2="$(openssl rand -hex 32)"
DB_PASSWORD="$(openssl rand -hex 16)"
ADMIN_PASSWD="$(openssl rand -hex 16)"
ADMIN_A_PASSWORD="$(openssl rand -hex 16)"
ADMIN_B_PASSWORD="$(openssl rand -hex 16)"

# Write passwords to 0600 files in temp dir (never on CLI)
printf '%s' "$ADMIN_A_PASSWORD" > "$TMPDIR_BASE/admin_a_password"
printf '%s' "$ADMIN_B_PASSWORD" > "$TMPDIR_BASE/admin_b_password"
chmod 0600 "$TMPDIR_BASE/admin_a_password" "$TMPDIR_BASE/admin_b_password"

export WEBVUE_SHARED_PROXY_TOKEN="$PROXY_TOKEN"
# Session keys: JSON map of kid → >=32-byte hex secret, matching guard.mjs sessionCodec
export WEBVUE_SESSION_KEYS="{\"k1\":\"${SESSION_KEY_1}\",\"k2\":\"${SESSION_KEY_2}\"}"
export WEBVUE_SESSION_ACTIVE_KID="k1"
export WEBVUE_IMAGE_TAG
export ODOO_COMMIT="${ODOO_COMMIT:-$(cat "$REPO_ROOT/deploy/odoo/ODOO_COMMIT" 2>/dev/null || echo unset)}"
export DOMAIN="a.accept.webvue.test b.accept.webvue.test"
# Disposable per-tenant scratch databases. The *_scratch suffix is required by
# deploy/classification.py's fixture guard (see the classification block below).
TENANT_A_DB="webvue_accept_a_scratch"
TENANT_B_DB="webvue_accept_b_scratch"
TENANT_DATABASES=("$TENANT_A_DB" "$TENANT_B_DB")
export DB_NAME="$TENANT_A_DB"
export DB_PASSWORD
export WEBVUE_EDGE_BIND="127.0.0.1"
export WEBVUE_EDGE_HTTPS_PORT="443"
export WEBVUE_EDGE_HTTP_PORT="80"
export WEBVUE_TENANT_REGISTRY_DIR="$TMPDIR_BASE/registry"
export WEBVUE_SHARED_ODOO_CONFIG="$TMPDIR_BASE/odoo.conf"
export WEBVUE_COMMERCIAL_CONFIG_DIR="$TMPDIR_BASE/commercial"

mkdir -p "$WEBVUE_TENANT_REGISTRY_DIR" "$WEBVUE_COMMERCIAL_CONFIG_DIR"
# Registry dir must be traversable/readable by the unprivileged guard/web users.
chmod 0755 "$WEBVUE_TENANT_REGISTRY_DIR" "$WEBVUE_COMMERCIAL_CONFIG_DIR"

# --- Commercial classification (required by webvue_platform at install) ---
# webvue_platform's tenant-profile post_init_hook calls
# commercial_config.load_classification(), which needs an absolute path to a
# local, database-bound file. This file is generated by the repository's own
# generator (the same call the CI pipeline uses) — never hand-written:
#
#   python3 deploy/classification.py fixture --database <db> --mode saas --output <path>
#
# `fixture` is a disposable-input generator: it refuses any database name that
# does not match webvue_*scratch* and refuses odoo19/production/postgres names. The
# acceptance databases are therefore named webvue_accept_{a,b}_scratch — disposable
# loopback-only scratch databases in a project that is removed at the end.
#
# Mode is `saas`: this run exercises the shared SaaS lane. There is no
# control-plane or billing connection at classification time — the classification
# is read once, inside webvue.tenant.profile.create(), and the resulting profile is
# persisted, so the steady-state server does not read this file at all. The
# running service therefore gets an empty WEBVUE_COMMERCIAL_CONFIG, matching the
# `unset WEBVUE_COMMERCIAL_CONFIG` precedent used before the service starts in CI.
for DBT in "${TENANT_DATABASES[@]}"; do
  python3 "$REPO_ROOT/deploy/classification.py" fixture \
    --database "$DBT" --mode saas --output "$WEBVUE_COMMERCIAL_CONFIG_DIR/$DBT.json"
done
echo "Commercial classification (saas) generated for: ${TENANT_DATABASES[*]}"

# --- Tenant registry ---
# Schema matches tenantRegistry.ts validateRegistry(): schemaVersion=1,
# snapshotRevision>=1, targets[] with host (lowercase ASCII, no port),
# tenantId, database=filestore, enabled, registryRevision.
# Filename: registry.json under WEBVUE_TENANT_REGISTRY_DIR, mounted as /etc/webvue/.
# Guard reads WEBVUE_TENANT_REGISTRY_PATH=/etc/webvue/registry.json.
cat > "$WEBVUE_TENANT_REGISTRY_DIR/registry.json" << REGISTRY_EOF
{"schemaVersion":1,"snapshotRevision":1,"targets":[{"host":"a.accept.webvue.test","tenantId":"accept-a","database":"${TENANT_A_DB}","filestore":"${TENANT_A_DB}","enabled":true,"registryRevision":1},{"host":"b.accept.webvue.test","tenantId":"accept-b","database":"${TENANT_B_DB}","filestore":"${TENANT_B_DB}","enabled":true,"registryRevision":1}]}
REGISTRY_EOF
chmod 0644 "$WEBVUE_TENANT_REGISTRY_DIR/registry.json"

# --- odoo.conf ---
# db_user/db_password must match the db service env in docker-compose.yml:
# POSTGRES_USER=odoo, POSTGRES_PASSWORD=${DB_PASSWORD}.
# validate_odoo_config.py requires: mode 0400|0440 owned by root or the runtime
# uid, dbfilter=^%h$, list_db=False, proxy_mode=False, workers=2,
# data_dir=/var/lib/odoo, no db_name, no placeholders.
cat > "$WEBVUE_SHARED_ODOO_CONFIG" << ODOO_EOF
[options]
db_host = db
db_user = odoo
db_password = ${DB_PASSWORD}
admin_passwd = ${ADMIN_PASSWD}
dbfilter = ^%h$
list_db = False
proxy_mode = False
data_dir = /var/lib/odoo
workers = 2
ODOO_EOF
chmod 0400 "$WEBVUE_SHARED_ODOO_CONFIG"

# Validate the generated config with the real validator before proceeding.
python3 "$REPO_ROOT/deploy/shared/validate_odoo_config.py" "$WEBVUE_SHARED_ODOO_CONFIG"
echo "odoo.conf validated."

# The runtime validator also checks the file is owned by the container's uid
# (10001 = odoo in the image) or root, and is mode 0400/0440.
ODOO_UID="$(docker run --rm --entrypoint id "webvue-odoo:$WEBVUE_IMAGE_TAG" -u odoo 2>/dev/null || echo unknown)"
if [ "$ODOO_UID" != "10001" ]; then
  echo "WARNING: expected odoo uid 10001, got '$ODOO_UID'." >&2
fi
if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" = "0" ]; then
  chown "$ODOO_UID" "$WEBVUE_SHARED_ODOO_CONFIG"
fi
docker run --rm --user "$ODOO_UID" -v "$WEBVUE_SHARED_ODOO_CONFIG:/etc/odoo/odoo.conf:ro" \
  -v "$REPO_ROOT/deploy/shared/validate_odoo_config.py:/validate.py:ro" \
  --entrypoint /opt/venv/bin/python "webvue-odoo:$WEBVUE_IMAGE_TAG" \
  /validate.py /etc/odoo/odoo.conf
echo "odoo.conf readable as container uid $ODOO_UID."

# === LIFECYCLE ===

# --- 1. Start only the db service ---
compose up -d db

# Persist state as soon as the project has any resource, so a later failure can
# always be torn down by down.sh. (Do not rely on the ERR trap alone: when a
# caller pipes this script, `set -o pipefail` is not inherited and the trap may
# not fire.)
write_state

# --- 2. Wait for the compose healthcheck (pg_isready) ---
for i in $(seq 1 60); do
  [ "$(compose ps --format '{{.Health}}' db 2>/dev/null | head -1)" = "healthy" ] && break
  if [ "$i" -eq 60 ]; then echo "postgres not healthy after 120s" >&2; exit 1; fi
  sleep 2
done
echo "PostgreSQL healthy."

# --- 3. Create tenant databases (no host psql) ---
compose exec -T db createdb -U odoo "$TENANT_A_DB"
compose exec -T db createdb -U odoo "$TENANT_B_DB"
echo "Databases created."

# --- 4. Install WebVue addons into each DB ---
# launch_odoo.py rejects CLI args, so override entrypoint to webvue-odoo directly.
# The validated odoo.conf is mounted read-only by the shared compose.
for DBT in "${TENANT_DATABASES[@]}"; do
  # NOTE: every `docker compose run` option (-e/-T/--entrypoint) must appear
  # BEFORE the service name; anything after it is passed to the container as
  # command arguments (which previously produced "odoo_secure.py: error: no such
  # option: -e").
  compose run --rm --no-deps -T \
    -e WEBVUE_COMMERCIAL_CONFIG="/etc/webvue-commercial/$DBT.json" \
    --entrypoint /usr/local/bin/webvue-odoo odoo \
    server -c /etc/odoo/odoo.conf \
    -d "$DBT" --db-filter="^${DBT}\$" \
    -i webvue_core,webvue_platform,webvue_api,webvue_directory,webvue_notify,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_access_hr,webvue_integrations_sa,webvue_finance,webvue_hr_finance,webvue_pmo_finance,webvue_payments,webvue_chat,webvue_tasks,webvue_tasks_pmo,webvue_operations,webvue_operations_pmo,webvue_ai,webvue_pmo_ai,webvue_documents,webvue_documents_hr,webvue_appointments,webvue_inbox \
    --stop-after-init --no-http
done
echo "Addons installed."

# --- 4b. Seed the initial tenant feature policy (canonical script) ---
# deploy/seed_legacy_policy.py is the repository's single canonical seeding
# script for the tenant policy: installing the addons alone leaves
# webvue.tenant.profile with policy_revision=0 and no features. Run it once per
# tenant DB, piped on stdin exactly as deploy/provision.sh does (the container
# cannot see the repo, but stdin is sufficient — no bind mount needed). The
# script commits inside odoo shell, so no extra commit handling is required.
seed_policy() {
  local DBT="$1"
  # All options precede the service name (see the note in the install step).
  compose run --rm --no-deps -T \
    -e WEBVUE_COMMERCIAL_CONFIG="/etc/webvue-commercial/$DBT.json" \
    --entrypoint /usr/local/bin/webvue-odoo odoo \
    shell -c /etc/odoo/odoo.conf -d "$DBT" --db-filter="^${DBT}\$" --no-http \
    < "$REPO_ROOT/deploy/seed_legacy_policy.py"
}
for DBT in "${TENANT_DATABASES[@]}"; do
  seed_policy "$DBT"
done
echo "Legacy policy seeded."

# --- 4c. Post-seed policy readback: fail up.sh if the policy was not written ---
# Read-only check inside odoo shell: policy_revision must be 1 and the pillar
# features must be enabled. A failed assert exits non-zero and the ERR trap /
# set -e aborts up.sh.
verify_policy() {
  local DBT="$1"
  # All options precede the service name (see the note in the install step).
  compose run --rm --no-deps -T \
    -e WEBVUE_COMMERCIAL_CONFIG="/etc/webvue-commercial/$DBT.json" \
    --entrypoint /usr/local/bin/webvue-odoo odoo \
    shell -c /etc/odoo/odoo.conf -d "$DBT" --db-filter="^${DBT}\$" --no-http << PYEOF
profile = env.ref('webvue_platform.tenant_profile')
assert profile.policy_revision == 1, 'policy_revision=%r, expected 1' % profile.policy_revision
features = profile.features or {}
assert features.get('pmo.enabled') is True, 'pmo.enabled missing: %r' % features
assert features.get('hr.enabled') is True, 'hr.enabled missing: %r' % features
print('initial policy verified: db=$DBT revision=%s features=%d' % (profile.policy_revision, len(features)))
PYEOF
}
for DBT in "${TENANT_DATABASES[@]}"; do
  verify_policy "$DBT"
done
echo "Initial tenant policy verified."

# --- 5. Seed admin + capability roles + HR employee per tenant via odoo shell ---
# The seed script is passed through an environment variable so no secret ever
# reaches a command line and no stdin/TTY allocation is required.
seed_tenant() {
  local DBT="$1" LOGIN="$2" PROJ="$3" EMP="$4" PW_FILE="$5"
  local PW
  PW="$(cat "$PW_FILE")"
  # Inherit secrets by name: docker's argv must never contain their values.
  export WEBVUE_ACCEPT_ADMIN_PASSWORD="$PW"
  export WEBVUE_ACCEPT_SEED="$(cat "$TOOL_DIR/seed_tenant.py")"
  # All options precede the service name (see the note in the install step).
  compose run --rm --no-deps -T \
    -e WEBVUE_COMMERCIAL_CONFIG="/etc/webvue-commercial/$DBT.json" \
    -e WEBVUE_ACCEPT_ADMIN_LOGIN="$LOGIN" \
    -e WEBVUE_ACCEPT_ADMIN_PASSWORD \
    -e WEBVUE_ACCEPT_PROJECT_NAME="$PROJ" \
    -e WEBVUE_ACCEPT_EMPLOYEE="$EMP" \
    -e WEBVUE_ACCEPT_SEED \
    --entrypoint /usr/local/bin/webvue-odoo odoo \
    shell -c /etc/odoo/odoo.conf -d "$DBT" --db-filter="^${DBT}\$" --no-http << 'PYEOF'
import os
exec(compile(os.environ['WEBVUE_ACCEPT_SEED'], '<acceptance-seed>', 'exec'))
PYEOF
}
seed_tenant "$TENANT_A_DB" "admin@a.accept.webvue.test" "ACCEPT-A-ONLY" "ACCEPT-A-EMP" "$TMPDIR_BASE/admin_a_password"
seed_tenant "$TENANT_B_DB" "admin@b.accept.webvue.test" "ACCEPT-B-ONLY" "ACCEPT-B-EMP" "$TMPDIR_BASE/admin_b_password"
echo "Tenants seeded."

# --- 6. Bring up the full stack ---
compose up -d

# Wait on the real compose healthchecks that this stack defines.
wait_healthy() {
  local SVC="$1" TRIES="$2"
  for i in $(seq 1 "$TRIES"); do
    local ST
    ST="$(compose ps --format '{{.Health}}' "$SVC" 2>/dev/null | head -1)"
    if [ "$ST" = "healthy" ]; then echo "$SVC healthy."; return 0; fi
    sleep 2
  done
  echo "$SVC not healthy after $((TRIES * 2))s (last status: ${ST:-none})" >&2
  compose ps >&2 || true
  return 1
}
wait_healthy db 30
wait_healthy odoo 90
wait_healthy web 60
wait_healthy guard 60
wait_healthy proxy 60

# --- 7. Export Caddy root CA + compute SPKI sha256 (before any TLS probe) ---
for i in $(seq 1 60); do
  if compose exec -T proxy test -f /data/caddy/pki/authorities/local/root.crt 2>/dev/null; then
    break
  fi
  if [ "$i" -eq 60 ]; then echo "caddy root CA not found" >&2; exit 1; fi
  sleep 2
done
compose exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > "$TMPDIR_BASE/root.crt"
SPKI="$(openssl x509 -in "$TMPDIR_BASE/root.crt" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256 -binary | base64)"
printf '%s\n' "$SPKI" > "$TMPDIR_BASE/root.spki"
echo "Root CA exported."

# --- 8. Routed readiness probe through the real edge for both tenant hosts ---
# A request with no valid tenant session is answered by guard/web with 302 -> /login
# (unauthenticated but correctly routed) or 403 (rejected). Either proves that
# Caddy, the pinned rate-limit module, TLS with the registry hostname, and guard
# host resolution are live. 000 means the connection or TLS failed.
for HOST in a.accept.webvue.test b.accept.webvue.test; do
  OK=0
  CODE=000
  for i in $(seq 1 30); do
    CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
      --cacert "$TMPDIR_BASE/root.crt" --resolve "$HOST:443:127.0.0.1" \
      "https://$HOST/" 2>/dev/null || echo 000)"
    case "$CODE" in
      000|5??) : ;;          # connection/TLS failure or upstream error: keep waiting
      *) OK=1; break ;;
    esac
    sleep 2
  done
  if [ "$OK" != "1" ]; then echo "edge not answering for $HOST (last=$CODE)" >&2; exit 1; fi
  echo "edge ready for $HOST (status $CODE)."
done

# --- 9. Write state file (no secrets) ---
write_state

trap - ERR
echo "=== Acceptance stack ready ==="
echo "Project: $PROJECT_NAME"
echo "Temp dir: $TMPDIR_BASE"
echo "State file: $STATE_FILE"
echo "Admin passwords: $TMPDIR_BASE/admin_a_password, $TMPDIR_BASE/admin_b_password"
