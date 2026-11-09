#!/usr/bin/env bash
# Foreground entrypoint for the Docker-capable shared control-plane worker.
set -euo pipefail

if [[ "$#" != 0 || "${LIWAN_TENANCY_MODE:-}" != shared ]]; then
  printf 'Run with LIWAN_TENANCY_MODE=shared and no arguments.\n' >&2
  exit 2
fi
: "${LIWAN_SHARED_RUNTIME_CONFIG:?Set the shared runtime config path}"
: "${LIWAN_TENANT_REGISTRY_PATH:?Set the tenant registry path}"

cd -- "$(dirname -- "$0")/../.."
exec node --import tsx apps/control-plane/src/shared-worker-main.ts
