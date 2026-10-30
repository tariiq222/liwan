# T6 independent isolation evidence — NOT stage acceptance

Workspace: `/Users/tariq/code/nasq-shared-isolation`, branch `codex/shared-isolation`, baseline d780862e. Existing dirty implementation preserved. Only this directory was changed by verification. No commit/merge/push/deploy/delete, Docker, PostgreSQL, real Odoo or odoo19 execution occurred.

## Verdict: blocked / needs revision

Green mock checks do not accept operational isolation. One new reproducible customer regression and the previously disclosed build/runtime mismatch remain. Durable shared worker, registry publishing/fencing and real Odoo database/filestore evidence are absent.

### Findings

**T6-F01 — high, dedicated-built/shared-runtime proxy mismatch (confirmed config replay; inherited t5 blocker).** `apps/web/nuxt.config.ts:4-7,85-100` evaluates tenancy mode while constructing static routeRules; `apps/web/server/utils/tenantRequest.ts:7-9` independently reads runtime environment. Reproduce with `node --test tools/shared_isolation_acceptance/acceptance.test.mjs`: VM evaluates the real Nuxt config with dedicated + synthetic upstream, changes its runtime env to shared, and `/web/**` still points directly at synthetic Odoo. Shared-built control has no rules. Required fix: immutable mode contract plus fail-closed runtime/build mismatch detection covering compiled proxies; test both mode directions. This is source/config evaluation, NOT a built Nitro server exploit demonstration. Build, Docker and SSR runtime were NOT RUN.

**T6-F02 — medium, tenant branding logo rejected.** Actual serializer `odoo-addons/liwan_api/serializers/company.py:42` emits `/web/binary/company_logo?company=…&v=…`. `deploy/shared/guard.mjs:40-41` allows only `/web/content/` under `/web`, so the actual logo request throws `forbidden_route`. Reproduce: `node --test tools/shared_isolation_acceptance/known-regressions.test.mjs` (exit 1, expected desired-behavior regression). The same test first proves `/api/v1/branding` routes to Odoo; this is not a reject-everything test. Required fix: deliberately review and allow the specific tenant-bound branding binary route; preserve generic web/RPC exclusions and test public tenant logo controls. No implementation repair made.

### Commands and fresh results

| Command / cwd | Result |
|---|---|
| `node --test tools/shared_isolation_acceptance/acceptance.test.mjs` / workspace | 4/4 tests pass, exit 0; final expanded run 31.486s, raw `acceptance.log` |
| `node --test tools/shared_isolation_acceptance/known-regressions.test.mjs` / workspace | 0/1 pass, exit 1: `Error: forbidden_route`, guard.mjs:41 |
| `npx vitest run server/utils/__tests__/tenantApiProxy.test.ts server/utils/__tests__/tenantRequest.test.ts server/utils/__tests__/tenantHostResolver.test.ts server/utils/__tests__/vendor-outage.test.ts` / apps/web | 25/25 pass, four files, exit 0 |
| `git diff --check` / workspace | pass, exit 0 |
| `node --check tools/shared_isolation_acceptance/acceptance.test.mjs` and corresponding known-regressions file | pass, exit 0 |

Node v24.21.0. No dependency installation. Full build/type/lint/coverage not rerun: new harness is plain JS, syntax checked; implementation-wide gates belong to t5/t7. No numerical code-coverage claim.

## Coverage map and evidence strength

Ten synthetic host/database/filestore bindings `tenant0..9.acceptance.test` → `acceptance_0..9`. Every ordered foreign pair occurs: 10 × 9 = 90, separately per surface. Actual imported guard implementation serves HTTP and upgraded TCP/WS; mock upstream only echoes/checks synthetic data.

| Surface | Positive controls | Foreign checks | What it proves / does NOT prove |
|---|---:|---:|---|
| GET `/api/v1/tasks/1` | 10 | 90 | HTTP guard rejects A's signed cookie on B's host; own Host/database and unwrapped SID correct. NOT Odoo reads/ACL |
| PATCH `/api/v1/tasks/1` | 10 | 90 | Same guard boundary, JSON write body; upstream hit count unchanged on denial. NOT SQL effects |
| GET `/api/v1/tasks/1/attachments/1/download` | 10 | 90 | File route cookie/host binding; NOT real filestore bytes/attachment ACL |
| GET `/api/v1/me` | 10 | 90 | Session envelope binding; NOT real Odoo login/session store |
| Upgrade `/websocket` | 10 | 90 | Real local upgraded sockets; wrong-cookie request never reaches mock. NOT Odoo bus subscriptions/delivery |
| Jobs + backup restore binding | 10 | 90 | Pure reconcile planner returns persist_intent for own; foreign current binding and restore backup rejected. NOT durable worker/execution/fencing |
| A own cookie requesting B resource identifier | 10 | 90 | Guard keeps A DB Host; synthetic backend ownership oracle returns404. This isolation policy is mocked, NOT ORM evidence |

These are NOT 90 live tenant pairs. Cookie transport attacks and resource-ID attacks are separately counted. Numeric ID1 intentionally collides across synthetic databases. Actual real Odoo cross-tenant read/write/file/session/WS/worker evidence remains required.

Additional checks: unknown/port/trailing-dot/comma/database-shaped hosts rejected; spoofed forwarded/proxy/Odoo headers rejected; URL encoded database selector and nested body db/database/sid/session_id rejected; raw/tampered/duplicate session cookies rejected; expiry and signing-key rotation fail closed; duplicate host/id/database/filestore registry rows rejected; tenant disable/revision change blocks next HTTP and WS handshake while another tenant remains successful; no cache masks disk updates. Internal authentication accepts only matching db and rejects foreign db; internal logout, TOTP and branding/report API path controls reach mock. Generic RPC/database manager/report paths rejected.

Revocation: live upgraded mock socket closes in **30004ms** after connection, matching fixed 30s upper-bound design (scheduler tolerance measured). Disabled snapshot then survives new guard-instance creation: denied tenant0, successful tenant1. This is a new server instance in the same Node process, NOT OS/container restart or persistence crash recovery. Fresh reader sees revision2; fresh signed revision2 cookie succeeds, revision1 cookie fails.

## Odoo semantic source inspection (read-only, not tests)

Upstream `odoo/http.py:1813-1851` chooses session.db only if db_filter accepts host; otherwise header DB or forced DB-list monodb fallback, logs out mismatched session. `http.py:402-418` substitutes escaped Host in dbfilter. Shared config uses `^%h$`, no db_name, proxy_mode=False. Guard rewrites Host to registry database. This aligns intended DB selection, but still requires real multi-DB tests, including anonymous branding and invalid/missing session.db.

`addons/bus/websocket.py:1059-1077` optionally downgrades sessions when `ODOO_BUS_PUBLIC_SAMESITE_WS` is set and Origin differs from internal Host/scheme. Guard currently preserves external Origin while using database Host and HTTP; enabling that upstream option would cause downgrade. Not classified as a current unconditional defect because deployment does not set the option. Add explicit runtime contract/test before enabling it.

TLS/proxy evidence: Caddy template removes forwarded headers; guard rejects spoofed forwarded headers and strips authorization; Odoo shared proxy_mode=False. Caddy parser/TLS/secure-browser cookie flow are NOT RUN. Authentication/MFA/logout route reachability is mock-tested, not real auth flow. Logout remote failure/session revocation semantics, response caching and full SSR tenant-specific rendering remain unproven. Branding payload is publicly cached by Odoo; no shared external cache was started or accepted.

## Resources and cleanup

Captain explicitly authorized at most three concurrent ephemeral Node listeners on 127.0.0.1:port0, synthetic data only. Final run used upstream50424, web50425, guard50426; guard restarted as50801 after closing old instance. Raw log records addresses and cleanup. All servers closed and tracked sockets destroyed in finally, Node exited0 after31.486s. No listeners persist. Registry fixture is retained in this owned directory, contains only synthetic IDs/no secrets. The mock is intentionally not deployable.

## Pending gates / no implied permission

Real Odoo10-DB/filestore90-pair tests, deployed Caddy/network bypass checks, real authentication/MFA/logout and bus events, database SQL migrations, durable jobs/recovery/fencing, built shared SSR/cache/restart, and Docker image mode controls remain NOT RUN and need separately named resources and approval. Non-SaaS ORM/offline runtime also remains covered only by earlier pure evidence, not revalidated here.

## Self-evaluation

Accuracy4/5: raw logs and deliberately failing regression anchor claims; actual built SSR not verified. Completeness3/5: requested operational surfaces only exercised as mocks/pure due approved resource boundary; real Odoo gate explicitly open. Clarity4/5: per-surface table distinguishes cookie and ID attacks, but report is technical. Actionability4/5: reproducible commands and two specific fixes; repair belongs to other owners. Conciseness4/5: detailed caveats are necessary but long. Average3.8/5; highest-impact improvement is separately authorized real Odoo matrix, then build/runtime replay. This score does not override the blocked verdict.
