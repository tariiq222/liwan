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
RUN caddy list-modules | grep -q 'http.handlers.rate_limit'
