#!/usr/bin/env bash
# Shared acceptance live harness — full lifecycle provisioning.
# NOT deployment authorization.
#
# The harness runs the one stack (deploy/stack/compose.yml). stack_render.py renders it from
# deploy/environments/local.env.example plus the harness values written below (ports, subnets, image tag, domain,
# secrets); nothing is layered over the compose file and no source file is mounted into a container: Odoo runs the
# launcher and validator its image was built with. Compose runs with the project directory `deploy/`, so the stack's
# own relative paths resolve.
set -eEuo pipefail
umask 022

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOL_DIR="$REPO_ROOT/tools/shared_acceptance_live"
STATE_FILE="$TOOL_DIR/.state"
PROJECT_NAME="liwan-accept-$(date +%s)"
TMPDIR_BASE="$(mktemp -d /tmp/liwan-accept-live.XXXXXX)"
# 0755 so the unprivileged in-container users (guard/web `node`, odoo uid 10001) can traverse to the bind mounts.
chmod 0755 "$TMPDIR_BASE"
RUN_DIR="$TMPDIR_BASE/stack"
mkdir -p "$RUN_DIR"
chmod 0700 "$RUN_DIR"

: "${LIWAN_IMAGE_TAG:?set LIWAN_IMAGE_TAG to the built image tag, e.g. 28b6c04}"

# The harness's own domain: `.localhost` names are never public, so Caddy issues their certificates from its internal CA
# without any Caddyfile of the harness (the stack Caddyfile is used as it is).
DOMAIN_SUFFIX="accept.liwan.localhost"
HOST_A="a.$DOMAIN_SUFFIX"
HOST_B="b.$DOMAIN_SUFFIX"

compose_argv() {
  COMPOSE=()
  while IFS= read -r -d '' part; do COMPOSE+=("$part"); done \
    < <(python3 -B "$TOOL_DIR/stack_render.py" command "$RUN_DIR" "$PROJECT_NAME")
}
compose() { compose_argv; "${COMPOSE[@]}" "$@"; }

# --- Preflight: refuse if ports are in use or stale state exists ---
if [ -f "$STATE_FILE" ]; then
  echo "ERROR: state file exists ($STATE_FILE). Run down.sh first or remove it." >&2
  rm -rf "$TMPDIR_BASE"
  exit 1
fi
for PORT in 443 80; do
  if lsof -iTCP:"$PORT" -sTCP:LISTEN -P >/dev/null 2>&1; then
    echo "ERROR: 127.0.0.1:${PORT} is already in use. Refusing to start." >&2
    rm -rf "$TMPDIR_BASE"
    exit 1
  fi
done

# Write the state file. Every value here is safe to persist (no secrets); the run directory holds the rest and is
# removed by down.sh with the temp dir. Values are single-quoted for the shell.
write_state() {
  cat > "$STATE_FILE" << STATE_EOF
PROJECT_NAME='$PROJECT_NAME'
TMPDIR_BASE='$TMPDIR_BASE'
RUN_DIR='$RUN_DIR'
LIWAN_IMAGE_TAG='$LIWAN_IMAGE_TAG'
STATE_EOF
  chmod 0600 "$STATE_FILE"
}

cleanup_fail() {
  echo "up.sh failed at line ${BASH_LINENO[0]:-?}; partial state: project=$PROJECT_NAME tmp=$TMPDIR_BASE" >&2
  echo "Run tools/shared_acceptance_live/down.sh to remove it." >&2
  # Leave temp dir for debugging; write the state so down.sh can clean up.
  write_state
}
trap cleanup_fail ERR

# --- Secrets (never echoed, never on command lines) ---
PROXY_TOKEN="$(openssl rand -hex 32)"
SESSION_KEY_1="$(openssl rand -hex 32)"
SESSION_KEY_2="$(openssl rand -hex 32)"
DB_PASSWORD="$(openssl rand -hex 16)"
DB_ADMIN_PASSWORD="$(openssl rand -hex 16)"
ADMIN_PASSWD_HASH="$(python3 -B -c 'import secrets, sys; sys.path.insert(0, sys.argv[1]); import stack_render; print(stack_render.odoo_admin_hash(secrets.token_hex(16)))' "$TOOL_DIR")"
ADMIN_A_PASSWORD="$(openssl rand -hex 16)"
ADMIN_B_PASSWORD="$(openssl rand -hex 16)"

# Write passwords to 0600 files in temp dir (never on CLI)
printf '%s' "$ADMIN_A_PASSWORD" > "$TMPDIR_BASE/admin_a_password"
printf '%s' "$ADMIN_B_PASSWORD" > "$TMPDIR_BASE/admin_b_password"
chmod 0600 "$TMPDIR_BASE/admin_a_password" "$TMPDIR_BASE/admin_b_password"

ODOO_COMMIT="${ODOO_COMMIT:-$(cat "$REPO_ROOT/deploy/odoo/ODOO_COMMIT" 2>/dev/null || echo unset)}"
# Disposable per-tenant scratch databases. The *_scratch suffix is required by
# deploy/classification.py's fixture guard (see the classification block below).
TENANT_A_DB="liwan_accept_a_scratch"
TENANT_B_DB="liwan_accept_b_scratch"
TENANT_DATABASES=("$TENANT_A_DB" "$TENANT_B_DB")

# Host paths the stack mounts. The control state directory holds the effect classifications the Odoo service mounts
# read-only at /run/liwan-runtime/classifications.
REGISTRY_DIR="$TMPDIR_BASE/registry"
CONTROL_STATE_DIR="$TMPDIR_BASE/control-state"
CLASSIFICATION_DIR="$CONTROL_STATE_DIR/classifications"
# The signed release proof the edge serves (deploy/stack/compose.yml mounts it read-only; the directory must exist).
PROOF_DIR="$TMPDIR_BASE/release-proof"
mkdir -p "$REGISTRY_DIR" "$CLASSIFICATION_DIR" "$TMPDIR_BASE/restore-registry" "$TMPDIR_BASE/maintenance" "$PROOF_DIR"
# Readable by the unprivileged guard/web/odoo users.
chmod 0755 "$REGISTRY_DIR" "$CONTROL_STATE_DIR" "$CLASSIFICATION_DIR" "$TMPDIR_BASE/restore-registry" "$TMPDIR_BASE/maintenance" "$PROOF_DIR"

# --- Harness values: the whole difference from local.env.example ---
# The edge binds 127.0.0.1 on 443/80: the guard resolves the tenant from a Host header without a port, and Caddy
# forwards the Host unchanged. Every other network gets an explicit subnet in 10.240.0.0/16 (see subnets.yml).
cat > "$RUN_DIR/harness.env" << HARNESS_EOF
LIWAN_IMAGE_TAG=$LIWAN_IMAGE_TAG
ODOO_COMMIT=$ODOO_COMMIT
DB_NAME=$TENANT_A_DB
DB_PASSWORD=$DB_PASSWORD
DB_ADMIN_PASSWORD=$DB_ADMIN_PASSWORD
LIWAN_ODOO_ADMIN_PASSWD='$ADMIN_PASSWD_HASH'
LIWAN_SHARED_PROXY_TOKEN=$PROXY_TOKEN
LIWAN_SESSION_KEYS='{"k1":"${SESSION_KEY_1}","k2":"${SESSION_KEY_2}"}'
LIWAN_SESSION_ACTIVE_KID=k1
DOMAIN='$HOST_A $HOST_B'
LIWAN_RESTORE_DOMAIN=restore.$DOMAIN_SUFFIX
LIWAN_TIKTOK_RELAY_HOST=tiktok.$DOMAIN_SUFFIX
LIWAN_SITE_SCHEME=
LIWAN_AUTO_HTTPS=ignore_loaded_certs
LIWAN_EDGE_BIND=127.0.0.1
LIWAN_EDGE_HTTPS_PORT=443
LIWAN_EDGE_HTTP_PORT=80
LIWAN_EDGE_SUBNET=10.240.2.0/24
LIWAN_HARNESS_SUBNET_GUARD_WEB=10.240.4.0/24
LIWAN_HARNESS_SUBNET_GUARD_ODOO=10.240.6.0/24
LIWAN_HARNESS_SUBNET_DATABASE=10.240.8.0/24
LIWAN_HARNESS_SUBNET_AI_INTERNAL=10.240.10.0/24
LIWAN_HARNESS_SUBNET_ODOO_EGRESS=10.240.12.0/24
LIWAN_HARNESS_SUBNET_ODOO_MAIL=10.240.14.0/24
LIWAN_HARNESS_SUBNET_RELAY_ODOO=10.240.16.0/24
LIWAN_HARNESS_SUBNET_GUARD_RESTORE=10.240.18.0/24
LIWAN_HARNESS_SUBNET_RESTORE_DATABASE=10.240.20.0/24
LIWAN_HARNESS_SUBNET_TENANT_STORAGE=10.240.22.0/24
LIWAN_SHARED_ODOO_CONFIG=$RUN_DIR/odoo.conf
LIWAN_TENANT_REGISTRY_DIR=$REGISTRY_DIR
LIWAN_RESTORE_REGISTRY_DIR=$TMPDIR_BASE/restore-registry
LIWAN_MAINTENANCE_DIR=$TMPDIR_BASE/maintenance
LIWAN_RELEASE_PROOF_DIR=$PROOF_DIR
LIWAN_CONTROL_STATE_DIR=$CONTROL_STATE_DIR
HARNESS_EOF
chmod 0600 "$RUN_DIR/harness.env"
python3 -B "$TOOL_DIR/stack_render.py" render "$RUN_DIR"
echo "Stack rendered: $RUN_DIR/compose.yml"

# --- Commercial classification (required by liwan_platform at install) ---
# liwan_platform's tenant-profile post_init_hook calls commercial_config.load_classification(), which needs an
# absolute path to a local, database-bound file. The generator is the repository's own (the same call the CI pipeline
# uses), never hand-written:
#
#   python3 deploy/classification.py fixture --database <db> --mode saas --output <path>
#
# `fixture` is a disposable-input generator: it refuses any database name that does not match liwan_*scratch* and
# refuses odoo19/production/postgres names, hence the liwan_accept_{a,b}_scratch names. The files land in the
# directory the stack mounts into Odoo (/run/liwan-runtime/classifications), and only the one-off init and seeding
# runs name them: the running service sets no LIWAN_COMMERCIAL_CONFIG, because the classification is read once, inside
# liwan.tenant.profile.create(), and the profile is persisted.
for DBT in "${TENANT_DATABASES[@]}"; do
  python3 "$REPO_ROOT/deploy/classification.py" fixture \
    --database "$DBT" --mode saas --output "$CLASSIFICATION_DIR/$DBT.json"
  chmod 0644 "$CLASSIFICATION_DIR/$DBT.json"
done
echo "Commercial classification (saas) generated for: ${TENANT_DATABASES[*]}"
CLASSIFICATION_MOUNT="/run/liwan-runtime/classifications"

# --- Tenant registry ---
# Schema matches tenantRegistry.ts validateRegistry(): schemaVersion=1,
# snapshotRevision>=1, targets[] with host (lowercase ASCII, no port),
# tenantId, database=filestore, enabled, registryRevision.
# Filename: registry.json under the registry dir, mounted as /etc/liwan/.
# Guard reads LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json.
cat > "$REGISTRY_DIR/registry.json" << REGISTRY_EOF
{"schemaVersion":1,"snapshotRevision":1,"targets":[{"host":"$HOST_A","tenantId":"accept-a","database":"${TENANT_A_DB}","filestore":"${TENANT_A_DB}","enabled":true,"registryRevision":1},{"host":"$HOST_B","tenantId":"accept-b","database":"${TENANT_B_DB}","filestore":"${TENANT_B_DB}","enabled":true,"registryRevision":1}]}
REGISTRY_EOF
chmod 0644 "$REGISTRY_DIR/registry.json"

# --- odoo.conf ---
# Rendered by stack_render.py from deploy/stack/odoo.conf.template (the stack's own config: dbfilter, list_db, sizing)
# with the db password and the master-password hash of the harness. Mode 0400; the runtime validator also checks that it
# is owned by the container's uid (10001 = odoo in the image) or root.
ODOO_UID="$(docker run --rm --entrypoint id "liwan-odoo:$LIWAN_IMAGE_TAG" -u odoo 2>/dev/null || echo unknown)"
if [ "$ODOO_UID" != "10001" ]; then
  echo "WARNING: expected odoo uid 10001, got '$ODOO_UID'." >&2
fi
if [ "$(uname -s)" = "Linux" ] && [ "$(id -u)" = "0" ]; then
  chown "$ODOO_UID" "$RUN_DIR/odoo.conf"
fi
# Validate with the validator the image was built with, as the runtime uid.
docker run --rm --user "$ODOO_UID" -v "$RUN_DIR/odoo.conf:/etc/odoo/odoo.conf:ro" \
  --entrypoint /opt/venv/bin/python "liwan-odoo:$LIWAN_IMAGE_TAG" \
  /opt/liwan/shared/validate_odoo_config.py /etc/odoo/odoo.conf
echo "odoo.conf validated by the image as container uid $ODOO_UID."

# === LIFECYCLE ===

# --- 1. Start only the db service ---
compose up -d --no-build --pull never --no-deps db

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

# --- 3. Create tenant databases (no host psql), close them to PUBLIC and add pg_trgm ---
# Shared odoo.conf connects every tenant as db_user (odoo), a plain role; the admin role postgres creates and
# grants. A new database is open to every role through
# PUBLIC, so CONNECT is revoked right after creation and granted to that role only. The SQL comes from
# deploy/release/tenant_postgres.py (the one source); psql stops on the first error and the pipeline fails with it.
TENANT_DB_ROLE="odoo"
create_tenant_database() {
  (cd "$REPO_ROOT" && python3 -B -c 'import sys; from deploy.release.tenant_postgres import tenant_create_database_sql, tenant_isolation_sql, cluster_connect_grant_sql; sys.stdout.write(tenant_create_database_sql(sys.argv[1]) + ";\n" + tenant_isolation_sql(sys.argv[1], sys.argv[2]) + cluster_connect_grant_sql(sys.argv[2]) + ";\n")' "$1" "$TENANT_DB_ROLE") \
    | compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q
  (cd "$REPO_ROOT" && python3 -B -c 'import sys; from deploy.release.tenant_postgres import tenant_bootstrap_sql; sys.stdout.write(tenant_bootstrap_sql(sys.argv[1]))' "$TENANT_DB_ROLE") \
    | compose exec -T db psql -U postgres -d "$1" -v ON_ERROR_STOP=1 -q
}
for DBT in "${TENANT_DATABASES[@]}"; do
  create_tenant_database "$DBT"
done
echo "Databases created and closed to PUBLIC."

# --- 4. Install LiwanOS addons into each DB ---
# The service entrypoint (launch_odoo.py) rejects CLI args, so the one-off runs override it with liwan-odoo.
# The validated odoo.conf is mounted read-only by the stack.
for DBT in "${TENANT_DATABASES[@]}"; do
  # NOTE: every `docker compose run` option (-e/-T/--entrypoint) must appear
  # BEFORE the service name; anything after it is passed to the container as
  # command arguments (which previously produced "odoo_secure.py: error: no such
  # option: -e").
  compose run --rm --no-deps -T \
    -e LIWAN_COMMERCIAL_CONFIG="$CLASSIFICATION_MOUNT/$DBT.json" \
    --entrypoint /usr/local/bin/liwan-odoo odoo \
    server -c /etc/odoo/odoo.conf \
    -d "$DBT" --db-filter="^${DBT}\$" \
    -i liwan_core,liwan_platform,liwan_api,liwan_document_service,liwan_directory,liwan_documents,liwan_approval_service,liwan_notify,liwan_operations,liwan_ai,liwan_chat,liwan_integrations_sa,liwan_meetings,liwan_payments,liwan_tasks,liwan_ai_notify,liwan_integrations_payments,liwan_orders,liwan_customers,liwan_products,liwan_crm,liwan_crm_meetings,liwan_crm_tasks,liwan_payments_customers,liwan_inbox,liwan_crm_inbox,liwan_pmo,liwan_meetings_pmo,liwan_operations_pmo,liwan_tasks_pmo,liwan_hr,liwan_finance,liwan_api_account,liwan_hr_finance,liwan_pmo_finance,liwan_products_account,liwan_appointments,liwan_sales,liwan_sales_crm,liwan_sales_finance,liwan_helpdesk,liwan_helpdesk_sales,liwan_helpdesk_inbox,liwan_helpdesk_documents,liwan_helpdesk_crm,liwan_helpdesk_tasks \
    --stop-after-init --no-http
done
echo "Addons installed."

# --- 4b. Seed the initial tenant feature policy (canonical script) ---
# deploy/seed_legacy_policy.py is the repository's single canonical seeding
# script for the tenant policy: installing the addons alone leaves
# liwan.tenant.profile with policy_revision=0 and no features. Run it once per
# tenant DB, piped on stdin (the container cannot see the repo, but stdin is
# sufficient — no bind mount needed). The script commits inside odoo shell, so no
# extra commit handling is required.
seed_policy() {
  local DBT="$1"
  # All options precede the service name (see the note in the install step).
  compose run --rm --no-deps -T \
    -e LIWAN_COMMERCIAL_CONFIG="$CLASSIFICATION_MOUNT/$DBT.json" \
    --entrypoint /usr/local/bin/liwan-odoo odoo \
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
    -e LIWAN_COMMERCIAL_CONFIG="$CLASSIFICATION_MOUNT/$DBT.json" \
    --entrypoint /usr/local/bin/liwan-odoo odoo \
    shell -c /etc/odoo/odoo.conf -d "$DBT" --db-filter="^${DBT}\$" --no-http << PYEOF
profile = env.ref('liwan_platform.tenant_profile')
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
  export LIWAN_ACCEPT_ADMIN_PASSWORD="$PW"
  export LIWAN_ACCEPT_SEED="$(cat "$TOOL_DIR/seed_tenant.py")"
  # All options precede the service name (see the note in the install step).
  compose run --rm --no-deps -T \
    -e LIWAN_COMMERCIAL_CONFIG="$CLASSIFICATION_MOUNT/$DBT.json" \
    -e LIWAN_ACCEPT_ADMIN_LOGIN="$LOGIN" \
    -e LIWAN_ACCEPT_ADMIN_PASSWORD \
    -e LIWAN_ACCEPT_PROJECT_NAME="$PROJ" \
    -e LIWAN_ACCEPT_EMPLOYEE="$EMP" \
    -e LIWAN_ACCEPT_SEED \
    --entrypoint /usr/local/bin/liwan-odoo odoo \
    shell -c /etc/odoo/odoo.conf -d "$DBT" --db-filter="^${DBT}\$" --no-http << 'PYEOF'
import os
exec(compile(os.environ['LIWAN_ACCEPT_SEED'], '<acceptance-seed>', 'exec'))
PYEOF
}
seed_tenant "$TENANT_A_DB" "admin@$HOST_A" "ACCEPT-A-ONLY" "ACCEPT-A-EMP" "$TMPDIR_BASE/admin_a_password"
seed_tenant "$TENANT_B_DB" "admin@$HOST_B" "ACCEPT-B-ONLY" "ACCEPT-B-EMP" "$TMPDIR_BASE/admin_b_password"
echo "Tenants seeded."

# --- 6. Bring up the full stack ---
compose up -d --no-build --pull never

# Wait on the real compose healthchecks that this stack defines. The proxy has none (it starts only once web, odoo
# and guard are healthy); the root CA wait and the routed readiness probe below prove it.
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
for HOST in "$HOST_A" "$HOST_B"; do
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
