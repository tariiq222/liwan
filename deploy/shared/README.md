# Shared isolation boundary — implementation foundation, not release approval

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../../docs/project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

`guard.mjs` is a Node 24+ private HTTP/WS proxy; `start.mjs` is its opt-in entrypoint.
It imports the existing TypeScript resolver and registry utilities using Node native
TS stripping. The image must retain `apps/web/server/utils/{tenantRegistry,tenantHostResolver}.ts`
at their repository-relative paths. No runtime NPM dependency is needed by guard.
`Dockerfile` now implements this layout on `node:24.21.0-alpine`, runs as `node`,
and verifies the import graph during image build. Image build itself is NOT RUN.

## Required topology / configuration (t5 integration owner)

Public TLS edge → guard:8080 → web:3000 OR Odoo:8069 / Odoo WS:8072.
Nuxt BFF and SSR → guard:8080, NEVER directly to Odoo. Only edge publishes a port.
Guard and Odoo/web listener networks must be unreachable from customers. An internal
header secret is defense in depth, NOT a replacement for this network boundary.
`Caddyfile` includes four rate zones using the actual pinned module in
`deploy/proxy/Dockerfile` (not the unmodified official Caddy image). Limits are per
edge socket client IP: auth 20/min, API 300/min, Odoo/web 600/min. WS remains exempt
from HTTP rate counting. Immutable static assets (`/_nuxt/*`, `/_i18n/*`,
`/fonts/*`, `/favicon.ico`, `/robots.txt`) are exempt from the `webvue_web` zone so client
asset requests do not exhaust the interactive web budget or cause 429 white-screens for
tenants behind a shared client IP. No trusted proxy headers are enabled. Module execution
and real rate-limit behavior under load are NOT RUN; `caddy adapt` structure is tested.

F5 rate budget (per client IP/min). Odoo's own `/web/assets/*` and `/web/static/*` are
not served through this edge (guard admits no such route), so nothing is exempted for
them; `/web/image/*` is ACL-checked and stays limited, and `/web/content/*` is not served at all
(attachments download through the owning `/api/v1/.../attachments/<id>/download` routes).
`/web/session/get_session_info` (browser websocket version probe, `useBus.ts`) was
matched by the `/web/session/*` auth zone, i.e. it shared the 20/min login bucket; it
now counts in `webvue_odoo`. Other `/web/session/*`, `/web/login`, `/api/auth/*` stay in
`webvue_auth` at 20. Image bytes get `webvue_odoo_image` (1200) instead of competing with
RPC/report traffic in `webvue_odoo` (600). Target: 30 users behind one NAT x 2 page
loads/min = 60 loads/min. Per load: 1 probe + ~2 logo/favicon + ~10 avatars (assumed,
unmeasured) -> odoo 60 (<600), image 60x12=720 (<1200). Auth unchanged.
Reject inbound `X-WebVue-Proxy-Token` and `X-WebVue-Tenant-Revision` at edge;
do not merely forward it. Strip forwarding headers, do not trust client proxy IPs.
Guard itself rejects DB/session/forwarding selection headers. TLS is terminated at
edge; private HTTP hops are assumed protected. Cookies always Secure in shared.

Odoo MUST have `proxy_mode=False`, `dbfilter=^%h$`, `list_db=False`. Guard sets Odoo
Host to the registry's validated database identifier, not user input, and does not
send X-Odoo-Database. Thus monodb discovery is restricted to that exact name, never
the sole unrelated DB. No stock Odoo changes or monkey patches. Stock filestore
layout is `data_dir/filestore/<database>`: runtime registry rejects database != filestore.
Odoo sessions are unwrapped only on the Odoo hop after tenant binding verification.

Environment:
- all shared processes: `WEBVUE_TENANCY_MODE=shared` (unset/dedicated keeps Nuxt legacy behavior)
- guard + Nuxt: `WEBVUE_TENANT_REGISTRY_PATH`, read-only mount of atomically published registry;
  `WEBVUE_SHARED_PROXY_TOKEN`, random >=32-byte secret, no logs
- guard: `WEBVUE_SESSION_KEYS` JSON map key-id → >=32-byte random secret;
  `WEBVUE_SESSION_ACTIVE_KID`, `WEBVUE_GUARD_PORT` (default 8080),
  `WEBVUE_GUARD_ODOO_URL`, `WEBVUE_GUARD_WEB_URL`, `WEBVUE_GUARD_WS_URL`
- Nuxt: `NUXT_ODOO_URL=http://guard:8080`, public WS URL empty (same-origin).
  Remove Odoo routeRules and dev WS bypass in shared only. Do not expose keyring to Nuxt.
- control-api + control-worker (invitation acceptance): control-api has no Docker access; it hands
  the new admin password to control-worker over an internal HTTPS channel, in memory only.
  Both: `INTERNAL_EFFECT_KEY`, random >=32-byte secret distinct from `CONTROL_SERVICE_KEY` and the
  customer commercial key (unset = channel off, every acceptance returns 503).
  control-api: `INTERNAL_EFFECT_URL` (https) and `INTERNAL_EFFECT_CA` (absolute path).
  control-worker: `INTERNAL_EFFECT_HOST`, `INTERNAL_EFFECT_PORT` (default 4188),
  `INTERNAL_EFFECT_TLS_KEY`, `INTERNAL_EFFECT_TLS_CERT` (absolute paths); the certificate SAN must
  match the URL host. Put the channel on an internal-only network that only these two join.

## Health and startup packaging (t8)

`start.mjs` rejects invalid mode/port/token/registry before listening. The guard
Dockerfile healthcheck is `node deploy/shared/healthcheck.mjs`: local TCP connect to
127.0.0.1:$WEBVUE_GUARD_PORT, 2-second timeout, no output or database selection.
This is **liveness only**, not registry freshness/upstream/readiness proof. No public
health route was added or exempted from tenant checks. Nuxt should use equivalent
loopback TCP liveness on port 3000 in the shared overlay, never untrusted `/login`.
There must be no web→guard health dependency cycle. Guard startup may depend on web
TCP liveness. Real routed tenant probes remain a separate acceptance gate.

`odoo.conf` is an INCOMPLETE reference, not a runnable secret config. The actual
`deploy/odoo/entrypoint.sh` invokes `odoo_secure.py` with `/etc/odoo/odoo.conf`;
neither consumes HOST/USER/PASSWORD nor injects DB credentials. The secure launcher
preserves the PDF safety adapter; it does not validate shared DB routing settings.
The earlier t8 entrypoint-secret assumption was incorrect and is superseded here.

Operator must prepare a complete config **outside Git/build context** containing
`db_host`, `db_user`, `db_password`, `admin_passwd` plus reference shared invariants.
No secret is passed in argv, buildargs or logs. Bind this file read-only at
`/etc/odoo/odoo.conf`; do not mount the incomplete repository reference. Require
0400 or 0440, owner root or runtime UID 10001, with read access for Odoo (for 0440,
operator assigns the runtime-readable group). Parent directory must be controlled
by the operator; no untrusted writer. Rotate via controlled replacement and restart;
validation is pre-start, not a concurrent config mutation defense.

Shared startup integration contract for t5: mount `launch_odoo.py` and
`validate_odoo_config.py` read-only in `/opt/webvue/shared/`, set entrypoint to
`["/opt/venv/bin/python","/opt/webvue/shared/launch_odoo.py"]`, command to `[]`, and
`WEBVUE_TENANCY_MODE=shared`. This wrapper accepts no CLI overrides, validates the
fixed config path, then execs `/usr/local/bin/webvue-odoo` unchanged. It does not
replace the secure PDF launcher. Dedicated continues using its original entrypoint.
The validator requires exact `dbfilter=^%h$`, `list_db=False`, `proxy_mode=False`,
`workers=2`, `data_dir=/var/lib/odoo`, forbids any `db_name`, and fails missing or
placeholder credentials. Parser errors and failures emit only
`shared_config_rejected`, never values or config contents. It is not a credential
strength/validity check and does not connect to DB.

Offline check: `python3 deploy/shared/validate_odoo_config.py /operator/config/path`
(the argument is a path, not a password). Actual wrapper hookup belongs to t5;
this validator alone is **not proof of startup enforcement**. Unit tests mock exec;
Docker/Odoo startup, mount UID mapping, network and database connectivity are NOT RUN.
The non-root guard user needs read access to its registry bind mount; mount the
registry **directory** read-only when publisher uses atomic file replacement so
readers observe new inodes rather than an old individually mounted file.

`node --test deploy/shared/package.test.mjs` checks static image/import/config/health
contracts without Docker, DBs or listeners. It is not a Docker build or Caddy parser.
Docker image build, Docker Compose runtime, live HTTP health and Caddy validation:
**NOT RUN**. Dedicated files were not changed by t8; shared remains opt-in.

## Registry authority and revisions

`{schemaVersion:1,snapshotRevision:nonNegativeInteger,targets:[{host,tenantId,database,
filestore,enabled,registryRevision}]}`. Host must be canonical lowercase ASCII.
`{schemaVersion:1,snapshotRevision:0,targets:[]}` is the only valid empty registry: the
deny-all bootstrap snapshot. Guard refuses every host until the first onboarding
publication replaces it with revision 1. A fresh deployment seeds that file before
starting guard; no tenant needs to exist first. Any populated snapshot has revision >= 1.
Global snapshot revision is CAS publication control; registryRevision is per tenant.
The resolver preserves existing global host/id/database/filestore uniqueness checks.
`mutateRegistry` requires explicit trusted management authority + actor, CAS revision,
monotonic tenant revision, immutable database/filestore and returns audit metadata.
This primitive is NOT an authenticated CRUD API or durable publisher. Only the
control-plane writer may atomically persist snapshot + audit (t5); readers cannot write.
No deletion operation is provided: disabled rows are retained as tombstones, keeping
identities/resources reserved. The control-plane must never replace a snapshot from
untrusted input or drop tombstones. Host/enabled changes bump per-tenant revision.

Readers do not cache: disable affects next request and next WS handshake after
publication. Already running HTTP requests may finish. WS connections forcibly close
within 30 seconds of handshake, bounding reauthorization delay; this is not immediate
revocation. Revise through registry writer; writing a static file manually bypasses
CAS/audit and is not an authorized mutation protocol.

## Session and route contract

Cookie name `session_id` replaces raw SID. Value is base64url(JSON array
`[1,kid,tenantId,registryRevision,exp,sid]`) + '.' + HMAC-SHA256 base64url. HMAC gives
integrity NOT confidentiality: SID remains decodable. One-hour bounded expiry,
constant-time MAC verification, 2048-character envelope limit. Key rotation: retain
old verification key for <=1 hour; removal revokes old sessions. Changing tenant
revision invalidates its envelopes only. Raw legacy shared sessions fail closed and
require a cookie-clear/relogin; there is no silent migration.

Cookies emitted by Odoo are reduced to `session_id`, host-only, Path=/, Secure,
HttpOnly, SameSite=Lax, bounded Max-Age. MFA pre-session uses the same envelope.
Nuxt keeps envelope unchanged and forwards it only to guard. Login BFF injects
registry DB; guard permits matching `params.db` only on private authenticate call.
Client query/body db/database/session_id/sid selectors are rejected; non-JSON Odoo
writes denied. Body limit 16 MiB; this intentionally does not support generic Odoo
multipart routes. Reviewed API attachment JSON remains supported.

Allowed Odoo surface: `/api/v1/*`, `/websocket`, private BFF
`/web/session/authenticate` and `/web/session/destroy`. Generic RPC, DB manager,
Odoo console, raw web login, reports/mail/bus routes are denied; customer UI stays
Nuxt. WS upgrade copies handshake + bytes in both directions and rewraps cookies.

## Evidence and remaining gates

`node --test deploy/shared/guard.test.mjs`: offline/mock only. Covers ten positive
bindings + ninety cross-tenant cookie rejection pairs, raw/tampered/expired/revoked
cookies, rotation, conflicts, unauthorized mutations, DB-body injection, actual
loopback HTTP auth/content/MFA, SSR hop preservation and WS upgrade byte echo.
These temporary mock listeners/databases are not Odoo/production evidence (no DB).

Required t5/t6/t7: full built Nuxt SSR inherited-header behavior, existing dedicated
regression, Caddy syntax/rate-limit integration, image/layout checks, network-negative
proof, real Odoo multi-DB/no-DB selection and MFA/logout/download behavior, independent
security review. No live Odoo, DB, deployment, DNS, commit, merge or push was performed.
Until these gates pass this is NOT an accepted isolation deployment or launch-ready.
