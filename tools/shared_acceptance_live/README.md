# Shared acceptance live harness

Two-tenant shared-mode acceptance test for the Nasq platform. Provisions a complete
stack (PostgreSQL → Odoo init → admin/role/employee seeding → guard → web → Caddy edge)
and runs browser-level isolation proofs. **NOT deployment authorization.**

## Exact commands

```bash
export NASQ_IMAGE_TAG=<short-sha of HEAD>          # e.g. 28b6c04
bash tools/shared_acceptance_live/up.sh

# Proofs 1–7 and 9 (reads the .state file written by up.sh)
node tools/shared_acceptance_live/probe.mjs

# Proof 8 (real browser). Run from apps/web so @playwright/test resolves, and use the
# harness config (apps/web's own testDir: './e2e' does not discover this spec).
cd apps/web && npx playwright test \
  --config /abs/path/to/tools/shared_acceptance_live/playwright.config.mjs

# Offline parser self-check (no stack needed)
node tools/shared_acceptance_live/selfcheck.mjs

# Teardown (containers, networks, volumes of this project only)
bash tools/shared_acceptance_live/down.sh
```

`probe.mjs` writes `probe-results.json` next to itself; `.state` and that file are
gitignored.

## Image tags

All four images are tagged `nasq-accept-<name>:${NASQ_IMAGE_TAG}` where the tag is the
short HEAD sha. `acceptance.override.yml` selects every image through
`${NASQ_IMAGE_TAG}` (no hardcoded `:stagea` anywhere), so `up.sh` and the override can
never drift apart.

| Service | Dockerfile | Extra |
|---|---|---|
| odoo | `deploy/odoo/Dockerfile` | build arg `ODOO_COMMIT=$(cat deploy/odoo/ODOO_COMMIT)` |
| web | `apps/web/Dockerfile` | build arg `NASQ_TENANCY_MODE=shared` (Never a dedicated build, per T6-F01) |
| guard | `deploy/shared/Dockerfile` | — |
| caddy | `deploy/proxy/Dockerfile` | must show `http.handlers.rate_limit` in `caddy list-modules` |

Build context is always the repository root.

## Compose path base (this is the part that keeps breaking)

`up.sh`/`down.sh` run `docker compose` with the **working directory set to `deploy/`**
and do **not** pass `--project-directory`.

Compose resolves every relative bind-mount source against the project directory, which
defaults to the directory of the first `-f` file (`deploy/`). Consequences:

- the committed `deploy/docker-compose.shared.yml` mounts `./shared/Caddyfile`,
  `./shared/launch_odoo.py`, `./shared/validate_odoo_config.py`, which resolve to real
  files;
- this harness is addressed as `../tools/shared_acceptance_live/...`.

Do **not** reintroduce `--project-directory "$REPO_ROOT"`: that breaks the committed
`./shared/*` mounts, and bare relative sources like `tools/shared_acceptance_live/x`
then parse as *named volumes* ("service proxy refers to undefined volume
tools/...").

## Edge port decision: 443/80 on 127.0.0.1

The edge proxy publishes on `127.0.0.1:443` and `127.0.0.1:80` (not 18443/18080).

**Why:** `guard.mjs:28` passes `req.headers.host` to `resolveTenantHost()` in
`apps/web/server/utils/tenantHostResolver.ts:14`. That resolver's `hostPattern`
(`/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/`)
matches only lowercase alphanumeric dots and hyphens — it rejects any Host containing
a colon/port. Caddy's `reverse_proxy` forwards the incoming `Host` header unchanged.
If the browser connects to `a.accept.nasq.test:18443`, the Host header includes
`:18443`, the resolver throws `tenant_host_unavailable`, and guard returns 403.

Using standard ports means the browser sends a port-less Host (`a.accept.nasq.test`),
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

`acceptance.override.yml` therefore pins explicit subnets in `10.240.0.0/16`
(edge .2, guard_web .4, guard_odoo .6, database .8 — all `/24`). Explicit subnets do
not need pool arbitration. The three private networks keep the `internal: true` flag
inherited from the shared overlay.

## Healthchecks and readiness

The stack waits on the real compose healthchecks and then on a routed probe:

| Service | Healthcheck source | What it actually proves |
|---|---|---|
| db | base compose | `pg_isready -U odoo` |
| guard | shared overlay | loopback TCP liveness on 8080 |
| web | **acceptance override** (TCP liveness on 3000) | process is listening |
| odoo | **acceptance override** (TCP connect to 8069) | HTTP listener is up |
| proxy | **acceptance override** (`wget https://127.0.0.1/` expecting 403/200) | TLS listener + guard answering |

Two base healthchecks had to be replaced:

- `web`'s base check fetches `/login`, which in shared mode traverses
  web → guard → Odoo; the shared README explicitly forbids using an untrusted
  `/login` as the shared web check, and it would make dependants wait on a routed
  request.
- `odoo`'s base check probes `http://localhost:8069/web/health`, but shared Odoo runs
  `dbfilter=^%h$` / `list_db=False`; `localhost` is not a database name, so
  `/web/health` answers 5xx and the container can **never** report healthy. Every
  service depending on `odoo: service_healthy` would then block forever.

After the containers are healthy, `up.sh` performs the real readiness probe: an HTTPS
request to `https://<host>/` for **both** tenant hosts, resolved to 127.0.0.1, with the
exported root CA. A 403 (no valid tenant session) or 200 proves Caddy, the pinned
rate-limit module, TLS and guard host resolution are all live.

## Tenant registry

File: `registry.json` under `$NASQ_TENANT_REGISTRY_DIR` (mounted as `/etc/nasq/`).
Guard reads it at `NASQ_TENANT_REGISTRY_PATH=/etc/nasq/registry.json`.

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

## Commercial classification (`NASQ_COMMERCIAL_CONFIG`) is required to install

`nasq_platform`'s tenant-profile `post_init_hook` calls
`commercial_config.load_classification()`, which raises
`ValueError: nasq commercial config: set NASQ_COMMERCIAL_CONFIG to an absolute local file`
when the variable is absent. A fresh install therefore cannot complete without it.

The file is generated by the repository's own generator — the same call the CI
pipeline uses — never hand-written:

```bash
python3 deploy/classification.py fixture --database <db> --mode saas --output <path>
```

`fixture` is a disposable-input generator and refuses any database name that does
not match `nasq_*scratch*`, so the acceptance databases are named
**`nasq_accept_a_scratch` / `nasq_accept_b_scratch`**. They are disposable
loopback-only databases inside a project that is removed at the end.

Mode is **`saas`** (the shared SaaS lane). No control plane or billing connection is
made at classification time: `load_classification()` runs only inside
`nasq.tenant.profile.create()`, and the profile is persisted in the database. The
steady-state service therefore gets an **empty** `NASQ_COMMERCIAL_CONFIG`, matching
the `unset NASQ_COMMERCIAL_CONFIG` precedent used before the service starts in CI.

## Odoo config (operator-owned secret, never in Git)

`up.sh` generates `$TMPDIR_BASE/odoo.conf` mode 0400 (chowned to the container uid when
running as root on Linux) and validates it twice: with the repository validator on the
host, then inside the image as the runtime uid. Required values:
`dbfilter=^%h$`, `list_db=False`, `proxy_mode=False`, `workers=2`,
`data_dir=/var/lib/odoo`, no `db_name`, no placeholder credentials.

## Seeding: capabilities are not `base.group_system`

Membership in `base.group_system` does **not** grant PMO or HR access. Authorization
goes through the `nasq_core` capability service, roles and company-scoped assignments.
`seed_tenant.py` therefore creates, per tenant:

1. the tenant admin `res.users` (Arabic `lang`, `base.group_system`);
2. `nasq.access.assignment` rows for the built-in roles
   `nasq_core.role_system_admin`, `nasq_core.role_pmo_manager`,
   `nasq_core.role_hr_manager` through nasq_core's own model;
3. the `ACCEPT-A-ONLY` / `ACCEPT-B-ONLY` project;
4. the `ACCEPT-A-EMP` / `ACCEPT-B-EMP` HR employee.

It then asserts the created admin actually resolves `pmo.projects.read` and
`hr.employees.read` from `nasq.access.service._nasq_identity(user)` before committing.
No capability check is bypassed.

The seed script travels in `NASQ_ACCEPT_SEED` (an env var) and is `exec`'d by a tiny
stdin stub, so no password ever reaches a command line and no TTY allocation is needed.

Pinned Odoo 19 uses `group_ids` on `res.users`, not `groups_id`.

## Session keys

`NASQ_SESSION_KEYS` is a JSON map of `kid → secret` where each secret is ≥32 bytes.
`NASQ_SESSION_ACTIVE_KID` selects the signing key. The guard's `sessionCodec()` in
`deploy/shared/guard.mjs` validates all keys are strings ≥32 bytes and that the
active kid exists.

Session cookie value format: `base64url(JSON([1,kid,tenantId,registryRevision,exp,sid]))`.`HMAC-SHA256-base64url`

## TLS trust mechanism

Caddy generates an internal CA (`local_certs`). `up.sh` exports the root certificate to
`$TMPDIR_BASE/root.crt` and computes its SPKI SHA-256 pin to `$TMPDIR_BASE/root.spki`.

- **probe.mjs**: Uses `rejectUnauthorized: true` with `ca: readFileSync(root.crt)`
  and `servername` set to the tenant host. This proves the full TLS chain, and reports
  the peer subject / issuer / SAN.
- **proof8.spec.mjs**: Launches Chromium with
  `--ignore-certificate-errors-spki-list=<SPKI>` which pins trust to ONLY this CA, plus
  `--host-resolver-rules` to map the tenant hosts to 127.0.0.1 (no `/etc/hosts` edit).

## The asset-exhaustion variant (finding F4)

`deploy/shared/Caddyfile` keys every non-API path — formerly including the application's own
`/_nuxt/*` build output — to one `nasq_web` bucket of 600 events/minute per client IP.
A single cold `/login` response references 127 `/_nuxt/*` files, so two tenants
cold-loading inside a minute exhausted the bucket and the second tenant received `429`
for its own `.js`/`.css`/font requests. The page then rendered an empty body (white
screen), not a degraded one. That was a production finding, recorded as F4 in
`docs/verification/shared-live-acceptance.md`.

F4 is now fixed directly in `deploy/shared/Caddyfile` by exempting immutable static
asset prefixes (`/_nuxt/*`, `/_i18n/*`, `/i18n/*`, `/fonts/*`, `/favicon.ico`, `/robots.txt`)
from `nasq_web`. The temporary harness-local variant files have been removed, and
`acceptance.Caddyfile` imports the production Caddyfile directly for live reruns.

## Proof map

| # | Proof | Mechanism |
|---|---|---|
| 1 | TLS chain + SAN | `probe.mjs` `rejectUnauthorized:true` against the exported root for A and B; reports subject/issuer/SAN |
| 2 | Host routing / data isolation | `/api/v1/me` login differs per host and `/api/v1/projects` on A never contains B's project |
| 3 | Private headers rejected | `X-Nasq-Proxy-Token` / `X-Nasq-Tenant-Revision` → 403 at the edge |
| 4 | Port isolation | resolved compose `ps` publishers are only 127.0.0.1:443/80; TCP probes to 3000/8069/8072/8080/5432 from the host fail |
| 5 | Session cookie flags | `Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain` (secret redacted) |
| 6 | Cross-tenant cookie | A's cookie on B → 403 and B's cookie on A → 403 |
| 7 | Fail-closed | unknown host → 403; B with `enabled=false` → 403 with no restart, then restored |
| 8 | Browser isolation (fails on the committed Caddyfile due to F4; passes only with the asset-exemption variant) | Playwright: Arabic login, `/`, `/projects`, `/hr` show own markers and never the other tenant's, then logout |
| 9 | Rate limit | >20 `nasq_auth` requests → 429 (runs last: it locks the auth zone) |

## What it does NOT prove

- Public TLS / ACME, DNS, or any production ingress.
- 10 tenants / 90 tenant pairs; MFA; websocket behavior.
- Odoo filestore restore, RPO/RTO, payment, capacity, `non_saas`.
- Independent security review, or production deployment readiness.
