#!/usr/bin/env bash
# One-time preparation of a production-style host (development, staging, production) for the control plane and the shared
# worker: what no other step creates. init-local.sh is the local harness and stays separate.
#
#   init-host.sh <environment env file> <shared project name>
#
# The env file is the compose env file of the environment (deploy/environments/<name>.env.example, filled in); only these
# names are read, nothing is sourced: LIWAN_CONTROL_CONFIG_DIR, LIWAN_CONTROL_STATE_DIR, LIWAN_CONTROL_PRIVATE_DIR,
# LIWAN_TENANT_REGISTRY_DIR, LIWAN_SHARED_COMPOSE_FILE, LIWAN_SHARED_ENV_FILE, LIWAN_RESTORE_DOMAIN, LIWAN_CONTROL_UID,
# LIWAN_CONTROL_GID (which must be the uid and gid of the worker account, or the script stops).
# The project name is the compose project of the shared stack (`liwan-shared-<name>`). LIWAN_WORKER_USER names the host
# account the shared worker and the control containers run as (default liwan-worker).
#
# Creates, never overwrites (an existing file or directory is kept as it is, a half-present pair is an error):
#   registry dir: created 0755 (read-only mount in containers that run as other users); an existing narrower one is an error
#   config dir:  shared-runtime.json, inventory-v2.json
#   private dir: control-ca.key/.pem (private CA), control-tls.key/.crt (SAN control-api), effect-tls.key/.crt (SAN
#                control-host.internal), control-db-password
# Keys and certificates are made in a work directory inside the private directory and moved into place only when complete.
# Run it as root (ownership goes to the worker account) or as the worker account itself. Prints paths only, no secret values.
# Every run warns on stderr (exit 0) about a kept certificate that expires within 60 days.
# The compose file named in shared-runtime.json (LIWAN_SHARED_COMPOSE_FILE) is not made here: release.py renders it from the
# shared stack at every activation, before it starts the worker. The shared env file is the operator's.
set +x
set +v
set -euo pipefail

CA_DAYS=3650
LEAF_DAYS=825
EXPIRY_WARNING_SECONDS=$((60 * 86400))
POSTGRES_UID=999  # the user of the postgres image; it reads control-db-password through the compose secret

die() { printf '%s\n' "$*" >&2; exit 2; }

env_value() {
  local value
  value="$(grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-)" || true
  [[ -n "$value" && "$value" != REPLACE_WITH_* ]] || die "$1 is not set (or is still a REPLACE_WITH_ placeholder) in $ENV_FILE"
  printf '%s' "$value"
}

absolute_path() {
  [[ "$2" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "$1 must be an absolute path of letters, digits and ._/- only: $2"
  printf '%s' "$2"
}

# own <path> <mode> [owner]: the worker (or the given owner, with the worker's group) owns what it must read or write; as
# the worker itself there is nothing to change.
own() {
  chmod "$2" "$1"
  if [[ "$(id -u)" == 0 ]]; then chown "${3:-$WORKER}:$WORKER_GROUP" "$1"; fi
}

ensure_dir() {
  if [[ -d "$1" ]]; then printf 'kept    %s\n' "$1"; return; fi
  (umask 022; mkdir -p "$1")
  own "$1" "$2"
  printf 'created %s\n' "$1"
}

# ensure_readable_dir <dir>: the registry directory is bind-mounted read-only into containers that run as other users
# (guard and web as node, ai as uid 10001), so it is 0755 and an existing narrower one is refused, never changed.
ensure_readable_dir() {
  ensure_dir "$1" 0755
  local mode
  mode="$(stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1")"
  (( (8#$mode & 5) == 5 )) || die "Refusing: $1 is mode $mode; the guard, web, ai and tiktok-relay containers run as other users and need r-x for everyone (chmod 0755 it, then run again)"
}

# exists_all <file...>: true when every file exists, false when none does; a mix is an error.
exists_all() {
  local count=0 file
  for file in "$@"; do if [[ -e "$file" ]]; then count=$((count + 1)); fi; done
  if (( count != 0 && count != $# )); then die "Refusing: only part of this set exists: $*"; fi
  (( count != 0 ))
}

# write_file <path> <mode> [owner]: the content comes on stdin.
write_file() {
  cat > "$1"
  own "$1" "$2" "${3:-}"
  printf 'created %s\n' "$1"
}

# warn_if_expiring <certificate>: a kept certificate that ends within 60 days is reported, never replaced.
warn_if_expiring() {
  if ! openssl x509 -in "$1" -noout -checkend "$EXPIRY_WARNING_SECONDS" >/dev/null; then
    printf 'warning: %s expires within 60 days or cannot be read; renew it (control-plane-deployment.md, Certificate renewal)\n' "$1" >&2
  fi
}

# install_pair <key> <certificate>: the finished pair goes to the private directory (same filesystem: a rename), key first.
# If the second move fails the first file is removed, so a half pair is never taken for a complete one.
install_pair() {
  mv "$1" "$PRIVATE/$(basename "$1")"
  mv "$2" "$PRIVATE/$(basename "$2")" || { rm -f "$PRIVATE/$(basename "$1")"; die "Could not install $2"; }
  printf 'created %s\ncreated %s\n' "$PRIVATE/$(basename "$1")" "$PRIVATE/$(basename "$2")"
}

new_key() { openssl ecparam -genkey -name prime256v1 -noout -out "$1"; }

# sign <csr> <ca key> <ca pem> <extensions file> <days> <out>
sign() {
  openssl x509 -req -in "$1" -CAkey "$2" -CA "$3" -set_serial "0x$(openssl rand -hex 16)" -extfile "$4" -days "$5" -out "$6"
}

ensure_ca() {
  if exists_all "$CA_KEY" "$CA_PEM"; then warn_if_expiring "$CA_PEM"; printf 'kept    %s\n' "$CA_PEM"; return; fi
  new_key "$WORK/control-ca.key"
  openssl req -new -key "$WORK/control-ca.key" -subj "/CN=liwan control CA" -out "$WORK/ca.csr"
  printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\n' > "$WORK/ca.ext"
  openssl x509 -req -in "$WORK/ca.csr" -signkey "$WORK/control-ca.key" -extfile "$WORK/ca.ext" -days "$CA_DAYS" -out "$WORK/control-ca.pem"
  own "$WORK/control-ca.key" 0600
  own "$WORK/control-ca.pem" 0644
  install_pair "$WORK/control-ca.key" "$WORK/control-ca.pem"
}

# ensure_leaf <name> <dns name>: <name>.key (worker only) and <name>.crt signed by the private CA.
ensure_leaf() {
  local key="$PRIVATE/$1.key" cert="$PRIVATE/$1.crt"
  if exists_all "$key" "$cert"; then warn_if_expiring "$cert"; printf 'kept    %s\n' "$cert"; return; fi
  [[ -f "$CA_KEY" && -f "$CA_PEM" ]] || die "Cannot sign $1: the CA key or certificate is missing"
  new_key "$WORK/$1.key"
  openssl req -new -key "$WORK/$1.key" -subj "/CN=$2" -out "$WORK/$1.csr"
  printf 'basicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s\n' "$2" > "$WORK/$1.ext"
  sign "$WORK/$1.csr" "$CA_KEY" "$CA_PEM" "$WORK/$1.ext" "$LEAF_DAYS" "$WORK/$1.crt"
  own "$WORK/$1.key" 0600
  own "$WORK/$1.crt" 0644
  install_pair "$WORK/$1.key" "$WORK/$1.crt"
}

[[ "$#" == 2 ]] || die "Usage: $0 <environment env file> <shared project name>"
ENV_FILE="$1"
PROJECT="$2"
[[ -r "$ENV_FILE" ]] || die "Cannot read the env file: $ENV_FILE"
[[ "$PROJECT" =~ ^liwan-(saas|shared)-[a-z0-9-]{3,48}$ ]] || die "The project name must look like liwan-shared-<name>: $PROJECT"
command -v openssl >/dev/null || die "openssl is required"
WORKER="${LIWAN_WORKER_USER:-liwan-worker}"
WORKER_GROUP="$(id -gn "$WORKER" 2>/dev/null)" || die "The worker account does not exist: $WORKER"
if [[ "$(id -u)" != 0 && "$(id -un)" != "$WORKER" ]]; then die "Run as root or as $WORKER"; fi

CONTROL_UID="$(env_value LIWAN_CONTROL_UID)"
CONTROL_GID="$(env_value LIWAN_CONTROL_GID)"
[[ "$CONTROL_UID" == "$(id -u "$WORKER")" ]] || die "LIWAN_CONTROL_UID ($CONTROL_UID) is not the uid of $WORKER ($(id -u "$WORKER"))"
[[ "$CONTROL_GID" == "$(id -g "$WORKER")" ]] || die "LIWAN_CONTROL_GID ($CONTROL_GID) is not the gid of $WORKER ($(id -g "$WORKER"))"

CONFIG="$(absolute_path LIWAN_CONTROL_CONFIG_DIR "$(env_value LIWAN_CONTROL_CONFIG_DIR)")"
STATE="$(absolute_path LIWAN_CONTROL_STATE_DIR "$(env_value LIWAN_CONTROL_STATE_DIR)")"
PRIVATE="$(absolute_path LIWAN_CONTROL_PRIVATE_DIR "$(env_value LIWAN_CONTROL_PRIVATE_DIR)")"
REGISTRY="$(absolute_path LIWAN_TENANT_REGISTRY_DIR "$(env_value LIWAN_TENANT_REGISTRY_DIR)")"
COMPOSE_FILE="$(absolute_path LIWAN_SHARED_COMPOSE_FILE "$(env_value LIWAN_SHARED_COMPOSE_FILE)")"
SHARED_ENV_FILE="$(absolute_path LIWAN_SHARED_ENV_FILE "$(env_value LIWAN_SHARED_ENV_FILE)")"
DOMAIN_SUFFIX="$(env_value LIWAN_RESTORE_DOMAIN)"
[[ "$DOMAIN_SUFFIX" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "LIWAN_RESTORE_DOMAIN is not a domain suffix: $DOMAIN_SUFFIX"
CA_KEY="$PRIVATE/control-ca.key"
CA_PEM="$PRIVATE/control-ca.pem"

umask 077
ensure_dir "$CONFIG" 0750
ensure_dir "$STATE" 0750
ensure_readable_dir "$REGISTRY"
ensure_dir "$PRIVATE" 0750
WORK="$(mktemp -d "$PRIVATE/.init.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

if ! exists_all "$CONFIG/shared-runtime.json"; then
  printf '{"schemaVersion":1,"projectName":"%s","composeFile":"%s","envFile":"%s","stateDir":"%s","domainSuffix":"%s"}\n' \
    "$PROJECT" "$COMPOSE_FILE" "$SHARED_ENV_FILE" "$STATE" "$DOMAIN_SUFFIX" | write_file "$CONFIG/shared-runtime.json" 0644
else printf 'kept    %s\n' "$CONFIG/shared-runtime.json"; fi

if ! exists_all "$CONFIG/inventory-v2.json"; then
  printf '{"version":2,"targets":{}}\n' | write_file "$CONFIG/inventory-v2.json" 0644
else printf 'kept    %s\n' "$CONFIG/inventory-v2.json"; fi

ensure_ca
ensure_leaf control-tls control-api
ensure_leaf effect-tls control-host.internal

# The postgres container reads this file as its own user (uid 999). As root it is that user's alone (0400); as the worker
# account itself the file cannot be handed to uid 999, so it is world-readable and the private directory (0750, worker group)
# keeps other host users out.
if ! exists_all "$PRIVATE/control-db-password"; then
  if [[ "$(id -u)" == 0 ]]; then
    openssl rand -hex 32 | write_file "$PRIVATE/control-db-password" 0400 "$POSTGRES_UID"
  else
    openssl rand -hex 32 | write_file "$PRIVATE/control-db-password" 0444
  fi
else printf 'kept    %s\n' "$PRIVATE/control-db-password"; fi
