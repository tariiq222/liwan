#!/usr/bin/env bash
# Sourced by each Woodpecker stage; the runner owns the environment and receipts.
test -n "${WEBVUE_CI_RUN_DIR:-}" && test -f "$WEBVUE_CI_RUN_DIR/environment.sh" \
  || { echo 'Run this pipeline through python3 -B tools/local_ci.py' >&2; exit 2; }
source "$WEBVUE_CI_RUN_DIR/environment.sh"
CI_STAGE_NAME="$1"
CI_STAGE_RESULT=checked
ci_finish() {
  local status="$1"
  python3 - "$WEBVUE_CI_RUN_DIR" "$CI_STAGE_NAME" "$status" "$WEBVUE_CI_RUN_ID" "$WEBVUE_CI_COMMIT" "$CI_STAGE_RESULT" <<'PY'
import json, sys
from pathlib import Path
directory, name, code, run_id, commit, result = sys.argv[1:]
path = Path(directory) / 'stages' / (name + '.json')
path.write_text(json.dumps({'name': name, 'exit_code': int(code), 'run_id': run_id,
                            'commit': commit, 'result': result}) + '\n')
PY
  exit "$status"
}
trap 'ci_finish "$?"' EXIT
