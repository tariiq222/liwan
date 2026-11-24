#!/usr/bin/env bash
# Teardown for shared acceptance live harness.
# Uses ONLY the state file written by up.sh. No prune, no image removal, and it
# never touches another project's containers, networks or volumes: every docker
# command is scoped with `-p "$PROJECT_NAME"`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOOL_DIR="$REPO_ROOT/tools/shared_acceptance_live"
STATE_FILE="$TOOL_DIR/.state"

if [ ! -f "$STATE_FILE" ]; then
  echo "No state file found. Nothing to tear down."
  exit 0
fi

# Source the KEY=VALUE state file (no secrets in it).
# shellcheck disable=SC1090
source "$STATE_FILE"

if [ -z "${PROJECT_NAME:-}" ] || [ -z "${TMPDIR_BASE:-}" ] || [ -z "${RUN_DIR:-}" ]; then
  echo "State file incomplete (missing PROJECT_NAME, TMPDIR_BASE or RUN_DIR)." >&2
  exit 1
fi

echo "Tearing down project: $PROJECT_NAME"

# The run directory holds the rendered stack and the harness values `docker compose down` interpolates, so teardown
# needs nothing from the operator's shell. Without a rendered stack (up.sh failed before rendering) nothing was started.
if [ -f "$RUN_DIR/compose.yml" ]; then
  COMPOSE=()
  while IFS= read -r -d '' part; do COMPOSE+=("$part"); done \
    < <(python3 -B "$TOOL_DIR/stack_render.py" command "$RUN_DIR" "$PROJECT_NAME")
  "${COMPOSE[@]}" down -v --remove-orphans
fi

echo "Removing temp dir: $TMPDIR_BASE"
rm -rf "$TMPDIR_BASE"

echo "Removing state file: $STATE_FILE"
rm -f "$STATE_FILE"

echo "Done."
