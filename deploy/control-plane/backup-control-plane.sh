#!/usr/bin/env bash
# Scheduled backup of the control plane database through deploy/backup_pipeline.py.
#   backup-control-plane.sh hourly|daily   capture, then prune
#   backup-control-plane.sh check          alert when the newest backup is older than the RPO
# Every failure raises the existing backup_failed / backup_stale alert labelled "control-plane".
# Configuration is the environment in deploy/control-plane/env.example (LIWAN_CONTROL_BACKUP_*
# and the LIWAN_BACKUP_* bucket variables); credentials never appear in an argument.
set -euo pipefail

mode="${1:-}"
case "$mode" in hourly | daily | check) ;; *) echo "usage: $0 hourly|daily|check" >&2; exit 2 ;; esac
cd "$(dirname "$0")/../.."

store=()
if [ -n "${LIWAN_CONTROL_BACKUP_STORE_ROOT:-}" ]; then store=(--store-root "$LIWAN_CONTROL_BACKUP_STORE_ROOT"); fi
connection=()
if [ -n "${LIWAN_CONTROL_BACKUP_PG_HOST:-}" ]; then connection+=(--pg-host "$LIWAN_CONTROL_BACKUP_PG_HOST"); fi
if [ -n "${LIWAN_CONTROL_BACKUP_PG_PORT:-}" ]; then connection+=(--pg-port "$LIWAN_CONTROL_BACKUP_PG_PORT"); fi
if [ -n "${LIWAN_CONTROL_BACKUP_PG_USER:-}" ]; then connection+=(--pg-user "$LIWAN_CONTROL_BACKUP_PG_USER"); fi

alert() { python3 -B deploy/alerts.py "$@" || echo "backup-control-plane: the alert was not delivered" >&2; }
fail() { alert backup_failed --database control-plane --reason "$1"; echo "backup-control-plane: $1" >&2; exit 1; }
pipeline() { python3 -B deploy/backup_pipeline.py "$@"; }

if [ "$mode" = check ]; then
  rc=0
  report="$(pipeline age --control-plane ${store[@]+"${store[@]}"})" || rc=$?
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 3 ]; then fail "age check could not run (exit $rc)"; fi
  if [ "$rc" -eq 3 ]; then
    age="$(printf '%s' "$report" | python3 -c 'import json,sys; v=json.load(sys.stdin)["age_seconds"]; print("" if v is None else int(v))')"
    if [ -z "$age" ]; then fail "no complete control plane backup exists"; fi
    alert backup_stale --database control-plane --age-seconds "$age"
    exit 1
  fi
  exit 0
fi

: "${LIWAN_CONTROL_BACKUP_DB_NAME:?}" "${LIWAN_CONTROL_BACKUP_PG_DUMP:?}"
: "${LIWAN_CONTROL_BACKUP_WORK_ROOT:?}" "${LIWAN_BACKUP_PASSPHRASE_FILE:?}"
pipeline capture --control-plane --kind "$mode" --db-name "$LIWAN_CONTROL_BACKUP_DB_NAME" \
  --work-root "$LIWAN_CONTROL_BACKUP_WORK_ROOT" --pg-dump "$LIWAN_CONTROL_BACKUP_PG_DUMP" \
  ${connection[@]+"${connection[@]}"} ${store[@]+"${store[@]}"} > /dev/null || fail "$mode capture failed"
pipeline prune --control-plane ${store[@]+"${store[@]}"} > /dev/null || fail "retention prune failed"
