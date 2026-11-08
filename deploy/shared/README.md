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
`/fonts/*`, `/favicon.ico`, `/robots.txt`) are exempt from the `liwan_web` zone so client
asset requests do not exhaust the interactive web budget or cause 429 white-screens for
tenants behind a shared client IP. No trusted proxy headers are enabled. Module execution
and real rate-limit behavior under load are NOT RUN; `caddy adapt` structure is tested.

F5 rate budget (per client IP/min). Odoo's own `/web/assets/*` and `/web/static/*` are
not served through this edge (guard admits no such route), so nothing is exempted for
them; `/web/image/*` is ACL-checked and stays limited, and `/web/content/*` is not served at all
(attachments download through the owning `/api/v1/.../attachments/<id>/download` routes).
`/web/session/get_session_info` (browser websocket version probe, `useBus.ts`) was
matched by the `/web/session/*` auth zone, i.e. it shared the 20/min login bucket; it
now counts in `liwan_odoo`. Other `/web/session/*`, `/web/login`, `/api/auth/*` stay in
`liwan_auth` at 20. Image bytes get `liwan_odoo_image` (1200) instead of competing with
RPC/report traffic in `liwan_odoo` (600). Target: 30 users behind one NAT x 2 page
loads/min = 60 loads/min. Per load: 1 probe + ~2 logo/favicon + ~10 avatars (assumed,
unmeasured) -> odoo 60 (<600), image 60x12=720 (<1200). Auth unchanged.
Reject inbound `X-Liwan-Proxy-Token` and `X-Liwan-Tenant-Revision` at edge;
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
- all shared processes: `LIWAN_TENANCY_MODE=shared` (unset/dedicated keeps Nuxt legacy behavior)
- guard + Nuxt: `LIWAN_TENANT_REGISTRY_PATH`, read-only mount of atomically published registry;
  `LIWAN_SHARED_PROXY_TOKEN`, random >=32-byte secret, no logs
- guard: `LIWAN_SESSION_KEYS` JSON map key-id → >=32-byte random secret;
  `LIWAN_SESSION_ACTIVE_KID`, `LIWAN_GUARD_PORT` (default 8080),
  `LIWAN_GUARD_ODOO_URL`, `LIWAN_GUARD_WEB_URL`, `LIWAN_GUARD_WS_URL`
- guard + Nuxt, optional: `LIWAN_RESTORE_REGISTRY_PATH`; guard only: `LIWAN_GUARD_RESTORE_ODOO_URL`
  (required with the path), `LIWAN_GUARD_RESTORE_WS_URL`. See "Restore hosts".
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
127.0.0.1:$LIWAN_GUARD_PORT, 2-second timeout, no output or database selection.
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
`validate_odoo_config.py` read-only in `/opt/liwan/shared/`, set entrypoint to
`["/opt/venv/bin/python","/opt/liwan/shared/launch_odoo.py"]`, command to `[]`, and
`LIWAN_TENANCY_MODE=shared`. This wrapper accepts no CLI overrides, validates the
fixed config path, then execs `/usr/local/bin/liwan-odoo` unchanged. It does not
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

## Restore hosts

A verified restore is published by the control plane (`publishOdooRestore`) as a route in a **separate** registry file,
`<stateDir>/restore-registry/registry.json`, with the same schema as the tenant registry and one target per approval:
host `r<approval uuid hex>.restore.<domain>`, tenant id `r<approval uuid hex>`, and the scratch database as both
`database` and `filestore`. The files are never merged (the control plane's `shared_odoo_restore_registry_guard`
trigger keeps a restore database out of the tenant bindings).

Readers:
- **guard** reads the file per request, with no cache, when `LIWAN_RESTORE_REGISTRY_PATH` is set. A restore host goes
  through the same `requestPlan` as a tenant host: the same forbidden headers and routes, the same proxy-token check,
  the same session binding. The restored database lives in `restore-db`, so the guard sends a restore host's Odoo
  traffic to `LIWAN_GUARD_RESTORE_ODOO_URL` (`restore-odoo`) and never to the tenant Odoo; web traffic still goes to the
  one Nuxt service.
- **Nuxt** (`tenantRequest`) resolves a restore host from the same file, so the page it renders carries the restore
  target's revision; it is consulted only for restore hosts.

Failure rule. The restore file is consulted **only** for hosts shaped `r<32 hex>.restore.<domain>`, so it can never
affect a tenant host:
- no path configured, or a host outside that shape: no restore targets;
- file absent (and no `registry.json.pending` barrier): no restore targets, so the restore host is unknown (403);
- anything else is `restore_registry_unavailable` (403) for that restore host: a barrier file, an unreadable or
  malformed file, `database != filestore`, a target whose host is outside the restore shape, or a host, tenant id,
  database or filestore that the tenant registry also carries (hosts stay globally unique across both files);
- a broken **tenant** registry still denies every request, restore hosts included.
With release routing on (`LIWAN_RELEASE_ROUTES_DIR`) a restore host is refused (`restore_release_routes_unsupported`):
a restore target has no release route.

Compose (`deploy/docker-compose.shared.yml`). `LIWAN_RESTORE_REGISTRY_DIR` must be the control plane's
`<stateDir>/restore-registry` (mounted read-only into guard and web at `/etc/liwan-restore`; the default
`./data/restore-registry` is an empty directory, so a stack that does not set it serves no restore host). The
`restore` profile declares `restore-db` (same pinned image as `db`) and `restore-odoo` (same image as `odoo`), the two
services `tools/shared_saas_lifecycle/odoo_backup.py` restores into. They start only with `--profile restore`, publish
no port, share no network with `db` or `odoo`, and use their own volumes. `restore-odoo` mounts
`LIWAN_RESTORE_ODOO_CONFIG`, a validated external config whose `db_host` is `restore-db`; unset, it mounts
`deploy/shared/odoo.restore.conf`, an incomplete reference the startup validator rejects.

**Access control: who may reach a restore host (owner decision 2026-11-08).** A restore host is on the public edge and
is authenticated like a tenant host, by the restored database's own users, so it would otherwise accept the
credentials the backup held — including a user disabled since the backup, or an old password. Its name is not
guessable (128-bit approval id) and publishing it needs a step-up vendor session, but neither is access control.

So the edge restricts `*.restore.{$DOMAIN}` to the operator's own addresses: the site answers **404** for any client
outside `LIWAN_RESTORE_ALLOW`, an allowlist in Caddy `remote_ip` syntax (`CIDRs`, `private_ranges`, or bare
addresses). There is deliberately **no default**: with the variable unset or empty, every restore host answers 404,
so a deployment cannot expose a restore by forgetting to set it. `trusted_proxies` stays unset on this site, so
`remote_ip` compares the socket peer and no client-supplied header can claim an allowlisted address. A customer
administrator therefore reaches a restored copy only through an operator, which is the intended review step: a
restore is a recovery artefact, not a service. Expiry and unpublish remain future work; today a published route
stays until the operator removes it from the restore registry file.
`restore-odoo` is deliberately given no `LIWAN_SHARED_PROXY_TOKEN`: Odoo reads it only for the TikTok relay.

**Operator prerequisite: wildcard DNS and a wildcard certificate.** The Caddyfile serves
`*.restore.{$LIWAN_RESTORE_DOMAIN:invalid.invalid}`, but without both of the following a restore host is not served:
1. `LIWAN_RESTORE_DOMAIN` set to the control plane's `domainSuffix`. This is a **separate** variable from `DOMAIN` on
   purpose: `DOMAIN` is a site-address list that may carry several tenant hosts
   (`DOMAIN="a.accept.test b.accept.test"`), so deriving the restore wildcard from it produced a site that matched no
   published restore. With the variable unset the site falls back to `invalid.invalid`, which serves nothing.
2. a wildcard DNS record, `*.restore.<domainSuffix>`, pointing at the edge;
3. a TLS certificate valid for `*.restore.<domainSuffix>`. The stock proxy image (`deploy/proxy/Dockerfile`: Caddy plus
   `caddy-ratelimit`) has no DNS-challenge module, so Caddy cannot obtain a wildcard certificate by itself. The
   operator supplies it, for example by building the proxy with a DNS provider module and adding a `tls { dns ... }`
   block, or by adding a `tls <cert> <key>` line, to the restore site only. Neither route is shipped or verified here.

**A restored database runs no scheduled job.** `restore-odoo` is a recovery copy, so every cron the backup held is
overdue on it and would mutate the data before an operator inspects it — `liwan_inbox`'s maintenance cron deletes
conversations and attachments, which also makes `BackupRunner.verify_restore()` fail on a changed attachment
inventory. Compose therefore starts it with `--max-cron-threads=0` and `LIWAN_RESTORE_ROLE=1`, and
`deploy/shared/validate_odoo_config.py` refuses any other argument set or any `max_cron_threads` other than `0` in the
restore config. That is a server-side invariant, not advice in a reference file.

Not verified: no shared stack was started for this change, so serving a restored tenant end to end (DNS, TLS, guard to
`restore-odoo`, Nuxt login) is unproven until an operator runs it with the wildcard certificate in place.

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

## TikTok relay (shared hosting only)

TikTok registers one webhook and one OAuth redirect for the platform app, so a shared
deployment needs one endpoint in front of every tenant database. `tiktok-relay.mjs` is
that endpoint: it verifies what TikTok sent, finds the tenant that owns the account, and
forwards to that tenant's public origin. A dedicated (non-SaaS) deployment has no relay
and no binding: the customer's own app points straight at its server.

Public routes (on `LIWAN_TIKTOK_RELAY_HOST`, `/tiktok/*` only):

- `POST /tiktok/webhook`: verifies `Tiktok-Signature` (`t=<unix s>,s=<hex>`, HMAC-SHA256
  over `"{t}.{raw body}"`) and refuses a delivery more than five seconds away from now in
  either direction, so a timestamp dated in the future is refused like a stale one. It reads the
  envelope's `user_openid`, and forwards the unchanged body and signature to
  `https://<tenant host>/api/v1/inbox/hooks/tiktok`. An unknown account, or one whose
  tenant is disabled or left the registry, answers 200 and forwards nothing (TikTok must
  not retry forever); a tenant 5xx or timeout answers 502 so it does retry. The tenant
  hop presents the signature only: the shared edge refuses any inbound
  `X-Liwan-Proxy-Token`, and the guard strips the internal headers on the public hop.
- `GET /tiktok/oauth/callback`: verifies the signed OAuth state with the same client
  secret and bounces the unchanged query to the tenant's callback. The state's host is
  matched against the active registry targets: the public host, or the tenant database
  identifier, because the guard rewrites the Odoo hop's `Host` to that database. Anything
  else answers a fixed 400 page that never echoes the request.

Internal route (reached only from the `relay_odoo` network, never through the edge):

- `PUT /internal/tiktok/bindings/<open_id>` `{"tenant_id": "..."}` and `DELETE …` with the
  same body, with `X-Liwan-Proxy-Token` compared in constant time. Both methods name the
  caller's tenant: `tenant_id` must resolve to an active registry target (its `tenantId` or its
  `database`), a missing or invalid body answers 400 and an unknown or disabled tenant 422. The
  proxy token is shared, so it proves no tenant by itself: `DELETE` removes the binding only when
  it belongs to the caller's tenant, an account held by another active tenant answers 409 and
  keeps its routing, and a missing binding answers 200 `{"removed": false}`. A binding whose own
  tenant is no longer active routes nothing (Review Focus 5), so an active tenant's `DELETE`
  drops that stale record. On `PUT`, an account already bound to another active tenant answers
  409, so a moved account is refused rather than misrouted. The bindings file is
  `{"schemaVersion":1,"bindings":{"<user_openid>":"<tenant id>"}}`, written atomically
  (temporary sibling, fsync, rename) and read on every request.

Configuration (all operator-owned, never in Git):

- `LIWAN_TIKTOK_RELAY_HOST`: the platform's TikTok delivery host; its DNS name and TLS
  certificate belong to the edge, and Caddy serves `/tiktok/*` there only.
- `LIWAN_TIKTOK_CLIENT_KEY`, `LIWAN_TIKTOK_CLIENT_SECRET`, `LIWAN_TIKTOK_REDIRECT_URI`:
  the platform TikTok app (D1). Odoo and the operator script read them; in shared hosting
  the redirect URI is `https://$LIWAN_TIKTOK_RELAY_HOST/tiktok/oauth/callback`.
- `LIWAN_SHARED_PROXY_TOKEN`: the shared internal token, already required by guard and
  Nuxt; the relay's binding route and Odoo's registration call use it.
- `LIWAN_TIKTOK_BINDINGS_PATH` (default shown in Compose:
  `/var/lib/liwan/tiktok-bindings.json`), on the `tiktok_bindings` named volume. The image
  creates `/var/lib/liwan` owned by `node`, so the unprivileged relay can write the volume.
- `LIWAN_TIKTOK_RELAY_PORT` (default `8090`), `LIWAN_TENANT_REGISTRY_PATH` (read-only
  registry directory mount, as for guard).

Odoo registers a connected account only when `LIWAN_TIKTOK_RELAY_URL` is set (operator
configuration, not a customer-type condition: R6): the connect callback binds the account,
deleting the channel unbinds it, and the `liwan inbox: register TikTok accounts with the
shared relay` cron retries a channel the relay refused. A relay that cannot be reached
never fails a connect or a delete.

Operator steps:

```sh
# one per platform app, after the app policy is in place
python3 deploy/tiktok_webhook.py register   # LIWAN_TIKTOK_* in the environment
python3 deploy/tiktok_webhook.py show
python3 deploy/tiktok_webhook.py delete
```

The script derives the webhook URL from the redirect URI (shared relay host, or the
tenant's own `/api/v1/inbox/hooks/tiktok` in a direct deployment), takes no secret on the
command line and prints no secret. `node --test deploy/shared` covers the relay offline;
`python3 -B -m unittest deploy/test_tiktok_webhook.py` covers the script. Neither is a
deployment: the relay's tenant hop, Caddy routing and volume permissions are only proven
by a real shared deployment.

