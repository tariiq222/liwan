#!/usr/bin/env bash
set +x
set +v
set -euo pipefail
HOME_DIR="${WEBVUE_CONTROL_HOME:-$HOME/.local/share/webvue-saas-control-local}"
ROOT="${WEBVUE_REPOSITORY_ROOT:-$(cd "$(dirname "$0")/../.." && pwd -P)}"
"$ROOT/deploy/control-plane/local-process.sh" stop runtime
