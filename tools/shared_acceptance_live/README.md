# Shared acceptance live harness

Two-tenant shared-mode acceptance test for the LiwanOS platform. Provisions a complete
stack (PostgreSQL → Odoo init → admin/role/employee seeding → guard → web → Caddy edge)
and runs browser-level isolation proofs. **NOT deployment authorization.**

The harness runs the one stack, `deploy/stack/compose.yml`, the same definition every environment runs. `stack_render.py`
renders it from `deploy/environments/local.env.example` plus the harness's own values (image tag, domain, ports,
subnets, secrets; written by `up.sh` into a private run directory as `harness.env`). Nothing is stacked over the
compose file, no source file is mounted into a container (Odoo runs the launcher and validator its image was built
with) and the harness has no Caddyfile of its own. `subnets.yml` only pins network subnets and defines no service. A
harness compose file never redefines a stack service (`tools/test_acceptance_harness_stack.py` refuses it).

## Exact commands

```bash
export LIWAN_IMAGE_TAG=<short-sha of HEAD>          # e.g. 28b6c04
bash tools/shared_acceptance_live/up.sh

# Proofs 1–7 (reads the .state file written by up.sh); defer proof 9 until last.
node tools/shared_acceptance_live/probe.mjs --skip-rate-limit

# Proof 8 (real browser). Run from apps/web so @playwright/test resolves, and use the
# harness config (apps/web's own testDir: './e2e' does not discover this spec).
cd apps/web && npx playwright test \
  --config /abs/path/to/tools/shared_acceptance_live/playwright.config.mjs

# Offline parser self-check (no stack needed)
node tools/shared_acceptance_live/selfcheck.mjs

# From repository root: optional r3 F5 measurements (30 real page loads, then
# immediately 25 wrong logins; retains one authenticated session per tenant).
node tools/shared_acceptance_live/f5-measure.mjs

# Proof 9 LAST: this locks the auth zone for the remaining window.
node tools/shared_acceptance_live/probe.mjs --rate-limit-only

# Teardown (containers, networks, volumes of this project only)
bash tools/shared_acceptance_live/down.sh
```

`probe.mjs` writes `probe-results.json` next to itself; `.state` and that file are
gitignored.

## Image tags

Every image of the stack uses `${LIWAN_IMAGE_TAG}` (the short HEAD sha) under the stack's own names, which `up.sh` reads
with `--no-build --pull never`. Build them from the repository root, with the Dockerfiles the stack's `build:` entries name:

| Service | Image | Dockerfile | Extra |
|---|---|---|---|
| odoo | `liwan-odoo` | `deploy/odoo/Dockerfile` | build arg `ODOO_COMMIT=$(cat deploy/odoo/ODOO_COMMIT)` |
| web | `liwan-web` | `apps/web/Dockerfile` | build arg `LIWAN_TENANCY_MODE=shared` (Never a dedicated build, per T6-F01) |
| guard | `liwan-guard` | `deploy/shared/Dockerfile` | — |
| caddy | `liwan-caddy` | `deploy/proxy/Dockerfile` | must show `http.handlers.rate_limit` in `caddy list-modules` |
| ai-egress / odoo-egress | `liwan-ai-egress` | `deploy/ai-egress/Dockerfile` | build context `deploy/ai-egress` |
| odoo-mail | `liwan-odoo-mail` | `deploy/odoo-mail/Dockerfile` | build context `deploy/odoo-mail` |

```bash
export LIWAN_IMAGE_TAG=$(git rev-parse --short HEAD)
docker build -f deploy/odoo/Dockerfile --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" -t "liwan-odoo:$LIWAN_IMAGE_TAG" .
docker build -f apps/web/Dockerfile --build-arg LIWAN_TENANCY_MODE=shared -t "liwan-web:$LIWAN_IMAGE_TAG" .
docker build -f deploy/shared/Dockerfile -t "liwan-guard:$LIWAN_IMAGE_TAG" .
docker build -f deploy/proxy/Dockerfile -t "liwan-caddy:$LIWAN_IMAGE_TAG" .
docker build -t "liwan-ai-egress:$LIWAN_IMAGE_TAG" deploy/ai-egress
docker build -t "liwan-odoo-mail:$LIWAN_IMAGE_TAG" deploy/odoo-mail
```

## Compose invocation

`up.sh`/`down.sh` call `stack_render.py command <run dir> <project>`, which prints the one argument list: `docker compose
--project-directory <repo>/deploy -p <project> --env-file local.env.example --env-file harness.env --env-file sizing.env
-f compose.yml -f subnets.yml`. The project directory is `deploy/`, so the stack's own relative paths (`./stack/Caddyfile`,
`./db/...`) resolve exactly as in every environment. The run directory (`$TMPDIR_BASE/stack`, mode 0700) holds the
rendered compose file, `sizing.env`, `harness.env` and the Odoo config, and is removed with the temp dir by `down.sh`.

## Edge port decision: 443/80 on 127.0.0.1

The edge proxy publishes on `127.0.0.1:443` and `127.0.0.1:80` (not 18443/18080).

**Why:** `guard.mjs:28` passes `req.headers.host` to `resolveTenantHost()` in
`apps/web/server/utils/tenantHostResolver.ts:14`. That resolver's `hostPattern`
(`/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/`)
matches only lowercase alphanumeric dots and hyphens — it rejects any Host containing
a colon/port. Caddy's `reverse_proxy` forwards the incoming `Host` header unchanged.
If the browser connects to `a.accept.liwan.localhost:18443`, the Host header includes
`:18443`, the resolver throws `tenant_host_unavailable`, and guard returns 403.

Using standard ports means the browser sends a port-less Host (`a.accept.liwan.localhost`),
which matches the registry exactly. We bind to `127.0.0.1` only, so this does not
conflict with other services on the host network interface.

We do NOT rewrite `header_up Host` in Caddy because that would change production
behavior and mask routing bugs.

## Network subnets are pinned

The host daemon's predefined address pools are fully subnetted (every 172.17–172.31
`/16` and most `192.168.x/20` are held by unrelated running projects). A project that
lets Docker pick from the default pool fails with:

```
all predefined address pools have been fully subnetted
```

The stack pins its `edge` network itself (`LIWAN_EDGE_SUBNET`). `subnets.yml` pins every other network of the stack from
`LIWAN_HARNESS_SUBNET_*` values that `up.sh` writes into `harness.env`, all `/24` in `10.240.0.0/16` (edge .2, guard_web .4,
guard_odoo .6, database .8, ai_internal .10, odoo_egress .12, odoo_mail .14, relay_odoo .16, guard_restore .18,
restore_database .20, tenant_storage .22). Explicit subnets do not need pool arbitration. The networks keep the
`internal: true` of the stack definition.

## Healthchecks and readiness

The stack waits on the healthchecks the stack itself defines, unchanged:

| Service | What it proves |
|---|---|
| db | a real `psql` login as the admin role |
| odoo | an HTTP worker answers `/web/health?db_server_status=1` and the database server is reachable |
| web | the Nitro server answers the static `/favicon.ico` |
| guard | loopback liveness on 8080 |
| proxy | no healthcheck; it starts only once web, odoo and guard are healthy |

After the containers are healthy, `up.sh` performs the real readiness probe: an HTTPS
request to `https://<host>/` for **both** tenant hosts, resolved to 127.0.0.1, with the
exported root CA. A 403 (no valid tenant session) or 200 proves Caddy, the pinned
rate-limit module, TLS with the registry hostname and guard host resolution are all live.

## Tenant registry

File: `registry.json` under `$LIWAN_TENANT_REGISTRY_DIR` (mounted as `/etc/liwan/`).
Guard reads it at `LIWAN_TENANT_REGISTRY_PATH=/etc/liwan/registry.json`.

The temp base dir is mode 0755 so the unprivileged in-container users (`node` in
guard/web, uid 10001 in odoo) can traverse to their bind mounts.

Schema (validated by `apps/web/server/utils/tenantRegistry.ts:validateRegistry`):
```json
{
  "schemaVersion": 1,
  "snapshotRevision": <positive integer>,
  "targets": [{
    "host": "<lowercase ASCII, no port>",
    "tenantId": "<^[a-z][a-z0-9_-]{0,62}$>",
    "database": "<^[a-z][a-z0-9_]{0,62}$>",
    "filestore": "<must equal database>",
    "enabled": true,
    "registryRevision": <positive integer>
  }]
}
```

Global uniqueness enforced: no duplicate hosts, tenantIds, databases, or filestores.

Readers do not cache, so an atomic replace of `registry.json` takes effect on the next
request. `probe.mjs` proves this for real: it rewrites B with `enabled=false` plus a
bumped `registryRevision`/`snapshotRevision`, confirms B fails closed with no container
restart, then restores the original snapshot and confirms B works again.

## Commercial classification (`LIWAN_COMMERCIAL_CONFIG`) is required to install

`liwan_platform`'s tenant-profile `post_init_hook` calls
`commercial_config.load_classification()`, which raises
`ValueError: liwan commercial config: set LIWAN_COMMERCIAL_CONFIG to an absolute local file`
when the variable is absent. A fresh install therefore cannot complete without it.

The file is generated by the repository's own generator — the same call the CI
pipeline uses — never hand-written:

```bash
python3 deploy/classification.py fixture --database <db> --mode saas --output <path>
```

`fixture` is a disposable-input generator and refuses any database name that does
not match `liwan_*scratch*`, so the acceptance databases are named
**`liwan_accept_a_scratch` / `liwan_accept_b_scratch`**. They are disposable
loopback-only databases inside a project that is removed at the end.

The files are written into `<temp dir>/control-state/classifications/`, the host directory the stack mounts read-only into
Odoo at `/run/liwan-runtime/classifications` (the directory the control plane's effects use). The one-off install and
seeding runs name the file with `LIWAN_COMMERCIAL_CONFIG=/run/liwan-runtime/classifications/<db>.json`. Mode is **`saas`**
(the shared SaaS lane). No control plane or billing connection is made at classification time: `load_classification()`
runs only inside `liwan.tenant.profile.create()`, and the profile is persisted in the database. The running service sets
no `LIWAN_COMMERCIAL_CONFIG`, matching the `unset LIWAN_COMMERCIAL_CONFIG` precedent used before the service starts in CI.

## Odoo config (operator-owned secret, never in Git)

`stack_render.py` renders `<run dir>/odoo.conf` (mode 0400) from the stack's own `deploy/stack/odoo.conf.template`: the
`odoo` role's password and the master-password hash of the harness, with the worker and memory budget of
`deploy/odoo_sizing.py`. `up.sh` chowns it to the container uid when it runs as root on Linux and validates it once, with the
validator the Odoo image was built with, as the runtime uid (`/opt/liwan/shared/validate_odoo_config.py`). The harness
mounts no launcher or validator from the source tree.

## Seeding: capabilities are not `base.group_system`

Membership in `base.group_system` does **not** grant PMO or HR access. Authorization
goes through the `liwan_core` capability service, roles and company-scoped assignments.
`seed_tenant.py` therefore creates, per tenant:

1. the tenant admin `res.users` (Arabic `lang`, `base.group_system`);
2. `liwan.access.assignment` rows for the built-in roles
   `liwan_core.role_system_admin`, `liwan_pmo.role_pmo_manager`,
   `liwan_hr.role_hr_manager` through liwan_core's own model;
3. the `ACCEPT-A-ONLY` / `ACCEPT-B-ONLY` project;
4. the `ACCEPT-A-EMP` / `ACCEPT-B-EMP` HR employee.

It then asserts the created admin actually resolves `pmo.projects.read` and
`hr.employees.read` from `liwan.access.service._liwan_identity(user)` before committing.
No capability check is bypassed.

The seed script travels in `LIWAN_ACCEPT_SEED` (an env var) and is `exec`'d by a tiny
stdin stub, so no password ever reaches a command line and no TTY allocation is needed.

Pinned Odoo 19 uses `group_ids` on `res.users`, not `groups_id`.

## Session keys

`LIWAN_SESSION_KEYS` is a JSON map of `kid → secret` where each secret is ≥32 bytes.
`LIWAN_SESSION_ACTIVE_KID` selects the signing key. The guard's `sessionCodec()` in
`deploy/shared/guard.mjs` validates all keys are strings ≥32 bytes and that the
active kid exists.

Session cookie value format: `base64url(JSON([1,kid,tenantId,registryRevision,exp,sid]))`.`HMAC-SHA256-base64url`

## TLS trust mechanism

The harness domain is `accept.liwan.localhost`. A `.localhost` name never qualifies for a public certificate, so Caddy
issues it from its internal CA with no Caddyfile of the harness: the stack Caddyfile is used as it is. The restore and
TikTok relay site names of the stack are also set to `.localhost` names (`restore.accept.liwan.localhost`,
`tiktok.accept.liwan.localhost`) so that no site asks a public CA. `up.sh` exports the root certificate to
`$TMPDIR_BASE/root.crt` and computes its SPKI SHA-256 pin to `$TMPDIR_BASE/root.spki`.

- **probe.mjs**: Uses `rejectUnauthorized: true` with `ca: readFileSync(root.crt)`
  and `servername` set to the tenant host. This proves the full TLS chain, and reports
  the peer subject / issuer / SAN.
- **proof8.spec.mjs**: Launches Chromium with
  `--ignore-certificate-errors-spki-list=<SPKI>` which pins trust to ONLY this CA, plus
  `--host-resolver-rules` to map the tenant hosts to 127.0.0.1 (no `/etc/hosts` edit).

## The asset-exhaustion variant (finding F4)

The stack Caddyfile (`deploy/stack/Caddyfile`) keys every non-API path to one `liwan_web` bucket of 600 events/minute per
client IP, except the application's own immutable static assets (`/_nuxt/*`, `/_i18n/*`, `/fonts/*`, `/favicon.ico`,
`/robots.txt`). A single cold `/login` response references 127 `/_nuxt/*` files, so without that exemption two tenants
cold-loading inside a minute exhausted the bucket and the second tenant received `429` for its own `.js`/`.css`/font
requests, and the page rendered an empty body. That was a production finding, recorded as F4 in
`docs/verification/shared-live-acceptance.md`, and the harness runs the production Caddyfile unchanged.

## Proof map

| # | Proof | Mechanism |
|---|---|---|
| 1 | TLS chain + SAN | `probe.mjs` `rejectUnauthorized:true` against the exported root for A and B; reports subject/issuer/SAN |
| 2 | Host routing / data isolation | `/api/v1/me` login differs per host and `/api/v1/projects` on A never contains B's project |
| 3 | Private headers rejected | `X-Liwan-Proxy-Token` / `X-Liwan-Tenant-Revision` → 403 at the edge |
| 4 | Port isolation | resolved compose `ps` publishers are only 127.0.0.1:443/80; TCP probes to 3000/8069/8072/8080/5432 from the host fail |
| 5 | Session cookie flags | `Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain` (secret redacted) |
| 6 | Cross-tenant cookie | A's cookie on B → 403 and B's cookie on A → 403 |
| 7 | Fail-closed | unknown host → 403; B with `enabled=false` → 403 with no restart, then restored |
| 8 | Browser isolation | Playwright: Arabic login; `/`, `/projects`, `/hr` never show the other tenant's data; `/projects` shows the own project and `/hr` the own employee (`/` is the workspace launcher and lists no records), then logout |
| 9 | Rate limit | >20 `liwan_auth` requests → 429 (runs last: it locks the auth zone) |

## What it does NOT prove

- Public TLS / ACME, DNS, or any production ingress.
- 10 tenants / 90 tenant pairs; MFA; websocket behavior.
- Odoo filestore restore, RPO/RTO, payment, capacity, `non_saas`.
- Independent security review, or production deployment readiness.
