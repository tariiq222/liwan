#!/usr/bin/env bash
# CI static checks for PRs whose diff contains only documentation.
set -euo pipefail
cd "$(dirname "$0")/../../.."
BASE_REF="${CI_BASE_REF:?}"
python3 -B tools/docs_policy.py --changed-markdown "$BASE_REF"
python3 -B tools/git_policy.py --base "$BASE_REF"
python3 -B tools/arch_policy.py --base "$BASE_REF"
python3 -B tools/secret_guard.py
python3 -B tools/forbidden_terms.py --terms tools/retired_terms.txt --exceptions tools/retired_terms_exceptions.txt \
  --allow-string /code/webvue
