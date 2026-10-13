# Edge rate limit

The customer edge is `deploy/Caddyfile`, served by the image built from
`deploy/proxy/Dockerfile`. Official `caddy:2` does not include `rate_limit`;
the image overlays one `xcaddy` build with
[`github.com/mholt/caddy-ratelimit`](https://github.com/mholt/caddy-ratelimit)
onto the official Caddy runtime.

## Zones

The direct dedicated edge keys all zones on `{remote_host}` (the socket peer)
and uses a one-minute sliding window. It does not trust browser `Forwarded` or
`X-Forwarded-For`, nor trust every private network as an upstream proxy. IPv6
clients are grouped by `/64` so one prefix cannot evade the limit by rotating
addresses. A request matches exactly one zone.

| Zone | Paths | Events / minute | Why |
| --- | --- | --- | --- |
| `nasq_auth` | `/api/auth/*`, `/api/v1/auth/*`, `/web/session/*` except `get_session_info`, `/web/login` and `/web/login/*` | 20 total | credential attempts across Nuxt and Odoo |
| `nasq_api` | other `/api/v1/*` | 300 | authenticated product API |
| `nasq_odoo` | other Odoo paths except `/web/health`, including `/web/session/get_session_info` | 600 | vendor console, assets, reports |
| `nasq_web` | Nuxt responses | 600 | customer UI |

`/websocket*` is not counted. `/web/health` is exempt so a probe cannot consume
a customer's interactive budget. These are abuse boundaries, not billing quotas.

## Authentication client identity

The dedicated edge overwrites `X-Nasq-Client-IP`, `X-Nasq-Client-Host` and
`X-Nasq-Client-Proto` on its Nuxt hop after removing Connection-nominated
headers. The dedicated Compose web service sets
`NUXT_AUTH_PROXY_CLIENT_IP_HEADER=x-nasq-client-ip`. Login and TOTP validate
these fields and send them as the three `X-Forwarded-*` headers to Odoo.
Stock Odoo needs `proxy_mode=True` and `X-Forwarded-Host` to activate ProxyFix;
this lets its worker-local login cooldown use the real peer instead of Nuxt's IP.

Only Caddy may publish ports. Do not enable this opt-in on publicly reachable
Nuxt or trust a browser-supplied private header. Without the opt-in, direct local
Nuxt keeps its original behavior. Missing/invalid fields with the opt-in enabled
fail with 503 before contacting Odoo. Existing installations must rebuild the web
server, update the edge, and apply the Compose environment together.

The shared overlay retains its separate guarded Host/database authority and
`proxy_mode=False`; it does not consume this dedicated identity opt-in. Its
existing edge auth budget remains unchanged. This change does not claim to fix
shared Odoo's worker-local client cooldown attribution.

An additional proxy in front of this direct edge requires a separately reviewed
trust configuration; otherwise its socket address becomes the common budget key.
Clients behind the same NAT also legitimately share one IP budget.

## Failure behavior

A rejected request gets HTTP 429 and `Retry-After` from the rate-limit module.
The limit runs before `reverse_proxy`, so rejected traffic does not reach Odoo
or Nuxt.

## Verification

Before using the template, build and validate the pinned module image:

```sh
docker build -f deploy/proxy/Dockerfile -t nasq-caddy:check .
docker run --rm nasq-caddy:check list-modules | grep http.handlers.rate_limit
docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e DOMAIN=example.test nasq-caddy:check validate --config /etc/caddy/Caddyfile
```

A green local build proves the template and module. It does not prove a
customer deployment has adopted the image.

Regression commands from the repository root:

```sh
python3 -B -m unittest discover -s deploy -p 'test_auth_edge.py'
python3 -B -m unittest discover -s deploy -p 'test_edge_rate_limit.py'
npm -w apps/web run test -- server/utils/__tests__/authProxyIdentity.test.ts
```

The first command runs real Caddy inside an ephemeral container with two
loopback socket peers, spoofed/Connection-nominated headers, credential aliases,
and an exhausted aggregate budget. It publishes no host ports. The web tests
exercise actual login/TOTP handlers and observe the receiving HTTP wire.
