#!/usr/bin/env bash
# CI check: the pinned Python packages of apps/ai-service (requirements-dev.txt, a superset of the image's requirements.txt)
# against the PyPI advisory database with pip-audit.
# Policy: any known vulnerability fails, unless its advisory id is listed with a reason in apps/ai-service/pip-audit-ignore.txt.
# The stage `ai-service` runs it for a change; the daily `audit` workflow runs it against main, so a new advisory against an
# unchanged set is reported there instead of failing unrelated pull requests. Needs network access to PyPI.
set -euo pipefail
cd "$(dirname "$0")/../../../apps/ai-service"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# pip-audit itself is installed from a hashed lock (requirements-audit.txt), like every other package here.
"${AUDIT_PYTHON:-python3}" -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install --quiet --disable-pip-version-check --require-hashes -r requirements-audit.txt
ignores=()
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  read -r id reason <<< "$line"
  [ -n "${reason:-}" ] || { echo "pip-audit-ignore.txt: '$id' has no reason" >&2; exit 1; }
  ignores+=(--ignore-vuln "$id")
done < pip-audit-ignore.txt
# --disable-pip: audit the pinned versions as written (hashes are required for that), without resolving anything.
"$WORK/venv/bin/pip-audit" --require-hashes --disable-pip --progress-spinner off ${ignores[@]+"${ignores[@]}"} -r requirements-dev.txt
