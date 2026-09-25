# Package 2 edge routing and dual-tenant topology — G3/G4/G5

**Purpose:** specify a local, evidence-producing acceptance lane for the customer edge and two-tenant browser isolation. This is a design/verification document, not a deployment record. No Docker image/container or live service was changed or started for this document. The referenced `docs/verification/2026-09-23-saas-p2-design-review.md` was not present in this worktree or canonical checkout at inspection time; gate objectives below are those supplied by the coordinator.

## Executive decision

- **G3 (edge routing):** use one stock `caddy:2` instance per test tenant, with a local-only Caddyfile that has no `rate_limit` directive. Keep production `deploy/Caddyfile` rate-limited and built from `deploy/proxy/Dockerfile` with the custom module. Do not remove or weaken production rate limiting to make local validation pass.
- **G4 (two-tenant browser evidence):** map Tenant A to `http://localhost:<portA>` and Tenant B to `http://127.0.0.1:<portB>`, with two independent customer stacks/databases and two distinct published loopback ports. Distinct hostname strings separate host-only browser cookie jars; distinct ports alone do not.
- **G5 (loopback):** `localhost` resolves here to both `::1` and `127.0.0.1`. A listener/published port bound only to IPv4 loopback does not establish IPv6 reachability. Either explicitly test each address family and bind/publish both where required, or use a consistently IPv4-literal acceptance URL. Do not infer Docker Desktop IPv6 behavior from host socket behavior.
- **Status:** source/config review and host loopback socket checks completed; Caddy validation, Docker publication tests, and browser two-tenant acceptance were not run. G3/G4/G5 therefore remain unverified acceptance gates.

## 1. Current edge source and image constraint

`deploy/Caddyfile` is the production-oriented customer edge. Its `rate_limit` blocks require `http.handlers.rate_limit`; stock official `caddy:2` does not contain that module. `deploy/proxy/Dockerfile` builds Caddy 2.11.4 with `xcaddy` 0.4.7 and `github.com/mholt/caddy-ratelimit@v0.2.0`, then checks that the module is present. The production Compose template names `nasq-caddy:${NASQ_IMAGE_TAG}` and mounts `deploy/Caddyfile`.

At inspection, local Docker reported stock images `caddy:2`, `caddy:2-alpine`, and `caddy:2.10.2-alpine`; no `nasq-caddy` image appeared. The local image inventory does not prove that the exact generic `caddy:2` tag is pinned/reproducible or that a tag has the needed version. Before acceptance, record exact `docker image inspect` RepoDigests/IDs and `caddy version`. Do not pull images as part of this read-only check.

### Local-only customer Caddyfile template (stock Caddy)

Use as a separate file (suggested path `deploy/Caddyfile.local`); do not substitute this for `deploy/Caddyfile` in production. The local Caddy listener is HTTP-only inside the container; TLS is intentionally out of scope for loopback acceptance. All browser business traffic remains same-origin. Explicit `/web/content/*` matching documents and tests this path independently from generic `/web/*` routing.

```caddyfile
{
	auto_https off
}

:80 {
	@odoo path \
		/api/v1/* \
		/web/content/* \
		/web/* \
		/odoo/* \
		/website/translations \
		/base_setup/* \
		/bus/* \
		/json/* \
		/doc/* \
		*/static/* \
		/report/* \
		/mail/* \
		/discuss/*

	handle @odoo {
		reverse_proxy odoo:8069
	}

	handle /websocket* {
		reverse_proxy odoo:8072
	}

	handle {
		reverse_proxy web:3000
	}
}
```

The order is intentional: the Odoo path handler, then websocket handler, then catch-all Nuxt handler. Websocket traffic targets Odoo's evented port `8072`, not ordinary HTTP port `8069`. Caddy `reverse_proxy` supports WebSocket upgrade/upgrade-tunnel behavior. Do not insert a rate-limit directive into this stock-image file. `/api/commercial/v1` is intentionally not routed to Odoo; a matching Nuxt route/catch-all is not a grant to bypass Nuxt's validation. The local Caddyfile should be validated against the exact candidate stock image before G3 is passed.

**Routing test matrix:** for each tenant origin, request the Nuxt shell `/` and `/login`; an authenticated/authorized fixture is required for successful business API responses. Verify `/api/v1/me` reaches Odoo (401 unauthenticated is acceptable evidence of routing, 404 from Nuxt is not). Verify `/web/content/<known-safe-existing-fixture-path>` reaches Odoo and returns an Odoo-consistent response. Verify a websocket handshake to `/websocket` upgrades through Caddy to Odoo port 8072 (not merely an HTTP 200 shell response). Also exercise a representative Odoo `/web/...` route. Capture request URL, response/status/upgrade outcome, selected edge instance and upstream identity; redact cookies and credentials.

## 2. G3 topology: one edge origin per tenant

Run two independent customer stacks, each with its own Nuxt, Odoo, and customer database/filestore. Only the Caddy edge is published to the browser. Example local host port assignments:

| Tenant | Browser origin | Host-side published edge | Internal Caddy listener | Upstream names in that tenant's Compose network |
| --- | --- | --- | --- | --- |
| A | `http://localhost:18110` | `127.0.0.1:18110` → container `80` | `:80` | that stack's `web:3000`, `odoo:8069`, websocket `odoo:8072` |
| B | `http://127.0.0.1:18111` | `127.0.0.1:18111` → container `80` | `:80` | that stack's `web:3000`, `odoo:8069`, websocket `odoo:8072` |

The numeric ports are examples only; choose and record unused ports immediately before authorized test execution. The two tenant deployments must have separate Compose projects/networks; identical service names are safe only because DNS resolution is network-local. Do not publish Nuxt/Odoo/database ports directly to the host for browser checks. Keep database and synthetic account/record fixtures distinct and identifiable.

For Docker Compose, the host-side binding form is conceptually `127.0.0.1:18110:80` for A and `127.0.0.1:18111:80` for B. Bind explicitly to loopback; bare `18110:80` commonly publishes on all host interfaces and is not an acceptable local isolation default. IPv6 publication must be requested/verified separately; do not assume that an IPv4 mapping also opens `::1`.

## 3. Cookie isolation: hostname, not port

RFC 6265 §5.1.3 defines domain-match; §5.1.4 defines path-match. Cookie scope has no port component. A host-only cookie (the normal result when `Set-Cookie` omits `Domain`) is returned only to the host that set it, subject to path, secure, expiry, and other cookie rules. Therefore:

- `localhost:18110` and `localhost:18111` are different **origins** because their ports differ, but cookies are not isolated by those ports: same-name/same-path cookies for `localhost` may be sent to either port.
- `localhost:18110` and `127.0.0.1:18111` are different **hosts** and have separate host-only cookie namespaces. The `localhost` host-only session cookie is not sent to `127.0.0.1`, and vice versa.
- Do not set a shared parent `Domain` cookie for this local test. Host-only cookies are the required behavior. Do not infer isolation merely from differing ports.
- Cookie isolation is not a substitute for database/tenant isolation, authorization, CSRF controls, or independent session-signing secrets. Verify both login responses set host-only cookies (no `Domain=` attribute), different session values, and that browser requests send only the matching tenant's cookie. Never print cookie values into logs/evidence.

**Browser verification sequence (G4 prerequisite):** use one clean browser profile/context. Visit A, authenticate with A's synthetic account, and confirm A's session-only `/api/v1/me` identifies A's expected synthetic tenant marker. Visit B, authenticate separately, confirm B's marker. Then alternate A→B→A without logging out. Capture request host/port and a boolean `session_cookie_present`, never the cookie value. A must continue to resolve to A and B to B; neither browser request may authenticate as the other tenant. Repeat after direct navigation and refresh. Record browser/version, origins, cookie attributes excluding values, marker checks and timestamps. If same hostname on separate ports is used as a negative control, explicitly expect cookie sharing to be possible; do not make that the accepted topology.

## 4. G5 IPv4/IPv6 loopback findings and test matrix

Read-only host inspection on this macOS host found `localhost` resolving to both `::1` and `127.0.0.1`; a small ephemeral socket test independently bound/listened/connected successfully on both `127.0.0.1` and `::1`. This proves only host kernel loopback behavior at test time. It does not prove Caddy listener behavior, Docker port forwarding, firewall policy, browser address selection/fallback, or Docker Desktop IPv6 publishing.

- Bind `127.0.0.1:<port>`: IPv4 loopback only. An IPv4 client to `127.0.0.1` works; a client that selects `::1` cannot reach that IPv4-only listener unless it retries another address. Do not assume fallback behavior.
- Bind `[::1]:<port>`: IPv6 loopback only. IPv4 clients cannot use it. IPv6 dual-stack wildcard behavior (`[::]`) is OS/socket-option dependent and must not be conflated with explicit `::1`.
- Bind `localhost:<port>`: resolution may return both families; whether one listener accepts both depends on the server implementation and OS socket flags. Caddy/Docker publication should be tested using its actual addresses, not inferred from name resolution.
- Docker port publishing: a mapping bound to `127.0.0.1` guarantees intended IPv4 loopback scope, but not IPv6. Docker Engine and Docker Desktop networking implementations differ. On this host Docker reports a Linux/arm64 server behind the desktop client; the host `socket.bind` experiment is not evidence of Docker Desktop forwarding on `::1`.

**Required authorized G5 acceptance matrix:**

| Probe | Required observation | Pass condition |
| --- | --- | --- |
| Resolve `localhost` | Record `getaddrinfo` answers and order for `localhost` | Both `127.0.0.1` and `::1` are accounted for; test does not assume order |
| IPv4 listener/publication | Connect explicitly to `127.0.0.1:<publishedPort>` | Correct tenant edge answers; no other interface exposure |
| IPv6 listener/publication | Connect explicitly to `[::1]:<publishedPort>` | Either correct tenant edge answers via an explicitly configured IPv6 loopback mapping, or document IPv6 as unsupported and use only explicit IPv4-literal URLs in this acceptance lane |
| `localhost` browser URL | Open exact A origin in target browser | It loads reliably from the intended address family; record actual result, no silent inference from curl |
| IP-literal B browser URL | Open exact B origin | It loads only B edge and returns B marker |
| Non-loopback exposure | Inspect published bindings read-only | No wildcard/LAN bind for either test edge |

For deterministic local evidence if Docker IPv6 forwarding cannot be established, use explicit `http://127.0.0.1:<portA>` and `http://127.0.0.1:<portB>` for network reachability and separately test cookie isolation with `localhost` vs `127.0.0.1`; however, this does **not** satisfy the requested literal G4 origin mapping for Tenant A until `http://localhost:<portA>` is independently browser-verified.

## 5. Gate acceptance and remaining work

### G3 — real per-tenant edge

Pass only after a stock-Caddy local edge configuration validates with the exact image, and the live per-tenant edge serves Nuxt `/`, `/api/v1`, Odoo `/web/content`, and Odoo `/websocket` on one same-origin port. Record image digest/version, Caddy config hash, edge listeners, each route result and websocket upgrade. This document contains the local template, but no Caddy validation/live edge has been run: **G3 not yet passed**.

### G4 — browser two-tenant proof

Pass only after a browser runs both literal origins (`localhost:<portA>` and `127.0.0.1:<portB>`) against real independent edges/customer stacks, proves tenant-specific API/data markers and proves cookie non-crossing through alternating requests. No browser lane was executed: **G4 not yet passed**.

### G5 — loopback

Pass only after explicit IPv4 and IPv6 tests of the published Caddy edges and the browser URL behavior are recorded, or a deliberate unsupported-IPv6 limitation is declared and the gate owner accepts it. Host `localhost` resolution and host socket tests were observed, but Docker publication and browser behavior were not: **G5 not yet passed**.

### No-mutation boundary

No `docker build`, `docker run`, `docker compose up/down`, image pull, port publication, service restart, `/etc/hosts` edit, or production Caddy change was performed for this specification. These require a separately authorized, isolated test window. Never reuse customer data or publish edge ports on non-loopback interfaces. Keep credentials private and avoid command-line values/logging.

## Sources and evidence basis

- Repository source: `deploy/Caddyfile`, `deploy/proxy/Dockerfile`, `deploy/docker-compose.yml`, `deploy/security/edge-rate-limit.md`, and `deploy/OPERATIONS.md`.
- Host observations: Docker image listing showed tags `caddy:2`, `caddy:2-alpine`, and `caddy:2.10.2-alpine`, and no `nasq-caddy` tag; Docker server reported `linux/arm64`; `localhost` lookup returned `::1` and `127.0.0.1`; isolated host socket bind/connect passed on each loopback address. These are a point-in-time local snapshot, not a portable guarantee.
- Cookie standard: [RFC 6265 §§5.1.3–5.1.4](https://www.rfc-editor.org/rfc/rfc6265#section-5.1.3), [RFC 6265 cookie storage and retrieval model](https://www.rfc-editor.org/rfc/rfc6265#section-5.3). Ports are not a cookie-matching attribute; host/domain and path matching govern delivery. Browser-origin separation by port is a different rule than cookie scoping.
