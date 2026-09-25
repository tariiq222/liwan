#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
HOME_DIR="${NASQ_CONTROL_HOME:-$HOME/.local/share/nasq-saas-control-local}"
ROOT="${NASQ_REPOSITORY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
"$ROOT/deploy/control-plane/local-process.sh" stop runtime
