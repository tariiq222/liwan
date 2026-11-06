#!/bin/sh
# The ai-egress container's start: render the configuration, check it with squid, run the tenant host watcher beside
# squid, then become squid.
#   sh entrypoint.sh            (the Dockerfile's entrypoint; SQUID_CONF defaults to /run/squid/squid.conf)
# A malformed AI_EGRESS_HOSTS stops the start (render.sh fails). A configuration that squid rejects because of the
# tenant host files, which another container writes, never stops it: the proxy then starts with the static hosts alone,
# logs that, and the watcher applies the tenant hosts as soon as a valid set exists.
set -eu

here="$(dirname "$0")"
conf="${SQUID_CONF:-/run/squid/squid.conf}"

# Before the first render, so a tenant file written while it runs is seen by the watcher's first pass.
seen="$(sh "$here/watch-tenant-hosts.sh" --fingerprint)"
sh "$here/render.sh" "$conf"
if ! squid -k parse -f "$conf" >/dev/null 2>&1; then
  echo "ai-egress: the configuration with the tenant hosts is not valid; starting with the static hosts only" >&2
  AI_TENANT_EGRESS_DIR='' sh "$here/render.sh" "$conf"
  squid -k parse -f "$conf" >/dev/null || { echo "ai-egress: the static configuration is not valid" >&2; exit 1; }
fi

if [ -n "${AI_TENANT_EGRESS_DIR:-}" ]; then
  (
    while :; do
      sh "$here/watch-tenant-hosts.sh" "$conf" "$seen"
      echo "ai-egress: the tenant host watcher stopped; restarting it in 5 seconds" >&2
      seen=''
      sleep 5
    done
  ) &
fi
exec squid -N -f "$conf"
