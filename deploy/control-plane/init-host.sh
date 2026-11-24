#!/usr/bin/env bash
# One-time preparation of a production-style host (staging, production) for the control plane and the shared
# worker: what no other step creates. init-local.sh is the local harness and stays separate.
#
#   init-host.sh <environment env file> <shared project name>
#
# The env file is the compose env file of the environment (deploy/environments/<name>.env.example, filled in); only these
# names are read, nothing is sourced: LIWAN_CONTROL_CONFIG_DIR, LIWAN_CONTROL_STATE_DIR, LIWAN_CONTROL_PRIVATE_DIR,
# LIWAN_TENANT_REGISTRY_DIR, LIWAN_AI_PLATFORM_DIR, LIWAN_SHARED_COMPOSE_FILE, LIWAN_SHARED_ENV_FILE, LIWAN_RESTORE_DOMAIN, LIWAN_CONTROL_UID,
# LIWAN_CONTROL_GID (which must be the uid and gid of the worker account, or the script stops).
# The project name is the compose project of the shared stack (`liwan-shared-<name>`). LIWAN_WORKER_USER names the host
# account the shared worker and the control containers run as (default liwan-worker).
#
# Creates, never overwrites (an existing file or directory is kept as it is, a half-present pair is an error):
#   registry dir: created 0755 (read-only mount in containers that run as other users); an existing narrower one is an error
#                 registry.json, the deny-all bootstrap snapshot (the guard will not start without the file; the control plane
#                 writes it only on the first tenant change), 0644 like the control plane's own writes
#   AI dir:      LIWAN_AI_PLATFORM_DIR, created empty, 2750 worker:10001 (the control plane writes platform-provider.json into
#                it as 0640 and the setgid bit gives that file the group of the `ai` container user, uid and gid 10001, which
#                mounts the directory read-only). An existing one is kept only when it is already worker:10001 with mode 2750, else the
#                script stops and prints the fix. Never a file: a missing file means "AI unconfigured" and the control plane
#                writes the real one. As the worker itself it needs that group, or the script stops.
#   LIWAN_AI_GID (environment, not the env file) is the gid of the `ai` container user (10001, apps/ai-service/Dockerfile);
#                it exists so the tests can run as an ordinary account whose own gid stands in for it. Never set it on a host.
#   config dir:  shared-runtime.json, inventory-v2.json
#   private dir: control-ca.key/.pem (private CA), control-tls.key/.crt (SAN control-api), effect-tls.key/.crt (SAN
#                control-host.internal), control-db-password
# Keys and certificates are made in a work directory inside the private directory and moved into place only when complete.
# Run it as root (ownership goes to the worker account) or as the worker account itself. Prints paths only, no secret values.
# As root it also applies the effect boundary of liwan-effect.socket (docs/operations/environment-bringup.md), idempotently:
#   config dir and its json files   root:<worker group> 0750 / 0640 (the effect gate trusts only root-owned inputs); the directory is
#                                   settled before anything is made in it. An existing json file that is not root-owned, or is writable by
#                                   group or other, is replaced by a fresh root-owned copy when its content is exactly what this script
#                                   writes, and refused otherwise (review it: it names the compose file the effect account runs as root)
#   state dir                       root:<worker group> 3770 (setgid and sticky: the worker cannot rename what the effect account owns)
#   effect subdirectories           reservations credentials classifications restore-effects reconfigure runtime-gate-history tenant-storage backups,
#                                   created when absent, owned by the effect account (LIWAN_EFFECT_USER, default liwan-effect), 0700;
#                                   classifications 0755 (containers read it as another uid), backups 0750 (the worker reads manifests
#                                   and cannot write there). An existing one must be a real directory owned by the effect account and not
#                                   writable by group or other, else the script stops and says what to review
#   shared env file                 root:docker 0640, when it exists (LIWAN_DOCKER_GROUP, default docker); the worker is not in that group.
#                                   An existing one must already be root-owned and not writable by group or other (its content is the operator's)
#   docker client config            LIWAN_DOCKER_CONFIG_DIR (default /etc/liwan/docker): config.json `{}`, root-owned, created when absent;
#                                   an existing one must be root-owned and not writable by group or other
# As root nothing is settled through a symbolic link: a link, or anything but a regular file or real directory, stops the script, and the
# directory holding a settled path must be root-owned and not writable by group or other. LIWAN_ROOT_UID (default 0) is the uid counted as
# root; it exists so the tests can run as an ordinary account. Never set it on a host.
#   restore-registry                created when absent, owned by the effect account, group worker, 0775 (the worker writes files in it and cannot
#                                   replace the directory; the sticky state directory lets only an entry's owner rename it, so a worker-owned one
#                                   could become a link that dockerd follows when it bind-mounts it into the guard and restore-odoo containers)
# The effect account must exist and is the only `docker` member.
# Files are never written through a path a less trusted account can influence: they are built in a root-owned work directory and copied
# in by `place` (exclusive create, final mode from the umask, chown -h, no-clobber rename), and every existing link is refused.
# Every run warns on stderr (exit 0) about a kept certificate that expires within 60 days.
# The compose file named in shared-runtime.json (LIWAN_SHARED_COMPOSE_FILE) is not made here: release.py renders it from the
# shared stack at every activation, before it starts the worker. The shared env file is the operator's.
set +x
set +v
set -euo pipefail

CA_DAYS=3650
LEAF_DAYS=825
EXPIRY_WARNING_SECONDS=$((60 * 86400))
AI_GID="${LIWAN_AI_GID:-10001}"  # the gid of the `ai` container user (apps/ai-service/Dockerfile, useradd --uid 10001)
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

ROOT_UID="${LIWAN_ROOT_UID:-0}"  # the uid counted as root; the tests run as an ordinary account (never set it on a host)

owner_of() { stat -c '%u' "$1" 2>/dev/null || stat -f '%u' "$1"; }
mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# plain <path> <d|f>: refuse a symbolic link and anything but a real directory (d) or regular file (f); the checks come before any
# chown or chmod, so a link planted by a less trusted account is never followed.
plain() {
  [[ ! -L "$1" ]] || die "Refusing: $1 is a symbolic link; review where it points, remove it, then run again"
  if [[ "$2" == d ]]; then [[ -d "$1" ]] || die "Refusing: $1 is not a directory"
  else [[ -f "$1" ]] || die "Refusing: $1 is not a regular file"; fi
}

# root_safe <path>: owned by root and writable by neither group nor other.
root_safe() { [[ "$(owner_of "$1")" == "$ROOT_UID" ]] && (( (8#$(mode_of "$1") & 022) == 0 )); }

# trusted_parent <path>: the directory that holds it is a real directory, root-owned and closed to group and other, so nobody else can
# swap the entry between a check and the chown after it.
trusted_parent() {
  plain "$(dirname "$1")" d
  root_safe "$(dirname "$1")" || die "Refusing: $(dirname "$1") must be owned by root and not writable by group or other (it holds $1)"
}

# settle <path> <d|f> <mode> <owner> <group>: root only for the owner and group, set first because chown clears the setgid bit; then the
# mode. The path is re-checked after the chown (chown -h never follows a link; chmod does), so a swap in between is refused. The mode goes
# on with that extra leading zero because a directory made inside the setgid state directory inherits the setgid bit, and GNU chmod keeps
# a directory's special bits unless the numeric mode carries that fifth digit: `chmod 0700` on such a directory leaves 2700, only
# `chmod 00700` gives it the 0700 this script documents.
settle() {
  plain "$1" "$2"
  if [[ "$(id -u)" == 0 ]]; then chown -h "$4:$5" "$1"; fi
  plain "$1" "$2"
  chmod "0$3" "$1"
}

# ensure_dir <dir> <mode>: an existing entry must be a real directory (a link, even to a directory, stops the script: root would write
# through it). A new one is made, and as root its parent must be root-owned and closed to group and other before anything is
# changed on it (settle: chown -h, then chmod), because an owner of the parent could swap the new entry for a link in between.
ensure_dir() {
  if [[ -e "$1" || -L "$1" ]]; then plain "$1" d; printf 'kept    %s\n' "$1"; return; fi
  (umask 022; mkdir -p "$1")
  if [[ "$(id -u)" == 0 ]]; then
    (trusted_parent "$1") || { rmdir "$1" 2>/dev/null || true; exit 2; }
    settle "$1" d "$2" "$WORKER" "$WORKER_GROUP"
  else chmod "$2" "$1"; fi
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

# ensure_ai_dir <dir>: owner the worker, group the `ai` user's. The control plane writes the provider file here as 0640
# (FILE_MODE in apps/control-plane/src/ai-provider/store.ts) under the worker uid; the setgid bit gives it the directory's
# group, and the `ai` container reads it through that group. Group before mode, because chgrp clears the setgid bit.
# An existing directory is kept only when it already has exactly that shape: Docker creates a missing bind-mount source as
# root:root 0755, and a hand-made one is usually the wrong group, so the provider file would be unwritable or unreadable.
ensure_ai_dir() {
  if [[ -e "$1" || -L "$1" ]]; then
    plain "$1" d
    local shape  # GNU stat prints the mode as 2750; BSD stat prints the special bits (%Mp) and the permissions (%Lp) apart, as 02750
    shape="$(stat -c '%u:%g:%a' "$1" 2>/dev/null || stat -f '%u:%g:%Mp%Lp' "$1")"
    shape="${shape%:*}:$(printf '%s' "${shape##*:}" | sed 's/^0//')"
    [[ "$shape" == "$(id -u "$WORKER"):$AI_GID:2750" ]] || die "Refusing: $1 is owner:group:mode $shape; it must be $(id -u "$WORKER"):$AI_GID:2750 so the control plane can write the provider file and the ai container can read it (chown $WORKER:$AI_GID $1 && chmod 2750 $1, then run again)"
    printf 'kept    %s\n' "$1"
    return
  fi
  (umask 022; mkdir -p "$1")
  if [[ "$(id -u)" == 0 ]]; then
    # Its parent is the sticky state directory (settled before this runs): the new entry belongs to root, so the worker cannot swap it
    # until the chown below hands it over; the mode goes on first for that reason, and the shape is checked after.
    plain "$1" d
    chmod 2750 "$1"
    chown -h "$WORKER:$AI_GID" "$1"
    plain "$1" d
    [[ "$(mode_of "$1")" == 2750 || "$(mode_of "$1")" == 750 ]] || die "Refusing: $1 lost its mode while it was handed over; review it"
  else
    if ! chgrp "$AI_GID" "$1" 2>/dev/null; then rmdir "$1"; die "Cannot give $1 to group $AI_GID as $WORKER; run as root"; fi
    chmod 2750 "$1"
  fi
  printf 'created %s\n' "$1"
}

# exists_all <file...>: true when every file exists, false when none does; a mix is an error. A symbolic link counts as present and is
# refused whatever it points at (a dangling one too), so nothing is ever created through it.
exists_all() {
  local count=0 file
  for file in "$@"; do
    if [[ -L "$file" ]]; then die "Refusing: $file is a symbolic link; review where it points, remove it, then run again"; fi
    if [[ -e "$file" ]]; then count=$((count + 1)); fi
  done
  if (( count != 0 && count != $# )); then die "Refusing: only part of this set exists: $*"; fi
  (( count != 0 ))
}

# place <source> <destination> <mode> [owner]: copies a finished file (made in the root-owned work directory) into a directory that may
# belong to the worker, without ever following a link. The destination must not exist (a link included). The copy is made under an
# unpredictable name with noclobber (open with O_EXCL, which never follows a link, a dangling one included), and with the final mode
# already set by the umask, so no chmod on a path is needed; as root the owner is set with chown -h; then a no-clobber rename puts it
# in place (rename never follows a link either). The owner is the worker (with its group) unless given.
place() {
  local source="$1" destination="$2" mode="$3" owner="${4:-$WORKER}" temporary
  [[ ! -e "$destination" && ! -L "$destination" ]] || die "Refusing: $destination already exists (or is a link); review it, remove it, then run again"
  temporary="$(dirname "$destination")/.init.$(openssl rand -hex 8)"
  (umask "$(printf '%04o' $((0777 & ~8#$mode)))"; set -o noclobber; cat "$source" > "$temporary")
  if [[ "$(id -u)" == 0 ]]; then chown -h "$owner:$WORKER_GROUP" "$temporary"; fi
  mv -n "$temporary" "$destination"
  if [[ -e "$temporary" || -L "$temporary" ]]; then rm -f "$temporary"; die "Refusing: $destination appeared while it was being made; review it, then run again"; fi
  [[ -f "$destination" && ! -L "$destination" ]] || die "Refusing: $destination is not the regular file this script placed; review it"
}

# write_file <path> <mode> [owner]: the content comes on stdin.
write_file() {
  local staged="$WORK/staged.$$"
  cat > "$staged"
  place "$staged" "$1" "$2" "${3:-}"
  rm -f "$staged"
  printf 'created %s\n' "$1"
}

# warn_if_expiring <certificate>: a kept certificate that ends within 60 days is reported, never replaced.
warn_if_expiring() {
  if ! openssl x509 -in "$1" -noout -checkend "$EXPIRY_WARNING_SECONDS" >/dev/null; then
    printf 'warning: %s expires within 60 days or cannot be read; renew it (control-plane-deployment.md, Certificate renewal)\n' "$1" >&2
  fi
}

# install_pair <key> <certificate>: the finished pair goes to the private directory through `place` (key 0600, certificate 0644, the
# worker's), key first. If the second placement fails the first file is removed, so a half pair is never taken for a complete one.
install_pair() {
  place "$1" "$PRIVATE/$(basename "$1")" 0600
  ( place "$2" "$PRIVATE/$(basename "$2")" 0644 ) || { rm -f "$PRIVATE/$(basename "$1")"; die "Could not install $2"; }
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
  install_pair "$WORK/control-ca.key" "$WORK/control-ca.pem"
}

# ensure_leaf <name> <dns name>: <name>.key (worker only) and <name>.crt signed by the private CA.
ensure_leaf() {
  local key="$PRIVATE/$1.key" cert="$PRIVATE/$1.crt"
  if exists_all "$key" "$cert"; then warn_if_expiring "$cert"; printf 'kept    %s\n' "$cert"; return; fi
  plain "$CA_KEY" f; plain "$CA_PEM" f
  new_key "$WORK/$1.key"
  openssl req -new -key "$WORK/$1.key" -subj "/CN=$2" -out "$WORK/$1.csr"
  printf 'basicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s\n' "$2" > "$WORK/$1.ext"
  sign "$WORK/$1.csr" "$CA_KEY" "$CA_PEM" "$WORK/$1.ext" "$LEAF_DAYS" "$WORK/$1.crt"
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
EFFECT="${LIWAN_EFFECT_USER:-liwan-effect}"
DOCKER_GROUP="${LIWAN_DOCKER_GROUP:-docker}"
DOCKER_CONFIG_DIR="$(absolute_path LIWAN_DOCKER_CONFIG_DIR "${LIWAN_DOCKER_CONFIG_DIR:-/etc/liwan/docker}")"
if [[ "$(id -u)" == 0 ]]; then id -u "$EFFECT" >/dev/null 2>&1 || die "The effect account does not exist: $EFFECT (docs/operations/environment-bringup.md, A3.1)"; fi

CONTROL_UID="$(env_value LIWAN_CONTROL_UID)"
CONTROL_GID="$(env_value LIWAN_CONTROL_GID)"
[[ "$CONTROL_UID" == "$(id -u "$WORKER")" ]] || die "LIWAN_CONTROL_UID ($CONTROL_UID) is not the uid of $WORKER ($(id -u "$WORKER"))"
[[ "$CONTROL_GID" == "$(id -g "$WORKER")" ]] || die "LIWAN_CONTROL_GID ($CONTROL_GID) is not the gid of $WORKER ($(id -g "$WORKER"))"

CONFIG="$(absolute_path LIWAN_CONTROL_CONFIG_DIR "$(env_value LIWAN_CONTROL_CONFIG_DIR)")"
STATE="$(absolute_path LIWAN_CONTROL_STATE_DIR "$(env_value LIWAN_CONTROL_STATE_DIR)")"
PRIVATE="$(absolute_path LIWAN_CONTROL_PRIVATE_DIR "$(env_value LIWAN_CONTROL_PRIVATE_DIR)")"
REGISTRY="$(absolute_path LIWAN_TENANT_REGISTRY_DIR "$(env_value LIWAN_TENANT_REGISTRY_DIR)")"
AI_PLATFORM="$(absolute_path LIWAN_AI_PLATFORM_DIR "$(env_value LIWAN_AI_PLATFORM_DIR)")"
COMPOSE_FILE="$(absolute_path LIWAN_SHARED_COMPOSE_FILE "$(env_value LIWAN_SHARED_COMPOSE_FILE)")"
SHARED_ENV_FILE="$(absolute_path LIWAN_SHARED_ENV_FILE "$(env_value LIWAN_SHARED_ENV_FILE)")"
DOMAIN_SUFFIX="$(env_value LIWAN_RESTORE_DOMAIN)"
[[ "$DOMAIN_SUFFIX" =~ ^[a-z0-9-]+(\.[a-z0-9-]+)+$ ]] || die "LIWAN_RESTORE_DOMAIN is not a domain suffix: $DOMAIN_SUFFIX"
CA_KEY="$PRIVATE/control-ca.key"
CA_PEM="$PRIVATE/control-ca.pem"

umask 077
ensure_dir "$CONFIG" 0750
ensure_dir "$STATE" 0750
# As root the two directories the effect gate trusts are settled before anything is made or inspected in them: from then on the worker
# account (which may own whatever an older host left behind) can no longer swap an entry between a check and the chown after it.
if [[ "$(id -u)" == 0 ]]; then
  trusted_parent "$CONFIG"; trusted_parent "$STATE"
  settle "$CONFIG" d 0750 root "$WORKER_GROUP"
  settle "$STATE" d 3770 root "$WORKER_GROUP"
fi
ensure_readable_dir "$REGISTRY"
ensure_dir "$PRIVATE" 0750
ensure_ai_dir "$AI_PLATFORM"
# The work directory (keys, requests, staged content) is root's own, outside every directory the worker owns: nothing in it can be swapped
# for a link, and only a finished file is copied into the worker's directories (place).
WORK="$(mktemp -d "${TMPDIR:-/tmp}/liwan-init.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# ensure_config_file <path> <content>: created (root-owned when run as root) or kept. As root a kept file must be root-owned and closed to
# group and other: one that is not (an older host, where the worker owned it) is never blessed as it stands. Its content is only
# compared with what this script writes; equal, a fresh root-owned copy replaces it (a new inode, so a descriptor the worker still holds
# writes nowhere); different, the script stops for review.
ensure_config_file() {
  local file="$1" content="$2" tmp
  if [[ ! -e "$file" && ! -L "$file" ]]; then
    printf '%s\n' "$content" | write_file "$file" 0640 "$([[ "$(id -u)" == 0 ]] && echo root)"
    return
  fi
  if [[ "$(id -u)" == 0 ]]; then
    plain "$file" f
    if ! root_safe "$file"; then
      [[ "$(cat "$file")" == "$content" ]] || die "Refusing: $file is not owned by root or is writable by group or other, and its content is not what this script writes. Review it (it names what the effect account runs as root), then fix its owner and mode, or remove it so it is made again"
      tmp="$(mktemp "$CONFIG/.init.XXXXXX")"
      printf '%s\n' "$content" > "$tmp"
      chown -h "root:$WORKER_GROUP" "$tmp"
      chmod 0640 "$tmp"
      mv -f "$tmp" "$file"
      printf 'replaced %s (it was not root-owned, or was writable by group or other)\n' "$file"
      return
    fi
    settle "$file" f 0640 root "$WORKER_GROUP"
  fi
  printf 'kept    %s\n' "$file"
}

ensure_config_file "$CONFIG/shared-runtime.json" "$(printf '{"schemaVersion":1,"projectName":"%s","composeFile":"%s","envFile":"%s","stateDir":"%s","domainSuffix":"%s"}' \
  "$PROJECT" "$COMPOSE_FILE" "$SHARED_ENV_FILE" "$STATE" "$DOMAIN_SUFFIX")"
ensure_config_file "$CONFIG/inventory-v2.json" '{"version":2,"targets":{}}'

if ! exists_all "$REGISTRY/registry.json"; then
  printf '{"schemaVersion":1,"snapshotRevision":0,"targets":[]}\n' | write_file "$REGISTRY/registry.json" 0644
else printf 'kept    %s\n' "$REGISTRY/registry.json"; fi

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

# The effect boundary (root only): what the effect gate trusts and what the effect account owns. Applied on every run, so a host
# initialised before the boundary converges; the effect subdirectories are created when absent and otherwise only checked.
if [[ "$(id -u)" == 0 ]]; then
  EFFECT_UID="$(id -u "$EFFECT")"
  for entry in reservations:0700 credentials:0700 classifications:0755 restore-effects:0700 reconfigure:0700 runtime-gate-history:0700 tenant-storage:0700 backups:0750; do
    directory="$STATE/${entry%%:*}"
    if [[ -e "$directory" || -L "$directory" ]]; then
      plain "$directory" d
      [[ "$(owner_of "$directory")" == "$EFFECT_UID" ]] && (( (8#$(mode_of "$directory") & 022) == 0 )) \
        || die "Refusing: $directory must be owned by $EFFECT and not writable by group or other. A less trusted account may have written in it: review its content, then chown $EFFECT:$WORKER_GROUP and chmod ${entry##*:} it"
      printf 'kept    %s\n' "$directory"
      continue
    fi
    (umask 022; mkdir "$directory")
    settle "$directory" d "${entry##*:}" "$EFFECT" "$WORKER_GROUP"
    printf 'created %s\n' "$directory"
  done
  # restore-registry is bind-mounted read-only into the guard and restore-odoo containers, and the worker publishes files in it. The
  # worker must not own the directory: in the sticky state directory the owner of an entry may rename or remove it, so a worker-owned
  # one could be replaced by a link that dockerd follows to a host directory of the worker's choosing. It belongs to the effect
  # account instead (0775, group worker: the worker creates files in it, cannot replace the directory; the containers read it as others).
  directory="$STATE/restore-registry"
  if [[ -e "$directory" || -L "$directory" ]]; then
    plain "$directory" d
    [[ "$(owner_of "$directory")" == "$EFFECT_UID" ]] && (( (8#$(mode_of "$directory") & 002) == 0 )) \
      || die "Refusing: $directory must be owned by $EFFECT and not writable by other (a worker-owned one can be swapped for a link). Review its content, then chown $EFFECT:$WORKER_GROUP and chmod 0775 it"
    printf 'kept    %s\n' "$directory"
  else
    (umask 022; mkdir "$directory")
    settle "$directory" d 0775 "$EFFECT" "$WORKER_GROUP"
    printf 'created %s\n' "$directory"
  fi
  if [[ -e "$SHARED_ENV_FILE" || -L "$SHARED_ENV_FILE" ]]; then
    plain "$SHARED_ENV_FILE" f
    trusted_parent "$SHARED_ENV_FILE"
    root_safe "$SHARED_ENV_FILE" || die "Refusing: $SHARED_ENV_FILE is not owned by root or is writable by group or other. Review its content, then chown root:$DOCKER_GROUP and chmod 0640 it"
    settle "$SHARED_ENV_FILE" f 0640 root "$DOCKER_GROUP"
    printf 'settled %s\n' "$SHARED_ENV_FILE"
  else printf 'skipped %s (not there yet; it must end up root:%s 0640)\n' "$SHARED_ENV_FILE" "$DOCKER_GROUP"; fi
  if [[ -e "$DOCKER_CONFIG_DIR" || -L "$DOCKER_CONFIG_DIR" ]]; then
    plain "$DOCKER_CONFIG_DIR" d
    root_safe "$DOCKER_CONFIG_DIR" || die "Refusing: $DOCKER_CONFIG_DIR must be owned by root and not writable by group or other (the docker client reads its plugins and credential helpers from it)"
  else
    (umask 022; mkdir -p "$DOCKER_CONFIG_DIR")
    trusted_parent "$DOCKER_CONFIG_DIR"
    settle "$DOCKER_CONFIG_DIR" d 0755 root root
  fi
  if [[ -e "$DOCKER_CONFIG_DIR/config.json" || -L "$DOCKER_CONFIG_DIR/config.json" ]]; then
    plain "$DOCKER_CONFIG_DIR/config.json" f
    root_safe "$DOCKER_CONFIG_DIR/config.json" || die "Refusing: $DOCKER_CONFIG_DIR/config.json is not owned by root or is writable by group or other; it can name a program the docker client runs. Review it, then fix its owner and mode"
    printf 'kept    %s\n' "$DOCKER_CONFIG_DIR/config.json"
  else
    printf '{}\n' > "$DOCKER_CONFIG_DIR/config.json"
    settle "$DOCKER_CONFIG_DIR/config.json" f 0644 root root
    printf 'created %s\n' "$DOCKER_CONFIG_DIR/config.json"
  fi
fi
