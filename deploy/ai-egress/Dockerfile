# deploy/ai-egress/Dockerfile — build context: deploy/ai-egress
# The one outbound path of the `ai` container: Squid from the distribution package, configured at every start by
# render.sh from AI_EGRESS_HOSTS. The base is the repository's pinned Debian bookworm image (the same digest the
# Odoo image builds on), so no floating tag enters the build. Debian's `proxy` user (uid/gid 13) owns the tmpfs
# runtime directories, so the container runs without root and without a single capability.
FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
RUN apt-get update \
    && apt-get install -y --no-install-recommends squid \
    && rm -rf /var/lib/apt/lists/* \
    # The compose file grants these tmpfs directories to 13:13; fail the build, not the start, if that changes.
    && test "$(id -u proxy)" = 13 && test "$(id -g proxy)" = 13 \
    && mkdir -p /run/squid /var/spool/squid /var/log/squid \
    && chown -R proxy:proxy /run/squid /var/spool/squid /var/log/squid \
    && chmod 0750 /run/squid /var/spool/squid /var/log/squid
COPY --chown=proxy:proxy render.sh /usr/local/bin/render-egress-config
RUN chmod 0755 /usr/local/bin/render-egress-config
USER proxy
EXPOSE 3128
# render.sh validates the whole allowlist before it replaces the configuration, then squid replaces the shell in
# the foreground: it is the container's one process and receives the stop signal directly.
ENTRYPOINT ["/bin/sh", "-c", "set -e; /usr/local/bin/render-egress-config /run/squid/squid.conf; exec squid -N -f /run/squid/squid.conf"]
