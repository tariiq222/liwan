# deploy/proxy/Dockerfile — build context: repository root
# Official Caddy does not ship rate_limit. This image overlays one xcaddy
# build, with github.com/mholt/caddy-ratelimit, onto the official runtime.
ARG CADDY_VERSION=2.11.7
ARG XCADDY_VERSION=0.4.7
ARG RATELIMIT_MODULE=github.com/mholt/caddy-ratelimit@v0.1.0

FROM caddy:${CADDY_VERSION}-builder AS build
ARG XCADDY_VERSION
ARG RATELIMIT_MODULE
RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@v${XCADDY_VERSION} \
    && xcaddy build \
      --with "${RATELIMIT_MODULE}"

FROM caddy:${CADDY_VERSION}
COPY --from=build /usr/bin/caddy /usr/bin/caddy
RUN caddy list-modules | grep -q 'http.handlers.rate_limit'
