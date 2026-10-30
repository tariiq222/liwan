#!/usr/bin/env bash
# CI stage: install the previous release, upgrade to this commit, and run the post-upgrade smoke.
# Needs the release tags (the workflow checks out the full history).
set -euo pipefail
cd "$(dirname "$0")/../.."
# Pinned OCA repositories (deploy/oca-addons.json), fetched by the setup action; appended after the LiwanOS addons.
OCA_PATH="$(python3 -B tools/oca_addons.py path --check)"
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${ODOO_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}"
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
BASE_TAG="$(python3 -B tools/upgrade_baseline.py)"
test -n "$BASE_TAG" || { echo "no LiwanOS-namespace release baseline; fresh-install gate remains binding"; exit 0; }
SCRATCH_DB="liwan_ci_upgrade_scratch"
SCRATCH_ROOT="$(mktemp -d)"
mkdir -p "$SCRATCH_ROOT/data" "$SCRATCH_ROOT/logs"
cleanup() { dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" 2>/dev/null || true; rm -rf "$SCRATCH_ROOT"; }
trap cleanup EXIT
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$SCRATCH_DB" || true
ODOO_DB_ARGS=(--db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER")
mkdir "$SCRATCH_ROOT/baseline"
git archive "$BASE_TAG" | tar -x -C "$SCRATCH_ROOT/baseline"
BASE_ODOO_ROOT="$ODOO_ROOT"
BASE_ODOO_COMMIT="$(cat "$SCRATCH_ROOT/baseline/deploy/odoo/ODOO_COMMIT")"
if [ "$BASE_ODOO_COMMIT" != "$(cat deploy/odoo/ODOO_COMMIT)" ]; then
  mkdir "$SCRATCH_ROOT/old-odoo"
  # The CI checkout of Odoo is shallow and holds only the current pin.
  git -C "$ODOO_ROOT" cat-file -e "$BASE_ODOO_COMMIT^{commit}" 2>/dev/null \
    || git -C "$ODOO_ROOT" fetch -q --depth 1 https://github.com/odoo/odoo.git "$BASE_ODOO_COMMIT"
  git -C "$ODOO_ROOT" archive "$BASE_ODOO_COMMIT" | tar -x -C "$SCRATCH_ROOT/old-odoo"
  BASE_ODOO_ROOT="$SCRATCH_ROOT/old-odoo"
fi
# Install the previous release. Releases from 19.0.1.0.1 depend on the pinned OCA addons (dms, ...) and
# refuse to install without a commercial classification, so the baseline gets the same OCA path as the
# upgrade and its own explicit fixture; it never inherits one from the environment.
if [ -n "${LIWAN_COMMERCIAL_CONFIG:-}" ]; then
  echo "previous release must not inherit a commercial classification" >&2
  exit 1
fi
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode saas --output "$SCRATCH_ROOT/baseline-classification.json"
LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/baseline-classification.json" "$ODOO_PYTHON" "$BASE_ODOO_ROOT/odoo-bin" "${ODOO_DB_ARGS[@]}" \
  --addons-path="$BASE_ODOO_ROOT/odoo/addons,$BASE_ODOO_ROOT/addons,$SCRATCH_ROOT/baseline/odoo-addons,$OCA_PATH" \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/odoo.log" \
  -d "$SCRATCH_DB" -i "$MODULES" --without-demo=all --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 --stop-after-init
# Upgrade to this commit. -i installs the addons the previous release did
# not have (liwan_meetings, liwan_meetings_pmo); Odoo skips the installed ones.
python3 deploy/classification.py fixture --database "$SCRATCH_DB" --mode saas --output "$SCRATCH_ROOT/upgrade-classification.json"
export LIWAN_COMMERCIAL_CONFIG="$SCRATCH_ROOT/upgrade-classification.json"
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" "${ODOO_DB_ARGS[@]}" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons,$OCA_PATH" \
  --data-dir="$SCRATCH_ROOT/data" --logfile="$SCRATCH_ROOT/logs/upgrade.log" \
  -d "$SCRATCH_DB" -u "$MODULES" -i "$MODULES" --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 --stop-after-init 2>&1 | tee "$SCRATCH_ROOT/upgrade-output.log"
python3 -B tools/upgrade_log_guard.py "$SCRATCH_ROOT/logs/upgrade.log"
# Post-upgrade smoke
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" shell "${ODOO_DB_ARGS[@]}" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons,$OCA_PATH" \
  -d "$SCRATCH_DB" --http-port="$ODOO_PORT" --no-http < deploy/odoo/upgrade_smoke.py | tee "$SCRATCH_ROOT/smoke.log"
grep -q UPGRADE_SMOKE_OK "$SCRATCH_ROOT/smoke.log"
