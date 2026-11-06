#!/bin/sh
# Applies a change of the tenant host files (AI_TENANT_EGRESS_DIR) to the running squid, without restarting it.
#   sh watch-tenant-hosts.sh <squid.conf> [fingerprint of the files the live configuration was rendered from]
#   sh watch-tenant-hosts.sh --fingerprint
# Every AI_EGRESS_WATCH_SECONDS (default 5) the files are fingerprinted; on a change the configuration is rendered again
# next to the live one, checked by squid itself, and only then put in place and loaded with SIGHUP (`squid -k reconfigure`
# refuses a squid that is the container's PID 1). A configuration that does not render or parse is logged and the running
# one stays, so a bad file never stops the proxy. The entrypoint takes the fingerprint before it renders and passes it
# here, so a file written in between is applied by the first pass; an empty one makes the first pass apply unconditionally.
set -u

dir="${AI_TENANT_EGRESS_DIR:-}"
here="$(dirname "$0")"

fingerprint() {
  cat "$dir"/*.hosts 2>/dev/null | cksum
}

if [ "${1:-}" = --fingerprint ]; then
  fingerprint
  exit 0
fi

conf="${1:?usage: watch-tenant-hosts.sh <squid.conf> [fingerprint]}"
interval="${AI_EGRESS_WATCH_SECONDS:-5}"
[ -n "$dir" ] || exit 0
seen="${2-$(fingerprint)}"

while sleep "$interval"; do
  now="$(fingerprint)"
  [ "$now" != "$seen" ] || continue
  seen="$now"
  candidate="$conf.next"
  if ! { sh "$here/render.sh" "$candidate" && squid -k parse -f "$candidate" >/dev/null 2>&1; }; then
    rm -f "$candidate"
    echo "ai-egress: tenant hosts changed but the new configuration is not valid; the running one is kept" >&2
    continue
  fi
  # pid_filename of render.sh
  if mv "$candidate" "$conf" && kill -HUP "$(cat /run/squid/squid.pid)"; then
    echo "ai-egress: tenant hosts applied" >&2
  else
    echo "ai-egress: tenant hosts changed but squid could not be reloaded" >&2
  fi
done
