# deploy/proxy/Dockerfile — build context: repository root
# Official Caddy does not ship rate_limit. This image overlays one xcaddy
# build, with github.com/mholt/caddy-ratelimit, onto the official runtime.
ARG CADDY_VERSION=2.11.7
ARG XCADDY_VERSION=0.4.7
ARG RATELIMIT_MODULE=github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:${CADDY_VERSION}-builder@sha256:bf6a7d38add2508b7d2e3e3f40cf2af399214f143c0fa3daa51f254e01f8d293 AS build
ARG XCADDY_VERSION
ARG RATELIMIT_MODULE
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v${XCADDY_VERSION} \
    && xcaddy build \
      --with "${RATELIMIT_MODULE}"

FROM caddy:${CADDY_VERSION}@sha256:5e5286cb37d44086d651a5363f05f43a692ce4d649d88fb1bd844579f45fa9e8
# The Alpine base of the official image lags security releases: take the fixed Brotli library.
RUN apk upgrade --no-cache brotli-libs
COPY --from=build /usr/bin/caddy /usr/bin/caddy
# Caddy runs as a non-root user that may bind ports 80/443 only through the NET_BIND_SERVICE file capability
# (the copied binary lost the official image's capability, so it is set again). /data and /config are the
# only writable paths; compose mounts a volume on /data and a tmpfs on /config.
RUN addgroup -S -g 10002 caddy \
    && adduser -S -u 10002 -G caddy -h /data -s /sbin/nologin caddy \
    && mkdir -p /data /config \
    && chown caddy:caddy /data /config \
    && setcap cap_net_bind_service=+ep /usr/bin/caddy \
    && caddy list-modules | grep -q 'http.handlers.rate_limit'
USER caddy
