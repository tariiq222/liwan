# T19 fixed-upstream transport

Shared API, login, TOTP, logout and vendor actor `/me` now use Node HTTP/HTTPS,
not fetch. Dedicated branches retain previous fetch/proxy semantics. Socket
address comes only from server runtime odooUrl; Host/token/revision come from
fresh tenantRequest validation. No redirects are followed; 3xx except304 reject.
No guard trust contract changed, no upstream authority registered as a tenant.

Request headers are allowlisted; response hop-by-hop headers are removed including
Connection-nominated headers. Multi Set-Cookie is preserved with Headers.append.
Status, binary bytes and HEAD/204/205/304 null bodies are preserved. Total outbound
deadline15s, request16MiB, response32MiB. Bounded buffering is intentional, not an
unbounded streaming implementation: larger exports fail; memory scales with active
requests so ingress concurrency/rate limits remain important. Request upload has
15s deadline; client abort/response disconnect destroys upstream; no secret logs.
Shared logout now requires successful upstream status and no JSON-RPC error before
returning success; dedicated's existing best-effort logout is unchanged.

Fresh test uses strict actual receiving socket127.0.0.1 port0 with synthetic registry
and credentials. Every application call asserts Host/token/revision; no native fetch
controls contaminate that list. Binary fixture bytes, repeated cookies, HEAD/status,
redirect refusal, arbitrary paths and missing/foreign bindings tested. Mock destroy
endpoint records receipt, not real Odoo revocation. Finally closes listener/sockets.

Independent rebuilt Nitro verification still REQUIRED: real API/branding/login SSR,
authenticated useApi SSR, login/MFA/logout handlers through guard and remote logout
effects, HTML/payload/client secret scans and mode gates. This task proves Node wire
transport with synthetic upstream, not final built SSR, real Odoo/auth/session effects,
TLS/network or stage readiness. Real Odoo/Docker/database tests NOT RUN.
