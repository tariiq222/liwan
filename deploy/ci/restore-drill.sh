#!/usr/bin/env bash
# CI stage: back up a scratch release database, restore it, boot Odoo on it, and prove a missing attachment is caught.
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${ODOO_ROOT:?}" "${ODOO_PYTHON:?}" "${ODOO_PORT:?}" "${PGHOST:?}" "${PGPORT:?}" "${PGUSER:?}" "${PGPASSWORD?}"
W="$(mktemp -d)"
mkdir -p "$W/data" "$W/restored" "$W/logs"
SRC_DB="webvue_drill_src_scratch"
RST_DB="webvue_drill_restored_scratch"
RST2_DB="webvue_drill_restored2_scratch"
MODULES="$(python3 -B tools/catalog_check.py --release-modules)"
cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  for db in "$SRC_DB" "$RST_DB" "$RST2_DB"; do dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$db" 2>/dev/null || true; done
  rm -rf "$W"
}
trap cleanup EXIT
for db in "$SRC_DB" "$RST_DB" "$RST2_DB"; do dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$db" || true; done
B="$(dirname "$(readlink -f "$(command -v pg_dump)")")"
export WEBVUE_COMMERCIAL_CONFIG="$W/restore-classification.json"
python3 deploy/classification.py fixture --database "$SRC_DB" --mode non_saas --output "$WEBVUE_COMMERCIAL_CONFIG"
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons" --data-dir="$W/data" \
  -d "$SRC_DB" -i "$MODULES" \
  --without-demo=all --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 --stop-after-init
python3 deploy/backup.py --opt-in MANUAL_BACKUP_OPT_IN --acknowledge-unverified CANDIDATE_BACKUP_UNVERIFIED \
  --db-name "$SRC_DB" --filestore "$W/data/filestore/$SRC_DB" \
  --output-dir "$W/backup" --pg-dump "$B/pg_dump" --pg-host "$PGHOST" --pg-port "$PGPORT" --pg-user "$PGUSER"
cp "$W/backup/manifest.json" "$W/original-manifest.json"
verify() { python3 deploy/restore_verify.py --backup-dir "$W/backup" --target-db "$1" \
  --target-filestore "$W/restored/filestore/$1" --pg-restore "$B/pg_restore" --createdb "$B/createdb" \
  --psql "$B/psql" --pg-host "$PGHOST" --pg-port "$PGPORT" --pg-user "$PGUSER"; }
verify "$RST_DB"
# Classified restored databases must start without a mapping or billing service.
unset WEBVUE_COMMERCIAL_CONFIG
"$ODOO_PYTHON" "$ODOO_ROOT/odoo-bin" --db_host="$PGHOST" --db_port="$PGPORT" --db_user="$PGUSER" \
  --addons-path="$ODOO_ROOT/odoo/addons,$ODOO_ROOT/addons,$PWD/odoo-addons" --data-dir="$W/restored" \
  -d "$RST_DB" --http-port="$ODOO_PORT" --workers=0 --max-cron-threads=0 > "$W/restored-odoo.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  kill -0 "$SERVER_PID"
  if curl -fsS "http://127.0.0.1:$ODOO_PORT/web/health" >/dev/null; then break; fi
  sleep 1
done
curl -fsS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$ODOO_PORT/web/health"
kill "$SERVER_PID"; wait "$SERVER_PID" || true; SERVER_PID=
missing="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$RST_DB" -At -v ON_ERROR_STOP=1 -c 'SELECT store_fname FROM ir_attachment WHERE store_fname IS NOT NULL ORDER BY store_fname LIMIT 1')"
test -n "$missing"
rm "$W/backup/filestore/$missing"
if verify "$RST2_DB"; then echo "negative case passed unexpectedly"; exit 1; fi
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); assert r["restore_verified"] is False; assert sys.argv[2] in r["checks"]["missing_attachment_files"]' "$W/backup/restore-verification.json" "$missing"
cmp "$W/original-manifest.json" "$W/backup/manifest.json"
