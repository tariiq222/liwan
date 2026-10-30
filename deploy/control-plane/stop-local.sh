#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
HOME_DIR="${LIWAN_CONTROL_HOME:-$HOME/.local/share/liwan-saas-control-local}"
ROOT="${LIWAN_REPOSITORY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
"$ROOT/deploy/control-plane/local-process.sh" stop runtime
