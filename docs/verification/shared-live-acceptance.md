# Shared-mode live acceptance run — evidence record

**Status: 9 of 9 proofs pass against the committed production configuration (r3 rerun, 2026-10-01); F2, F3 and F4 remain verified live; F2b's canonical harness seed/readback and F5's measured page-load/auth-budget isolation are verified live. The control-plane provision worker and populated-avatar budget are not proven by r3.** This document
records local, loopback-only acceptance runs of the two-tenant shared stack, each in a
single isolated Compose project that published only `127.0.0.1:443` and `127.0.0.1:80`
and was removed at the end.

The first run (§1–§8, project `nasq-accept-1790801987`) found proof 8 failing on the
then-committed configuration because of F4. The **r2 rerun (§9)** exercised the fixed
production files with a minimal override set and all nine proofs pass.

Readiness remains `not ready`: this is local runtime evidence for one machine and two
tenants, not production authorization, and it does not satisfy the remaining gates listed
at the end.

## 1. Date, revision and dirty state

| Item | Value |
|---|---|
| Date (UTC) | 2026-09-30 |
| Worktree | `/Users/tariq/code/nasq-shared-acceptance` |
| Branch | `codex/shared-acceptance` |
| HEAD | `28b6c04edc0080f28acabeb83e79ceb3ef1e435a` (28b6c04) |
| Dirty | yes — see below |
| Image tag | `NASQ_IMAGE_TAG=28b6c04` (short HEAD) |

`git status --short` before the run:

```
 M deploy/docker-compose.shared.yml
 M deploy/proxy/Dockerfile
 M deploy/shared/package.test.mjs
 M deploy/test_edge_rate_limit.py
 M docs/verification/2026-09-23-saas-image-preflight.md
 M docs/verification/2026-09-23-saas-p2-edge-routing-g3-g5.md
?? tools/shared_acceptance_live/
```

The worktree is dirty. Six tracked files carry the Stage A work (the v0.1.0
rate-limit pin, the shared-overlay edge ports, and two documentation annotations),
and `tools/shared_acceptance_live/` is new and untracked. Nothing was committed,
merged, stashed or reset by this run. `docs/verification/shared-live-acceptance.md` and
`docs/verification/assets/shared-live-acceptance/` are new and untracked as well.

`git status --short` after the run:

```
 M deploy/docker-compose.shared.yml
 M deploy/proxy/Dockerfile
 M deploy/shared/package.test.mjs
 M deploy/test_edge_rate_limit.py
 M docs/verification/2026-09-23-saas-image-preflight.md
 M docs/verification/2026-09-23-saas-p2-edge-routing-g3-g5.md
?? docs/verification/assets/
?? docs/verification/shared-live-acceptance.md
?? tools/shared_acceptance_live/
```

`deploy/docker-compose.shared.yml` and `deploy/proxy/Dockerfile` are **uncommitted**
work in this worktree. Two findings below are specific to that uncommitted state and
are marked as such; they are not claims about `HEAD`.

## 2. Images built (Stage B)

All four images were built from the repository root with `NASQ_IMAGE_TAG=28b6c04`.
Build logs: `/tmp/nasq-accept-logs/build-{odoo,web,guard,caddy}.log`.

| Image | Image ID | Base image | Build args |
|---|---|---|---|
| `nasq-accept-odoo:28b6c04` | `sha256:538e86e60b091403a265a224aaeeecb22a5bf1651023661d4dfc0cd1db14f91a` | `python:3.12-slim-bookworm` | `ODOO_COMMIT=34eed49d88f0f4357e1f54fe82cb0ad280939572` |
| `nasq-accept-web:28b6c04` | `sha256:1a6c6a8e90a78e234e525eb6103e2d932ffc1fb5499c85c7b527e45eb85c8bf6` | `node:22-alpine` | `NASQ_TENANCY_MODE=shared` |
| `nasq-accept-guard:28b6c04` | `sha256:f01d4a0765ad37217dcb77f274aa7c361c28c539a38242bf3c5c278dc7e636d1` | `node:24.21.0-alpine` | — |
| `nasq-accept-caddy:28b6c04` | `sha256:68ae0c02c14e39391c0e75e456a7f803527c9965191fd5be7a71ee2e9049813e` | `caddy:2.11.4` (overlaid with an xcaddy build of `github.com/mholt/caddy-ratelimit@v0.1.0`) | — |

Only local tags exist; there is no registry push, so no `RepoDigest` from a registry
is available. The digests above are the local image IDs / local repo digests.

```
$ docker run --rm nasq-accept-caddy:28b6c04 caddy list-modules | grep -c '^http.handlers.rate_limit$'
1
```

The pinned `v0.1.0` module is present in the built edge image.

## 3. Exact commands

```bash
# Stage B — build (context = repository root)
docker build -f deploy/odoo/Dockerfile \
  --build-arg ODOO_COMMIT="$(cat deploy/odoo/ODOO_COMMIT)" \
  -t nasq-accept-odoo:28b6c04 .
docker build -f apps/web/Dockerfile --build-arg NASQ_TENANCY_MODE=shared -t nasq-accept-web:28b6c04 .
docker build -f deploy/shared/Dockerfile -t nasq-accept-guard:28b6c04 .
docker build -f deploy/proxy/Dockerfile -t nasq-accept-caddy:28b6c04 .

# Stage C — bring up (one project, published only on 127.0.0.1:443 and 127.0.0.1:80)
NASQ_IMAGE_TAG=28b6c04 bash tools/shared_acceptance_live/up.sh

# Stage D — proofs
node tools/shared_acceptance_live/probe.mjs
cd apps/web && npx playwright test ../tools/shared_acceptance_live/proof8.spec.mjs

# Teardown
bash tools/shared_acceptance_live/down.sh
```

## 4. Product / deployment findings

### F1 — `NASQ_COMMERCIAL_CONFIG` is a hard install-time requirement (product configuration gate)

`nasq_platform`'s tenant-profile `post_init_hook` calls
`commercial_config.load_classification()`, which requires `NASQ_COMMERCIAL_CONFIG` to
be an absolute path to a local, database-bound classification file. A fresh install
without it aborts:

```
File "/opt/nasq/addons/nasq_platform/models/tenant_profile.py", line 195, in create
    classification = load_classification(self.env.cr.dbname, fields.Date.to_date(vals.get('valid_until')))
  File "/opt/nasq/addons/nasq_platform/commercial_config.py", line 37, in load_classification
    raise ValueError(f'nasq commercial config: set {CONFIG_ENV} to an absolute local file')
ValueError: nasq commercial config: set NASQ_COMMERCIAL_CONFIG to an absolute local file
```

This is **not a bug** — it is an intentional operator input. It is recorded here
because it is a deploy-time prerequisite that any shared provisioning path must
satisfy. The harness generates it with the repository's own generator
(`deploy/classification.py fixture`), not by hand, and passes it only to the install
and seeding commands; the steady-state service runs with an empty value, matching the
`unset NASQ_COMMERCIAL_CONFIG` precedent in `.woodpecker.yml`.

### F2 — the committed shared overlay's `odoo` healthcheck can never pass (deployment defect at `HEAD`)

**Status: fixed and VERIFIED LIVE in the r2 rerun (§9)** — `deploy/docker-compose.shared.yml` now overrides the `odoo` healthcheck with a TCP listener probe on port 8069 using `/opt/venv/bin/python`, matching the container image environment (`deploy/odoo/Dockerfile`). The dedicated base file (`deploy/docker-compose.yml`) remains unchanged on `/web/health`. The behavioral test `test_shared_overlay_odoo_healthcheck` in `deploy/test_edge_rate_limit.py` asserts that resolving the base + shared overlay replaces `/web/health` with the TCP socket check while base-only keeps `/web/health`. The acceptance harness's own healthcheck override in `tools/shared_acceptance_live/acceptance.override.yml` has been removed so reruns use the committed overlay configuration.

This one is about committed files, not the dirty worktree. Resolving the committed
base + shared overlay only:

```bash
cd deploy && docker compose -f docker-compose.yml -f docker-compose.shared.yml config
```

yields:

| Service | Healthcheck | depends_on |
|---|---|---|
| `odoo` | `["CMD","/opt/venv/bin/python","-c","import urllib.request; urllib.request.urlopen('http://localhost:8069/web/health', timeout=2)"]` | `db: service_healthy` |
| `guard` | `["CMD","node","deploy/shared/healthcheck.mjs"]` | `odoo: service_healthy`, `web: service_healthy` |
| `proxy` | *(none)* | `guard: service_healthy`, `odoo: service_healthy`, `web: service_healthy` |
| `web` | loopback TCP 3000 (shared overlay correctly replaces the base `/login` check) | `odoo: service_healthy` |

The `odoo` healthcheck is inherited unchanged from `deploy/docker-compose.yml` and
probes `http://localhost:8069/web/health`. In shared mode Odoo runs
`dbfilter=^%h$` with `list_db=False`, and `%h` is the HTTP `Host`; the healthcheck
connects to `localhost`, so no database can be selected and `/web/health` (registered
in `odoo-addons/nasq_platform/models/ir_http.py`) cannot answer successfully. A
container that never becomes healthy makes `guard` and `proxy` — both of which wait
on `odoo: service_healthy` — never start, so the real shared stack would never come up.

The acceptance harness works around this inside
`tools/shared_acceptance_live/acceptance.override.yml` only (TCP-listener check on
8069); **no production file was changed**. This needs a decision in
`deploy/docker-compose.shared.yml`: either define a shared-appropriate `odoo`
healthcheck there, or drop `odoo` from the `service_healthy` conditions.

### F2b — a freshly installed tenant has NO feature policy, so every pillar API 403s `feature_not_included`

**Status: harness path verified live in the r3 rerun (§ r3b); the control-plane provision worker itself is not exercised by the live stack** — shared provisioning now writes and verifies the initial tenant policy itself from the server-derived catalog policy (control-plane `initial_policy` activation gate, revision >= 1, backup/restore carry it), and the live harness seeds through the repository's canonical `deploy/seed_legacy_policy.py` with a readback instead of granting the policy inline. The description below is of the pre-fix state.

Installing the addons on a fresh database leaves `nasq.tenant.profile` at
`policy_revision = 0` with `features = {}`. Nothing in the install path grants the
initial policy, so immediately after a successful install:

```
GET /api/v1/projects
{"code": "feature_not_included", "message": "this feature is not included",
 "details": {"reason": "feature", "feature": "pmo.enabled"}}
```

and the same for `hr.enabled` on `/api/v1/hr/employees`. `/api/v1/me` still answers
(it is not feature-gated), which is why the failure looks like a permissions problem
rather than a policy problem.

The product's own initial grant is
`nasq.tenant.profile._nasq_initialize_legacy_policy(
env['nasq.feature.registry']._nasq_installed_module_ids())`, which is what
`nasq_api/tests/common.py`, the `19.0.1.1.0` post-migration, and the
`nasq_platform` tests all call. This run calls it from the acceptance seed, so it is
recorded as a **provisioning gap in the harness**, not a product bug: any shared
provisioning path must perform the initial policy grant explicitly. It matters
because `_nasq_policy_initialized()` is deliberately a one-shot
(`policy_revision >= 1 and features`), so a tenant that reaches production without
the grant serves 403s for every pillar until an operator notices.

### F3 — `ports: !reset` must not be combined with a replacement list (uncommitted-worktree defect; fixed in the worktree before integration)

**Status: fixed and VERIFIED LIVE in the r2 rerun (§9)** — `deploy/docker-compose.shared.yml` now uses `ports: !override` for the proxy. The behavioral test `test_shared_overlay_resolved_published_ports` in `deploy/test_edge_rate_limit.py` resolves the base + shared overlay with `docker compose config --format json` and asserts the proxy publishes exactly 443/80 (0.0.0.0 by default, 127.0.0.1 when `NASQ_EDGE_BIND` is set) and that guard/odoo/db/web publish nothing; it failed against the `!reset` version and passes now. The description below is of the pre-fix state.

`deploy/docker-compose.shared.yml` currently carries this **uncommitted** change:

```yaml
  proxy:
    ports: !reset
      - "${NASQ_EDGE_BIND:-0.0.0.0}:${NASQ_EDGE_HTTPS_PORT:-443}:443"
      - "${NASQ_EDGE_BIND:-0.0.0.0}:${NASQ_EDGE_HTTP_PORT:-80}:80"
```

`!reset` *replaces* the inherited value with the empty value produced by the tag,
rather than "clear and then apply mine". The resolved configuration therefore has no
proxy ports at all, and the running containers showed `target=443 published=0` with
nothing listening on the host:

```
$ docker compose ... ps --format json   # proxy publishers
[('', 0, 80), ('', 0, 443), ('', 0, 443), ('', 0, 2019)]
$ lsof -iTCP:443 -sTCP:LISTEN -P -n     # (no output)
```

The harness uses `ports: !override` instead, which discards the inherited value and
adopts exactly the listed ports. `!reset` is correct where the intent really is an
empty list (the `guard`/`odoo`/`db` `ports: !reset []` entries at `HEAD`).


### F4 — the committed edge rate limit counts the application's own static assets and can white-screen a tenant (deployment defect at `HEAD`, highest severity here)

**Status: fixed and VERIFIED LIVE in the r2 rerun (§9)** — `deploy/shared/Caddyfile` now exempts immutable static asset prefixes (`/_nuxt/*`, `/_i18n/*`, `/fonts/*`, `/favicon.ico`, `/robots.txt`); the r2 verification against the real built web image showed the app serves only `/_i18n/*` (Nitro route `/_i18n/:hash/:locale/messages.json`) and no `/i18n/*` route, so `/i18n/*` was removed from the exemption and from the test expectations (RED/GREEN), exempting them from the catch-all `nasq_web` rate-limit zone. The auth, API, and Odoo zones are unchanged. Behavioral tests in `deploy/test_edge_rate_limit.py` (`test_shared_caddyfile_rate_limit_exempts_static_assets` via `caddy adapt` in `nasq-accept-caddy:28b6c04`) and `deploy/shared/package.test.mjs` assert that these static paths are excluded from `nasq_web` while auth/API/Odoo matchers remain untouched. The temporary harness-local variant files in `tools/shared_acceptance_live/` have been removed and the harness points directly to the production Caddyfile.

`deploy/shared/Caddyfile` applies one catch-all zone to every non-API path:

```
zone nasq_web {
    match {
        not path /api/auth/* /api/v1/* /web/* /odoo/* /jsonrpc /xmlrpc/* /report/* /mail/* /bus/* /discuss/* /websocket
    }
    key {client_ip}
    events 600
    window 1m
}
```

That list excludes API routes but **not** the application's own build output. A single
cold `/login` HTML response from this build references **127** `/_nuxt/*` files, and the
page additionally loads fonts and `/_i18n/.../ar/messages.json`. `key {client_ip}` is the
edge socket peer, so every request from behind one NAT/corporate proxy/office shares one
600/min bucket.

Measured consequence, unmodified stack, two tenants cold-loading inside a minute:

```
429 GET /_nuxt/rZFYmUyv.js
429 GET /_nuxt/dashboard.B0qIoXNX.css
429 GET /_nuxt/DXkmWWb1.js
429 GET /_nuxt/DqKB1C7M.js
429 GET /projects/dashboard
429 GET /i18n/a6c84b50/ar/messages.json
429 GET /fonts/IBMPlexSansArabic-Regular.woff2
```

The app cannot boot without those files, so the rendered body is empty (`html` length 39):
the tenant gets a **white screen**, not a degraded page. This is not an abuse control
firing on an attacker; it is the product rate-limiting its own asset origin, and the
victim is a normal user who navigated a few pages (or a second user behind the same NAT).

Evidence of both states, same stack, same two tenants:

| Edge config | Browser proof result | 429 count |
|---|---|---|
| `deploy/shared/Caddyfile` (unmodified) | tenant A passes, tenant B white-screens | hundreds, on `/_nuxt/*`, `/fonts/*`, `/_i18n/*` |
| same file with `/_nuxt/* /_i18n/* /fonts/* *.js *.css *.woff2 *.png *.svg` added to that zone's `not path` (harness-local variant only) | **2 passed (32.7s)** | **0** |

Fix direction (not applied — production files were out of scope for this run): exempt
static build output from `nasq_web`, or key the zone per tenant/host rather than per
client IP, or raise the ceiling far above one page's asset count. Simply raising 600 is
not sufficient on its own, because the bucket is shared by all users behind one address.

## 5. Harness defects found and fixed

Every fix is inside `tools/shared_acceptance_live/`; no product or production file was
changed by this run.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| H1 | `all predefined address pools have been fully subnetted` | The host Docker daemon has no free default-pool subnets (all `172.17`–`172.31/16` and most `192.168.x/20` are held by unrelated running projects) | Pin explicit subnets in the acceptance override (`10.240.2/.4/.6/.8 /24`); explicit subnets bypass pool arbitration |
| H2 | `service "proxy" refers to undefined volume tools/...` | `--project-directory <repo-root>` plus a bare relative mount source, which Compose parses as a *named volume* | Run Compose from `deploy/` with no `--project-directory`; the shared overlay's own `./shared/*` mounts then resolve correctly |
| H3 | `odoo_secure.py: error: no such option: -e` | `docker compose run` options placed *after* the service name are forwarded to the container as command arguments | Move every `-e`/`-T`/`--entrypoint` before the service name |
| H4 | `UserError: Invalid language code: ar_001` during seed | A fresh database ships `res.lang` rows but no **active** Arabic; assigning an inactive language to a user makes `project`'s personal-stage onboarding hook raise | Activate the language first (`env['res.lang']._activate_lang('ar_001')`), as the nasq test fixture does |
| H5 | proxy container permanently `unhealthy` (`tlsv1 alert internal error`, `FailingStreak 34`) | A TLS request to the bare loopback IP sends SNI `127.0.0.1`, for which Caddy holds no certificate, so the handshake is aborted; that check can never pass | Caddy-native positive probe: the admin API answers and its live config contains the tenant host, plus `caddy list-modules` contains the pinned `http.handlers.rate_limit` |
| H6 | `up.sh` failed, then `down.sh` could not tear down | The state file was written only by the `ERR` trap, which does not fire when the script's output is piped (`pipefail` is not inherited) | Write the state file as soon as the project has resources, and make `down.sh` supply/derive every variable the overlay requires |
| H7 | `down.sh: DOMAIN: command not found` | The state file stored `DOMAIN=a.accept.nasq.test b.accept.nasq.test` unquoted, so `source` split it | Single-quote every value in the state file; `probe.mjs`/`proof8.spec.mjs` strip one layer of quotes |
| H8 | Seed printed `SEEDED …` but **nothing persisted** (0 users, 0 projects, 0 assignments in both tenant databases) | The `odoo shell` rolls the transaction back on exit unless a commit has already been reached; a single trailing `env.cr.commit()` is not enough — the script prints its result and then persists nothing. Bisected against the live database: identical script with and without per-step commits | Commit explicitly after each created artifact, before the next step and before printing |
| H9 | `edge not answering for a.accept.nasq.test (last=302)` | The readiness loop accepted only 403/200; an unauthenticated but correctly routed request answers 302 → `/login` | Accept any real HTTP status (2xx/3xx/4xx) and keep waiting on `000`/`5xx` |
| H10 | Browser proof: `net::ERR_CERT_AUTHORITY_INVALID` despite the SPKI argument | Chromium's `--ignore-certificate-errors-spki-list` matches the SPKI of the certificate that carries the error (the leaf); pinning the Caddy **root** does not authorize a leaf issued by the intermediate. Verified directly: pin-only fails, pin + `ignoreHTTPSErrors` succeeds | Browser context uses `ignoreHTTPSErrors`, so the browser proof (8) does **not** demonstrate TLS trust; TLS chain trust is proven by `probe.mjs` only (strict CA validation) |
| H11 | Browser proof: tenant B failed only when run after tenant A, while passing alone | Every acceptance request arrives from `127.0.0.1`, so all tenants share one `nasq_auth` bucket (20 events/min). A full two-tenant run consumes most of the window, so the second tenant's login gets a 429 and the login page body is empty | The login step retries against the rate-limit window and records each attempt's status; a definitive run starts from a drained window |
| H13 | Browser proof: tenant B white-screened with `429` on its own `/_nuxt/*` assets | Finding F4: the committed catch-all zone counts static assets (127 per cold page) against one shared 600/min per-client-IP bucket | Not fixed in production (out of scope): recorded as F4, and the isolation assertions re-proved with a harness-local variant that exempts static assets. Findings must be fixed in `deploy/shared/Caddyfile` |
| H12 | Browser proof: `POST /web/session/get_session_info` 403 on every page (console noise) | `apps/web/app/composables/useBus.ts:164` requests that route to learn the websocket worker version. The shared guard admits `/web/session/*` only on the private BFF hops (`guard.mjs:63`, `internal && ['/web/session/authenticate','/web/session/destroy']`), so the browser's own request is denied by design and `useBus.ts` falls back with a one-time warning. The pages still render correctly | Recorded as an observation with the caller identified. Not a leak and not a blocker for this run, but the UI should not issue a request the shared boundary always rejects |

## 6. Proof results

See the table in §7. Each proof records PASS or FAIL with raw evidence; **for the first
run**, 8 of 9 pass on the then-committed configuration and proof 8 fails (F4). A FAIL is
reported as a FAIL. The r2 rerun in §9 re-proves all nine against the fixed committed
configuration.

## 7. Proof table (9 proofs)

| # | Proof | Result | Raw evidence |
|---|---|---|---|
| 1 | TLS chain verifies against the exported root, SAN = host, both hosts | **PASS** | `probe.mjs` with `rejectUnauthorized: true` + `ca=root.crt`: A `issuerCN="Caddy Local Authority - ECC Intermediate"` `SAN="DNS:a.accept.nasq.test"` `sanMatchesHost=true` `status=302` `validFrom=Sep 30 21:01:05 2026 GMT validTo=Oct 1 09:01:05 2026 GMT`; B likewise with `SAN="DNS:b.accept.nasq.test"`. OpenSSL therefore accepted the full chain up to the exported root. |
| 2 | Each host's data belongs to its own DB only | **PASS** | `/api/v1/me` A(200) `login=admin@a.accept.nasq.test`; B(200) `login=admin@b.accept.nasq.test`. `/api/v1/projects` A=`["ACCEPT-A-ONLY"]` B=`["ACCEPT-B-ONLY"]`. `/api/v1/hr/employees` A=`["ACCEPT-A-EMP","Administrator"]` B=`["ACCEPT-B-EMP","Administrator"]`. Neither list contains the other tenant's marker. |
| 3 | Private headers from outside return 403 | **PASS** | `X-Nasq-Proxy-Token: leaked` → `403`; `X-Nasq-Tenant-Revision: leaked` → `403` (rejected at the edge, `deploy/shared/Caddyfile` `respond @private 403`). |
| 4 | Only 127.0.0.1:443/80 published; web/Odoo/guard/db unreachable from host | **PASS** | `docker inspect .NetworkSettings.Ports` for every project container: `proxy-1` = `443/tcp → 127.0.0.1:443`, `80/tcp → 127.0.0.1:80`; `guard-1 8080/tcp: null`, `web-1 3000/tcp: null`, `odoo-1 8069/8072: null`, `db-1 5432/tcp: null`. `leakedForbidden=[]`, `nonLoopbackBindings=[]`. |
| 5 | Session cookie: Secure, HttpOnly, SameSite=Lax, no Domain | **PASS** | 4 `session_id` Set-Cookie headers, each `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`, none carrying `Domain=`. |
| 6 | A's cookie on B rejected, and vice versa | **PASS** | A's cookie to `b.accept.nasq.test/api/v1/me` → `403 tenant_boundary_rejected`; B's cookie to `a.accept.nasq.test/api/v1/me` → `403 tenant_boundary_rejected`. |
| 7 | Unknown host rejected; disabled host fail-closed without restart | **PASS** | `unknown.accept.nasq.test` → TLS session aborted by the edge (no certificate for that SNI; connection error, fail-closed). Then the registry was rewritten with B `enabled=false` + bumped `registryRevision`/`snapshotRevision` (atomic rename into the read-only directory mount): B `/api/v1/me` → `403`. **No container was restarted** — the guard re-reads the registry per request. Restoring the original snapshot returned B to `200` (also without a restart). |
| 8 | Real browser: Arabic UI, `/`, `/projects`, `/hr`, own markers only, logout | **FAIL on committed config (F4); passes 2/2 only with harness-local asset exemption** | Tenant B white-screened with 429 on its own assets against the committed Caddyfile. See §7a. |
| 9 | Exceeding `nasq_auth` returns 429 | **PASS** | `429` returned on the 19th rapid `POST /api/auth/login` (`nasq_auth` zone is `events 20 / window 1m`). Run last so it cannot lock the other proofs. |

### 7a. Proof 8 detail — and finding F4

Run twice, deliberately:

**(a) Unmodified stack — FAILS, and this is finding F4.** With two tenants cold-loading
inside one minute, tenant B received `429` for its own static assets:

```
429 GET /_nuxt/rZFYmUyv.js
429 GET /_nuxt/dashboard.B0qIoXNX.css
429 GET /_nuxt/DXkmWWb1.js
429 GET /i18n/a6c84b50/ar/messages.json
429 GET /projects/dashboard
```

The body then rendered empty (`html` length 39) — a white page, not a degraded one.
`deploy/shared/Caddyfile` keys every non-API path, including the application's own
assets, to one `nasq_web` bucket of **600 events/minute per client IP**. A single cold
`/login` response already references **127** `/_nuxt/*` files, so one tenant
login→dashboard cycle plus a second tenant's cold load exceeds 600/min. In production
every request from behind one NAT/corporate proxy/office shares that bucket, so this is
a self-inflicted denial of service on the application's own asset origin, not an abuse
control. This is F4 below.

**(b) Same stack, static assets exempt from the zone — PASSES.** The harness mounts
`tools/shared_acceptance_live/acceptance.assets-exempt.Caddyfile`, identical except the
`nasq_web` zone's `not path` list also excludes `/_nuxt/* /_i18n/* /fonts/*
/favicon.ico *.js *.css *.woff2 *.png *.svg`. Nothing else changes: guard, TLS, tenancy,
cookies and the API zones are untouched. Result: **2 passed (32.7s)**, `429` count `0`,
each tenant reaching `/projects/dashboard` on the first login attempt and then rendering

| Tenant | `/` | `/projects` | `/hr` | logout |
|---|---|---|---|---|
| A | own marker, no B marker, Arabic, screenshot `a-index.png` | `ACCEPT-A-ONLY`, no B marker, `a-projects.png` | `ACCEPT-A-EMP`, no `ACCEPT-B-EMP`, `a-hr.png` | `POST /api/auth/logout` → `204`, session cleared, `/projects` → `/login` |
| B | own marker, no A marker, Arabic, `b-index.png` | `ACCEPT-B-ONLY`, no A marker, `b-projects.png` | `ACCEPT-B-EMP`, no `ACCEPT-A-EMP`, `b-hr.png` | `204`, session cleared, `/login` |

The screenshots were inspected: tenant A's dashboard shows only `ACCEPT-A-ONLY`, and
tenant B's `/projects` and `/hr` show only `ACCEPT-B-ONLY` / `ACCEPT-B-EMP`. The Arabic
UI is confirmed (`html dir="rtl"`, `دليل الموظفين`, `كل المشاريع`).

The variant is a **harness-local file**; no repository Caddyfile was modified. The hot
reload used the running Caddy's own admin API, and the original acceptance Caddyfile was
reloaded afterwards (`_nuxt` absent from the live config again).

The second finding from this proof: every page load issues
`POST /web/session/get_session_info` and receives `403` (see H12). The pages still work,
so it is recorded as an observation, not a blocker.

## 8. Raw probe output

Run at 2026-09-30 21:23 UTC against project
`nasq-accept-1790801987` (`probe.mjs`, exit code 0):

```
[PASS] tls-chain-a.accept.nasq.test: subjectCN="(none)" issuerCN="Caddy Local Authority - ECC Intermediate" SAN="DNS:a.accept.nasq.test" sanMatchesHost=true chainVerifiedByOpenSSL=true intermediatePresent=false status=302 validFrom=Sep 30 21:01:05 2026 GMT validTo=Oct  1 09:01:05 2026 GMT fingerprint256=2E:25:C3:B6:19:EE:09:50…
[PASS] tls-chain-b.accept.nasq.test: subjectCN="(none)" issuerCN="Caddy Local Authority - ECC Intermediate" SAN="DNS:b.accept.nasq.test" sanMatchesHost=true chainVerifiedByOpenSSL=true intermediatePresent=false status=302 validFrom=Sep 30 21:01:05 2026 GMT validTo=Oct  1 09:01:05 2026 GMT fingerprint256=8D:B5:A4:75:FB:8A:0C:86…
[PASS] host-data-isolation: meA(200) login=admin@a.accept.nasq.test company={"id":1,"name":"My Company"} | meB(200) login=admin@b.accept.nasq.test company={"id":1,"name":"My Company"} | projectsA=["ACCEPT-A-ONLY"] projectsB=["ACCEPT-B-ONLY"] | hrA=["ACCEPT-A-EMP","Administrator"] hrB=["ACCEPT-B-EMP","Administrator"]
[PASS] private-header-X-Nasq-Proxy-Token: status=403
[PASS] private-header-X-Nasq-Tenant-Revision: status=403
[PASS] port-isolation: hostBindings=[{"container":"nasq-accept-1790801987-proxy-1","containerPort":"443/tcp","hostIp":"127.0.0.1","hostPort":443},{"container":"nasq-accept-1790801987-proxy-1","containerPort":"80/tcp","hostIp":"127.0.0.1","hostPort":80}] leakedForbidden=[] nonLoopbackBindings=[] requiredPortsPresent=true
[PASS] session-cookie-flags: count=4 [{"secure":true,"httpOnly":true,"sameSiteLax":true,"noDomain":true,"line":" Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"},{"secure":true,"httpOnly":true,"sameSiteLax":true,"noDomain":true,"line":" Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"},{"secure":true,"httpOnly":true,"sameSiteLax":true,"noDomain":true,"line":" Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"},{"secure":true,"httpOnly":true,"sameSiteLax":true,"noDomain":true,"line":" Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600"}]
[PASS] cross-tenant-cookie: cookieA→B status=403 cookieB→A status=403 bodyAonB=tenant_boundary_rejected
[PASS] unknown-host-fail-closed: connection refused: error=write EPROTO 80BF3FF801000000:error:0A000438:SSL routines:ssl3_read_bytes:tlsv1 alert internal error:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:918:SSL alert number 80

[PASS] disabled-host-fail-closed: after enabled=false + snapshotRevision/snapshotRevision bump, B status=403; observed without restarting any container
[PASS] registry-restored: original snapshot restored; B status=200
[PASS] rate-limit-429: 429 after 19 auth requests (last status=429)

Results written to /Users/tariq/code/nasq-shared-acceptance/tools/shared_acceptance_live/probe-results.json

=== 12/12 proofs PASSED ===
```

(That harness summary counts probe checks only; it does not include proof 8 against the committed configuration, which failed — see §7a.)


## 9. Rerun r2 — committed configuration, minimal overrides (2026-10-01)

Second live run against the **committed production config** with the harness diverging
from production only where the host forces it. Project `nasq-accept-1790805359`, torn
down by exact name at the end; nothing else on the host was touched.

### 9a. Overrides remaining in `acceptance.override.yml` (each with its justification)

| Override | Justification (host forces it) |
|---|---|
| image tags (`nasq-odoo/web/guard/accept-caddy:${NASQ_IMAGE_TAG}`) | images are built locally per run with an `-r2` tag; no registry exists |
| proxy `ports: !override` → `127.0.0.1:443/80` | loopback-only binding; the shared overlay's own `!override` 443/80 list is production behavior, only the bind IP differs |
| proxy `DOMAIN: "a.accept.nasq.test b.accept.nasq.test"` | the acceptance tenant hosts replace the operator's real domain |
| Caddyfile mounts (acceptance.Caddyfile + production.Caddyfile) | `acceptance.Caddyfile` only adds `local_certs`/`skip_install_trust` and `import`s the production file; verified by `caddy adapt`: handler set identical to production (`rate_limit`, `reverse_proxy`, `static_response`, `subroute`), the same 4 `nasq_*` zones each once, **no extra route and no extra rate-limit rule** |
| proxy healthcheck (base/shared define none) | Caddy image ships no curl/node; Caddy-native positive check on the admin-API live config + `caddy list-modules` rate_limit |
| odoo `NASQ_COMMERCIAL_CONFIG: ""` + secret/config mounts | install-time classification file is a disposable generated secret kept off Git and off command lines (F1); steady state runs empty like CI |
| explicit subnets `10.240.2/4/6/8.0/24` | host Docker pool exhaustion (H1); explicit subnets need no pool arbitration |

Removed in r2: the `web` healthcheck override and the `web` `depends_on: !reset`.
The committed ordering is `web (odoo: service_healthy, base) → guard (odoo+web
healthy) → proxy (guard healthy)` with the shared overlay's own web TCP-3000
healthcheck. Resolved `docker compose config` (captured during the run):

| Service | healthcheck | depends_on |
|---|---|---|
| db | `pg_isready -U odoo` | — |
| odoo | TCP connect 8069 (F2 fix) | db: service_healthy |
| web | loopback TCP 3000 (shared overlay) | odoo: service_healthy |
| guard | `deploy/shared/healthcheck.mjs` | odoo+web: service_healthy |
| proxy | admin-API config + rate_limit module | guard+odoo+web: service_healthy |

The committed ordering did **not** deadlock: `up.sh` reported db → odoo → web → guard
→ proxy all `healthy` in order, and `docker compose ps` showed every service healthy
with only the proxy publishing `127.0.0.1:80/443`. **No production finding from the
committed ordering.**

### 9b. Images built (tag `28b6c04-r2`)

All four were rebuilt (build logs `/tmp/nasq-accept-logs/build-*-r2.log`); the
Caddyfile/compose are bind-mounted at runtime, but rebuilding removed any ambiguity
about the r1 images' build args:

| Image | ID |
|---|---|
| `nasq-odoo:28b6c04-r2` | `sha256:80d4d94621c687ab190e522ff23550090e251773412f39a71100eb39650f2810` |
| `nasq-web:28b6c04-r2` | `sha256:629347b1b992b83516c779fa7a52b0fd72a45ad5ace8b05187edf5dfe1e5df0d` |
| `nasq-guard:28b6c04-r2` | `sha256:f941dfb7df5a13e52c82023ade45b88efca0b41e1e43a0740a99a709a908b6f7` |
| `nasq-accept-caddy:28b6c04-r2` | `sha256:148b2c09f91476d586f276656f2ad7967394fa38e10b5de6f982321b4e03d0f1` |

`docker run nasq-accept-caddy:28b6c04-r2 caddy list-modules | grep -c '^http.handlers.rate_limit$'` → `1`.

### 9c. F4 asset-prefix verification against the real built web image

`docker run --rm --entrypoint sh nasq-web:28b6c04-r2` over `/app/.output/public` and
the server chunks:

| Prefix | Served? | Evidence |
|---|---|---|
| `/_nuxt/*` | yes (static) | `.output/public/_nuxt/**` (JS/CSS + `builds/*.json`) |
| `/_i18n/*` | yes (dynamic Nitro route) | server registers `/_i18n/:hash/:locale/messages.json` (`nitro.mjs`); client bundle fetches `/_i18n/${hash}/${locale}/messages.json` |
| `/i18n/*` | **no** | nothing under `.output/public` and no route references it; removed from the Caddyfile exemption and from both test expectations (RED first: `pytest test_shared_caddyfile_rate_limit_exempts_static_assets` and `node --test shared/package.test.mjs` both failed; GREEN after the Caddyfile edit: 6 passed / 5 passed) |
| `/fonts/*` | yes | `.output/public/fonts/*.woff2` |
| `/favicon.ico`, `/robots.txt` | yes | both files in `.output/public` |

Routing check: `guard.mjs` routes to Odoo only `/api/v1/*`, `/web/content/*`,
`/websocket`, the two image shapes and internal `/web/session/{authenticate,destroy}`;
none of the exempted prefixes is routed to Odoo or an API (IMAGE-ROUTES.md covers only
the two `/web/image` shapes). All exempted prefixes fall through to the Nuxt app.

### 9d. Proof table (r2)

| # | Proof | Result | Evidence |
|---|---|---|---|
| 1 | TLS chain, SAN per host | **PASS** | `probe.mjs` strict CA: A/B SAN `DNS:{a,b}.accept.nasq.test`, `sanMatchesHost=true`, status 302 |
| 2 | Per-host data isolation | **PASS** | `/api/v1/me` logins differ; projects A=`["ACCEPT-A-ONLY"]` B=`["ACCEPT-B-ONLY"]`; HR likewise |
| 3 | Private headers 403 | **PASS** | `X-Nasq-Proxy-Token` / `X-Nasq-Tenant-Revision` → 403 |
| 4 | Port isolation | **PASS** | only `proxy-1` publishes `127.0.0.1:443/80`; guard/web/odoo/db `null`; leaked/nonLoopback empty |
| 5 | Cookie flags | **PASS** | 4× `HttpOnly; Secure; SameSite=Lax`, no `Domain=` |
| 6 | Cross-tenant cookie 403 | **PASS** | A→B and B→A `403 tenant_boundary_rejected` |
| 7 | Fail-closed host / disabled tenant | **PASS** | unknown host TLS-aborted; B `enabled=false` → 403 with no restart; restored → 200 |
| 8 | Browser isolation (committed Caddyfile, no harness asset variant) | **PASS** | `2 passed (1.7m)`; A's first login hit `nasq_auth` 429 (window still locked from `probe.mjs` proof 9) and retried, then landed; **zero 429 on any page asset**; screenshots refreshed |
| 9 | `nasq_auth` 429 | **PASS** | probe: 429 after 19 auth requests; negative re-check below |

Repeated A/B (proof 8 ×2, same client IP, within ~1 minute): `--repeat-each=2` →
**4 passed (1.1m)**, order A,B,A,B, all four logins landed on the first attempt, no
asset 429s — approximating a shared NAT. Negative check: 25 rapid `POST /api/auth/login`
from one client → `200×8` then `429×17` through attempt 25, so auth limiting is intact.

### 9e. New observations from r2

- **F5 (fixed in source; measured-page-load isolation verified live in r3; low–medium): page loads consumed the shared auth rate limit, not the `nasq_odoo` budget.** During the repeated A/B run's 4th pass, `POST /web/session/get_session_info` returned `429` twice. **Correction to the cause first recorded here:** those `429`s came from `nasq_auth` (20 events/min per client IP), because the auth zone matched `/web/session/*` and therefore counted the browser's websocket version probe as a credential request; they were **not** `nasq_odoo` (600/min) exhaustion. Every page load issues that H12 call, so ordinary multi-page traffic from one shared-NAT IP drained the budget that logins need. Fixed in source by moving `get_session_info` into `nasq_odoo` by exact path and giving ACL-checked image bytes their own `nasq_odoo_image` zone (1200/min); the budget arithmetic is in `deploy/shared/README.md`. Pages still rendered throughout (the caller falls back). r3 measured 30 real page loads with zero image/probe 429s and a first wrong-login 429 at attempt 21 (§ r3d); populated-avatar budget remains unmeasured.
- **H14 (harness):** `up.sh` validated the odoo uid against `nasq-accept-odoo:` while the compose files resolve `nasq-odoo:` — fixed so the validator uses the same tag set.

F2b (initial feature policy) was **fixed in source** and its canonical harness
seed/readback is **verified live in r3** (§ r3b); the control-plane provision
worker's activation gate is a separate path not exercised by this stack.

### 9f. Teardown verification

`down.sh` ran; then: `docker ps -a` / networks / volumes filtered on
`nasq-accept-1790805359` → 0 containers, 0 networks, 0 volumes; `lsof -iTCP:443/80`
empty (ports free); unrelated running projects untouched. Images kept (nothing
removed, no prune): the four `*:28b6c04-r2` images plus the earlier `*:28b6c04` /
`nasq-accept-*:28b6c04` images and all pre-existing unrelated images.

`git status --short` after r2 keeps the same modified/untracked sets as §1 plus the
edits described above; nothing was committed, merged, pushed, stashed or reset.

## Rerun r3 — F2b canonical policy seed and F5 live budget isolation (2026-10-01)

### r3a. Scope, revision and images

- Worktree `/Users/tariq/code/nasq-integration-r3`, branch
  `codex/integration-f2b-f5-gate`, tip
  `9fc26f38be068e042389a9f6d519f6f8165102b1`; initially clean.
- Date UTC: 2026-10-01. One isolated project `nasq-accept-1790852898`;
  only `127.0.0.1:443/80` published. No host PostgreSQL or `odoo19` access.
- **No image rebuild was necessary.** Runtime Dockerfile/COPY inputs are unchanged
  from the r2 committed baseline `329ef573` (checked with `git diff --name-only
  329ef573 HEAD -- apps/web packages/contracts odoo-addons deploy/odoo deploy/security
  deploy/shared/guard.mjs deploy/shared/start.mjs deploy/shared/healthcheck.mjs
  deploy/shared/Dockerfile deploy/proxy/Dockerfile`: empty). The Caddyfile is mounted;
  control-plane changes are not in this stack. The r2 images were retagged, not replaced.

| r3 tag | Local image ID (unchanged from r2) |
|---|---|
| `nasq-odoo:9fc26f3-r3` | `sha256:80d4d94621c687ab190e522ff23550090e251773412f39a71100eb39650f2810` |
| `nasq-web:9fc26f3-r3` | `sha256:629347b1b992b83516c779fa7a52b0fd72a45ad5ace8b05187edf5dfe1e5df0d` |
| `nasq-guard:9fc26f3-r3` | `sha256:f941dfb7df5a13e52c82023ade45b88efca0b41e1e43a0740a99a709a908b6f7` |
| `nasq-accept-caddy:9fc26f3-r3` | `sha256:148b2c09f91476d586f276656f2ad7967394fa38e10b5de6f982321b4e03d0f1` |

Remaining overrides are exactly §9a with r3 image tags: loopback edge ports,
acceptance domains, the local-CA wrapper importing the committed production
Caddyfile (no route/rate-rule variant), proxy admin-API/module healthcheck,
external Odoo config/classification mounts with empty steady-state classification,
and explicit `10.240.2/4/6/8.0/24` subnets. Odoo/web healthchecks and dependency
ordering remain the committed ones. Live `caddy list-modules` contains
`http.handlers.rate_limit`; the mounted production file defines five zones in r3,
including the new `nasq_odoo_image` (1200/min), with `nasq_auth` still 20/min.

### r3b. Up attempt, harness changes and F2b readback

`NASQ_IMAGE_TAG=9fc26f3-r3 bash tools/shared_acceptance_live/up.sh` succeeded on
**one attempt**. db → odoo → web → guard → proxy all healthy; strict-root-CA
routed readiness A/B each 302. No production file changed for this rerun.

Uncommitted tooling changes:

| File under `tools/shared_acceptance_live/` | Purpose |
|---|---|
| `up.sh` | Export the seed password and pass `-e NASQ_ACCEPT_ADMIN_PASSWORD` by name, not expanded secret bytes in Docker argv; inherit the seed script by name too. |
| `probe.mjs` | Add `--skip-rate-limit` and `--rate-limit-only` so proof 9 genuinely runs last without locking proof 8; separate result file for rate-only run. |
| `.gitignore` | Ignore the rate-only result file. |
| `README.md` | Document deferred proof 9 and the optional F5 measurement command. |
| `f5-measure.mjs` | Real Chromium page-load/status/request-count evidence, raw HTTPS bypass requests, and immediate wrong-login burst; no credentials/cookies logged. |

`up.sh` piped the unchanged **`deploy/seed_legacy_policy.py`** into `odoo shell`
for each database before fixture seeding, then independently read back and asserted
revision 1 and both `pmo.enabled`/`hr.enabled` true. Fresh live output (no secret values):

```text
legacy policy initialized: 1 [('chat.enabled', True), ('hr.enabled', True), ('meetings.enabled', True), ('pmo.enabled', True), ('projects.max_projects', None), ('storage.limit_mb', None), ('users.limit', None)]
legacy policy initialized: 1 [('chat.enabled', True), ('hr.enabled', True), ('meetings.enabled', True), ('pmo.enabled', True), ('projects.max_projects', None), ('storage.limit_mb', None), ('users.limit', None)]
initial policy verified: db=nasq_accept_a_scratch revision=1 features=7
initial policy verified: db=nasq_accept_b_scratch revision=1 features=7
Initial tenant policy verified.
```

Search of harness `*.sh`, `*.py`, `*.mjs` for `_nasq_initialize_legacy_policy`
returned **no matches**. F2b's **canonical harness seed/readback is verified live**;
this stack does not run the control-plane provision worker or its activation gate,
so this is not a live proof of that separate control-plane path.

### r3c. Nine-proof table

| # | Proof | Result | Fresh evidence |
|---|---|---|---|
| 1 | Strict TLS chain and host SAN | **PASS** | A/B strict exported-root CA, SAN `DNS:{a,b}.accept.nasq.test`, matching host, 302; issuer Caddy ECC Intermediate. |
| 2 | Host/data isolation | **PASS** | `/me` 200 with distinct admin logins; projects only `ACCEPT-A-ONLY` / `ACCEPT-B-ONLY`; HR only own employee plus Administrator. |
| 3 | Private headers rejected | **PASS** | Proxy-token and tenant-revision headers each 403. |
| 4 | Port isolation | **PASS** | Only proxy publishes loopback 443/80; forbidden/non-loopback bindings empty. No host-5432 probe. |
| 5 | Session cookie flags | **PASS** | Four headers: Secure, HttpOnly, SameSite=Lax, no Domain; cookie bytes omitted. |
| 6 | Cross-tenant cookies | **PASS** | A→B and B→A 403 `tenant_boundary_rejected`. |
| 7 | Fail closed without restart | **PASS** | Unknown host TLS aborted; disabled B 403, restored B 200; no restart. |
| 8 | Real Chromium A/B Arabic pages and logout | **PASS** | `2 passed (34.3s)`; both first login attempts 200; own markers on `/`, `/projects`, `/hr`, other markers absent; logout 204 → `/login`. No asset 429. Screenshots in ignored r3 evidence directory. |
| 9 | Auth limiter | **PASS** | Measurement burst: wrong logins 1–20 = 401, 21–25 = 429. Final `probe.mjs --rate-limit-only` = 1/1 pass, 429 on its first request because the measurement already exhausted the zone; not a fresh onset measurement. |

Exact execution order from repo root:

```sh
node tools/shared_acceptance_live/selfcheck.mjs
NASQ_IMAGE_TAG=9fc26f3-r3 bash tools/shared_acceptance_live/up.sh
node tools/shared_acceptance_live/probe.mjs --skip-rate-limit
NASQ_SCREENSHOT_DIR=/Users/tariq/code/nasq-integration-r3/tools/shared_acceptance_live/test-results/r3/screenshots npx playwright test --config /Users/tariq/code/nasq-integration-r3/tools/shared_acceptance_live/playwright.config.mjs
node tools/shared_acceptance_live/f5-measure.mjs
node tools/shared_acceptance_live/probe.mjs --rate-limit-only
bash tools/shared_acceptance_live/down.sh
```

All above exited 0. Selfcheck 12 checks; non-rate probe 11/11; browser 2/2;
F5 aggregate passed; rate-only probe 1/1. `bash -n up.sh`, `node --check probe.mjs`,
`node --check f5-measure.mjs`, and `git diff --check` also passed.

### r3d. F5 measurements (a)–(d)

One loopback client IP, **one authenticated session per tenant** retained throughout
measurement; separate Chromium cookie jars, full navigations, no synthetic asset
fetches or omitted page assets. Session setup/bypass checks preceded a 65-second
auth-window drain. 15 loads per tenant, 10 per path, **30 loads in 28.988 seconds**.
All loads rendered their own fixture markers and remained authenticated. `/`
redirects to `/projects/dashboard` (302 → 200), and counts as one requested load.

| Requested page | Loads | `get_session_info` | `/web/image/*` | `/web/binary/company_logo` | Browser `/api/v1/*` | `/_nuxt/*` observed responses | Avatar requests/load | Logo requests/load |
|---|---:|---|---:|---|---:|---|---:|---:|
| `/` | 10 | 403×10 | 0 | 200×2 + 304×8 | 0 | 200×1862; 1 response unobserved | 0 | 1 |
| `/projects` | 10 | 403×10 | 0 | 304×10 | 0 | 200×1883 | 0 | 1 |
| `/hr` | 10 | 403×10 | 0 | 304×10 | 0 | 200×1771 | 0 | 1 |
| **Total** | **30** | **403×30; 429×0** | **0 requests; 429×0** | **200×2 + 304×28; 429×0** | **0 browser requests** | **200×5516; 429×0 observed** | **0** | **1** |

The one unobserved Nuxt response was A's initial
`/_nuxt/builds/meta/3897a01d-2d50-4dd8-ac72-439125b50b3e.json`; it is **not**
claimed as 200. Browser `/api/v1/*` is zero because these full navigations render
the fixture data through SSR; private BFF/SSR traffic is not included in browser
response counts. Favicon requests were zero in the measured browser traffic.
H12 still holds: the guard denies the websocket version probe with 403, and the UI
falls back. F5 fixes the **budget classification**, not that route's availability.

Actual image arithmetic is materially lower than the README's unmeasured
~2 logo/favicon + ~10 avatars: **one logo and zero avatar requests/load**, using
initials/no avatar-image fixtures. At 60 loads/min that is 60 image requests/min
(not the assumed 720) and 60 version probes/min, below 1200/600. The README numbers
are **not empirically confirmed** by this sparse fixture; a populated avatar-grid
budget/capacity test remains needed. No Caddyfile edit was made. The live logo zone
and zero image/probe 429 expectation pass for the traffic actually produced.

Bypass checks used raw Node HTTPS request paths with strict root CA and authenticated
cookies; no client URL dot-segment normalization. They ran **before** the drain and
wrong-login burst so no auth 429 could conceal access to a credential endpoint.

| Raw GET path | A | B | Credential access |
|---|---:|---:|---|
| `/web/session/get_session_info/../authenticate` | 403 | 403 | Denied: `tenant_boundary_rejected`. |
| `/WEB/session/get_session_info` | 404 | 404 | No credential handler response. |
| `/web%2Fsession%2Fget_session_info` | 404 | 404 | No credential handler response. |

**Immediately after the 30 loads** (recorded gap 0 ms), same IP, 25 sequential rapid
`POST /api/auth/login` calls with wrong credentials: **401×20 then 429×5**, first 429
**attempt 21**. No intervening requests and no reauthentication occurred. Thus these
page loads did not consume the drained 20/min auth allowance. F5's live budget
isolation is verified within this measured scope, not a production capacity claim.

### r3e. Teardown and retained artifacts

`down.sh` exited 0 for **`nasq-accept-1790852898` only**, removed its five containers,
four networks, three named volumes, temporary secret directory and `.state`.
Compose emitted two harmless `DB_PASSWORD` unset/interpolation warnings during
`down` (no value printed); teardown still succeeded.

Post-teardown project-label queries returned **0 containers, 0 networks, 0 volumes**.
`lsof -nP -iTCP:443 -iTCP:80 -sTCP:LISTEN` had no listeners (exit 1 = no match).
Sorted pre/post inventories of all container IDs, running IDs, volume names and
network IDs/names compare **identically**. Every pre-existing image tag/ID remains
unchanged; the only image inventory additions are the four r3 tags. No prune, image
removal, hosts/trust-store change, commit, merge, push, stash or reset occurred.

Raw non-secret logs, F5 JSON, six screenshots and baseline/after inventories are in
`tools/shared_acceptance_live/test-results/r3/` (gitignored); passwords/cookies were
never written there. `git status --short` after documentation:

```text
 M docs/verification/shared-live-acceptance.md
 M tools/shared_acceptance_live/.gitignore
 M tools/shared_acceptance_live/README.md
 M tools/shared_acceptance_live/probe.mjs
 M tools/shared_acceptance_live/up.sh
?? tools/shared_acceptance_live/f5-measure.mjs
```

All changes remain **uncommitted** for coordinator review. Readiness is still
**`not ready`**; the not-proven list below is unchanged.

## 10. What this does NOT prove

- **Public TLS / ACME.** The edge uses Caddy `local_certs` with an internal CA and
  binds only to `127.0.0.1`; no ACME, no public issuance.
- **DNS.** No real name resolution is exercised: the probes map the tenant hosts to
  `127.0.0.1` via a custom lookup / `--host-resolver-rules`, and `/etc/hosts` and the
  system trust store were not modified.
- **10 tenants / 90 pairs.** This run has exactly two tenants and two hosts.
- **MFA.** The TOTP path is installed but not exercised end to end.
- **Websocket.** `/websocket` is routed but not exercised; no WS session was upgraded.
- **Odoo filestore restore.** No backup, restore or filestore verification was run.
- **RPO/RTO.** Not measured.
- **Payment.** No billing, checkout or control-plane connection was exercised.
- **Capacity / performance.** No load, throughput or latency measurement.
- **`non_saas`.** This run classifies both tenants as `saas`; the independent-install
  lane was not exercised.
- **Independent security review.** None was performed.
- **Production deploy.** Nothing was pushed, deployed or promoted; no image left this
  machine.

## 11. Readiness

**Readiness remains `not ready`.** The r3 rerun produced local runtime evidence that
all nine proofs pass against the committed configuration (F2, F3 and F4 verified live;
F2b's canonical harness seed/readback and F5's measured page-load/auth-budget
isolation now also verified live — see the r3 section above). It still does not close
the remaining gates: independent security review, real DNS and public TLS/ACME, MFA
and websocket behavior, filestore restore, RPO/RTO, capacity, payment, `non_saas`,
and the tenant-scale matrix. Still not exercised live: the control-plane provision
worker's `initial_policy` activation gate, and the image budget under a populated
avatar workload. Readiness stays `not ready`.
