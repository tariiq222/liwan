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
| `liwan_auth` | `/api/auth/*`, `/api/v1/auth/*`, `/web/session/*` except `get_session_info`, `/web/login` and `/web/login/*` | 20 total | credential attempts across Nuxt and Odoo |
| `liwan_provider_hook` | `/api/v1/inbox/hooks/*` (Meta and TikTok deliveries) | 1200 | a provider's burst after an outage must not be refused with 429 |
| `liwan_api` | other `/api/v1/*` except `/api/v1/public/appointments/*` and `/api/v1/inbox/hooks/*` | 300 | authenticated product API |
| `liwan_public_appointments_ip` | `/api/v1/public/appointments/*` | 60 | an invited requester's token routes (no session) |
| `liwan_odoo` | other Odoo paths except `/web/health`, including `/web/session/get_session_info` | 600 | Odoo web client, assets, reports |
| `liwan_web` | Nuxt responses | 600 | customer UI |

The shared edge (`deploy/shared/Caddyfile`) declares the same `liwan_provider_hook` zone on `{client_ip}` over its
guarded sites; a delivery the TikTok relay forwards reaches Odoo through a tenant host like any other hook.

`/websocket*` is not counted. `/web/health` is exempt so a probe cannot consume
a customer's interactive budget. These are abuse boundaries, not billing quotas.

### Vendor console host

The vendor console has its own host (`ADMIN_DOMAIN`), its own edge block (`deploy/vendor-admin/Caddyfile.snippet`)
and its own budgets, keyed on `{client_ip}` because that host is served by the shared edge behind an outer edge:

| Zone | Paths | Events / minute | Why |
| --- | --- | --- | --- |
| `liwan_admin` | everything the console serves | 600 | documents, API answers and the console's build assets; the customer UI's own `liwan_web` zone allows the same 600 for the same traffic |
| `liwan_admin_auth` | `/api/auth/*`, `/api/vendor/v1/admin/auth/*` | 20 | credential attempts, as on the customer edge |

A request is counted in every zone whose matcher accepts it, so a sign-in draws from both budgets; the 20 is the
tighter one and is what refuses a credential flood. A measured cold sign-in took 121 requests: 89 for the sign-in
page (84 build files, most of them prefetch hints for other pages) and 32 for the first page after it, 22 of them
files fetched seconds earlier that the browser could not keep. The 121st was refused at 120. Storing the assets
removes those re-downloads; the sign-in page itself still needs 89, and 600 leaves a margin for a second tab.

The console's build assets are the only responses its edge lets a browser store (`private, max-age=31536000,
immutable` for `/_nuxt/*` except `/_nuxt/builds/*`): their names carry the content hash and change with every
release, and the document that names them stays `no-store`. Everything else the console serves is `no-store`.

## Authentication client identity

The dedicated edge overwrites `X-Liwan-Client-IP`, `X-Liwan-Client-Host` and
`X-Liwan-Client-Proto` on its Nuxt hop after removing Connection-nominated
headers. The dedicated Compose web service sets
`NUXT_AUTH_PROXY_CLIENT_IP_HEADER=x-liwan-client-ip`. Login and TOTP validate
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

An additional proxy in front of the dedicated edge requires a separately reviewed
trust configuration; otherwise its socket address becomes the common budget key.
Clients behind the same NAT also legitimately share one IP budget. The shared edge
has that configuration, below.

## Shared edge behind an outer edge

`deploy/shared/Caddyfile` keys every zone on `{client_ip}`. Caddy computes it from the global `servers` block:

| Setting | Value | Effect |
| --- | --- | --- |
| `trusted_proxies static` | `LIWAN_TRUSTED_PROXIES` | The peers whose `X-Forwarded-For` is believed. Default `192.0.2.1/32` (TEST-NET-1, reserved, never a real peer): trusts nothing, so `{client_ip}` is the socket peer and no header changes it. |
| `trusted_proxies_strict` | on | The header is read right to left and trusted hops are skipped, so the first address that is not a trusted proxy is the client. Without it Caddy takes the leftmost value, which the client chooses. |
| `client_ip_headers` | `X-Forwarded-For` | The only header consulted. `Forwarded` and `X-Real-IP` are ignored. |

Staging sits behind the Openship edge on its own host, which terminates TLS and forwards over HTTP to `127.0.0.1:18080`. That edge
appends the address it saw to the header (`$proxy_add_x_forwarded_for`), so a client that sends its own value arrives as
`<claimed>, <real>`. A connection to a port published on loopback reaches the container from the gateway of the
network it is on, not from `127.0.0.1`; the `edge` network has a pinned subnet (`172.29.50.0/24`, gateway
`172.29.50.1`) so `LIWAN_TRUSTED_PROXIES=172.29.50.1/32` names exactly the host's edge. Any other peer is not trusted, and
its header is ignored.

The condition behind this: any process on the host that can open `127.0.0.1:18080` (or the container's address) arrives
as that gateway and could send a forged `X-Forwarded-For`. On those hosts only root and the administrative user can; the
runner users (uids 1001 and 1002) are blocked by the nft table `inet liwan_runner_guard`, which drops loopback and
`172.16.0.0/12` for them, and no container other than the Openship edge uses the host network. Check both on
bring-up (runbook row A8.4b) and again whenever a runner, a host-network container or a host service is added. A connection from a container on another network is not on this path.

What follows from it:

- Direct traffic (production today, a local acceptance stack) sets nothing and behaves as before.
- The restore site matches `client_ip`, not `remote_ip`. Behind the edge the socket peer is the gateway, which a
  `remote_ip` allowlist would treat as one private client; `client_ip` matches the real one. An empty
  `LIWAN_RESTORE_ALLOW` still answers 404 for every restore host. Restore is disabled on staging: it leaves the
  allowlist empty, so the restore site answers 404 to everyone. Its address and the TikTok relay's carry
  `LIWAN_SITE_SCHEME=http://` there, so they sit on :80 with the tenant sites and the 404 is really served; without the
  prefix they would sit on :443, which the edge never reaches.
- Caddy still deletes `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto` and `Forwarded` on the hop to the guard
  and passes the client only through `X-Liwan-Client-Ip` and `X-Liwan-Signup-Client` on the routes that need it.
- If Cloudflare proxying is ever turned on in front of the edge, the edge rewrites the peer from `CF-Connecting-IP` for
  Cloudflare addresses only; the chain stays safe.
- Odoo behind the guard still sees the guard's address (`proxy_mode=False`), as before.

`deploy/test_edge_rate_limit.py` runs the real Caddy in a container for these cases: the default trusts nothing; a
client-sent `X-Forwarded-For` (one or several values, with and without trusted hops) never changes `{client_ip}`
behind a trusted edge; and the restore route stays closed (404) for a client outside the allowlist, for a claimed
allowlisted address, for `private_ranges` through the gateway and for an empty list.

## Failure behavior

A rejected request gets HTTP 429 and `Retry-After` from the rate-limit module.
The limit runs before `reverse_proxy`, so rejected traffic does not reach Odoo
or Nuxt.

## Verification

Before using the template, build and validate the pinned module image:

```sh
docker build -f deploy/proxy/Dockerfile -t liwan-caddy:check .
docker run --rm liwan-caddy:check list-modules | grep http.handlers.rate_limit
docker run --rm -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -e DOMAIN=example.test liwan-caddy:check validate --config /etc/caddy/Caddyfile
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
