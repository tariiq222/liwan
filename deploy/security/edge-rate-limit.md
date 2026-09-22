# Edge rate limit

The customer edge is `deploy/Caddyfile`, served by the image built from
`deploy/proxy/Dockerfile`. Official `caddy:2` does not include `rate_limit`;
the image overlays one `xcaddy` build with
[`github.com/mholt/caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit)
onto the official Caddy runtime.

## Zones

All zones key on `{client_ip}` and use a one-minute sliding window. IPv6
clients are grouped by `/64` so one prefix cannot evade the limit by rotating
addresses. A request matches exactly one zone.

| Zone | Paths | Events / minute | Why |
| --- | --- | --- | --- |
| `nasq_auth` | `/api/v1/auth/*`, `/web/session/*`, `/web/login` | 20 | credential and session attempts |
| `nasq_api` | other `/api/v1/*` | 300 | authenticated product API |
| `nasq_odoo` | other Odoo paths except `/web/health` | 600 | vendor console, assets, reports |
| `nasq_web` | Nuxt responses | 600 | customer UI |

`/websocket*` is not counted. `/web/health` is exempt so a probe cannot consume
a customer's interactive budget. These are abuse boundaries, not billing quotas.

## Failure behavior

A rejected request gets HTTP 429 and `Retry-After` from the rate-limit module.
The limit runs before `reverse_proxy`, so rejected traffic does not reach Odoo
or Nuxt.

## Verification

Docker was not running when this template was added, so the image was not built
here. Before using the template, run:

```sh
docker build -f deploy/proxy/Dockerfile -t nasq-caddy:check .
docker run --rm nasq-caddy:check list-modules | grep http.handlers.rate_limit
docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e DOMAIN=example.test nasq-caddy:check validate --config /etc/caddy/Caddyfile
```

A green local build proves the template and module. It does not prove a
customer deployment has adopted the image.
