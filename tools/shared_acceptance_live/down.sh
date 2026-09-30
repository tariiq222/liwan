#!/usr/bin/env bash
# Teardown for shared acceptance live harness.
# Uses ONLY the state file written by up.sh. No prune, no image removal, and it
# never touches another project's containers, networks or volumes: every docker
# command is scoped with `-p "$PROJECT_NAME"`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEVDIR="$REPO_ROOT/deploy"
STATE_FILE="$REPO_ROOT/tools/shared_acceptance_live/.state"

if [ ! -f "$STATE_FILE" ]; then
  echo "No state file found. Nothing to tear down."
  exit 0
fi

# Source the KEY=VALUE state file (no secrets in it).
# shellcheck disable=SC1090
source "$STATE_FILE"

if [ -z "${PROJECT_NAME:-}" ] || [ -z "${TMPDIR_BASE:-}" ]; then
  echo "State file incomplete (missing PROJECT_NAME or TMPDIR_BASE)." >&2
  exit 1
fi

# `docker compose down` still interpolates the whole file, and the shared overlay
# uses `:?` on several variables. Supply the same non-secret values up.sh used
# (and derive the temp-dir paths from TMPDIR_BASE) so teardown works even when the
# operator's shell no longer carries them — e.g. after a failed up.sh.
: "${NASQ_IMAGE_TAG:=unknown}"
: "${DOMAIN:=a.accept.nasq.test b.accept.nasq.test}"
: "${DB_NAME:=nasq_accept_a_scratch}"
: "${ODOO_COMMIT:=unknown}"
: "${NASQ_EDGE_BIND:=127.0.0.1}"
: "${NASQ_EDGE_HTTPS_PORT:=443}"
: "${NASQ_EDGE_HTTP_PORT:=80}"
: "${NASQ_TENANT_REGISTRY_DIR:=$TMPDIR_BASE/registry}"
: "${NASQ_SHARED_ODOO_CONFIG:=$TMPDIR_BASE/odoo.conf}"
: "${NASQ_COMMERCIAL_CONFIG_DIR:=$TMPDIR_BASE/commercial}"
# Dummy non-empty values: unused by `down`, but required to satisfy :? in the
# shared overlay so the file can be parsed. Never printed.
: "${NASQ_SHARED_PROXY_TOKEN:=teardown-unused}"
: "${NASQ_SESSION_KEYS:={\"k1\":\"teardownunusedteardownunusedteardown-unused\"}}"
: "${NASQ_SESSION_ACTIVE_KID:=k1}"
export NASQ_IMAGE_TAG DOMAIN DB_NAME ODOO_COMMIT NASQ_EDGE_BIND NASQ_EDGE_HTTPS_PORT \
  NASQ_EDGE_HTTP_PORT NASQ_TENANT_REGISTRY_DIR NASQ_SHARED_ODOO_CONFIG \
  NASQ_COMMERCIAL_CONFIG_DIR NASQ_SHARED_PROXY_TOKEN NASQ_SESSION_KEYS NASQ_SESSION_ACTIVE_KID

echo "Tearing down project: $PROJECT_NAME"

# Same working directory and compose files as up.sh so that volume paths and
# service definitions match exactly (see the path-base note in
# acceptance.override.yml — do NOT pass --project-directory).
(
  cd "$DEVDIR"
  docker compose \
    -f docker-compose.yml \
    -f docker-compose.shared.yml \
    -f ../tools/shared_acceptance_live/acceptance.override.yml \
    -p "$PROJECT_NAME" \
    down -v --remove-orphans
)

echo "Removing temp dir: $TMPDIR_BASE"
rm -rf "$TMPDIR_BASE"

echo "Removing state file: $STATE_FILE"
rm -f "$STATE_FILE"

echo "Done."
