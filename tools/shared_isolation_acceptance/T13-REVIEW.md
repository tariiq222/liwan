# T13 independent post-repair review

Review completed; **NOT READY for isolation-stage acceptance**. Historical t6 failed verdict and README/log remain intact. No implementation files changed. Workspace codex/shared-isolation at d780862e, existing dirty work preserved. No commit/merge/push/deploy/delete, Odoo, DB or Docker execution.

## Disposition

- **T6-F01 repaired within built-startup scope:** final config/plugin hashes exactly match t11: config `a5726f2aa5a61ab8ab6b1065126adf419c5824001dd14176b10110e9df67e1fc`, plugin `9357bed3621e16dc4b7d287b3965d949b6f2b941265b3a1fb1a71aebd623fc2a`. Replayed actual existing dedicated/shared artifact entrypoints: two matching modes listen successfully on loopback; both mismatches and both invalid runtime modes exit before any listen attempt, even with forged mode environment variables. All six children exited. Independent original config assertion that dedicated proxy rules remain present was retained, not deleted. This proves startup mode gating, not final t12 built SSR integration. Existing t11 artifact snapshots can predate t12 useApi edits; no rebuild or false final-artifact equivalence claim.
- **T6-F02 repaired for the emitted company logo:** test now executes actual `_logo_version` and `dump_branding` functions via Python AST extraction, avoiding Odoo imports. Full timestamp plus byte logo, absent timestamp/empty logo and string logo all produce accepted URLs. Both GET/HEAD, anonymous/signed cookies route to registry database. POST, db selectors and duplicate company remain rejected. Replacing the old arbitrary `v=synthetic` is contract-grounded, not making data fit implementation: production formatter emits exactly `%Y%m%d%H%M%S%f` or `0`, hyphen, 12 lowercase SHA256 hex chars. Production serializer always supplies v; no inspected production logo consumer drops v. Response caching/304 remains NOT RUN.
- **T7-F03 repaired within mock HTTP/WS scope:** exact same HTTPS host Origin succeeds for all ten tenants. Missing, null, foreign, sibling, duplicate same Origin, and HTTP scheme reject before mock upstream. Foreign cookie matrix uses correct target Origin, so failure is not accidentally caused by invalid Origin.
- **SSR repair is source/mock validated only:** independent transpiled useApi tests preserve binding for allowed relative API paths; absolute/protocol-relative/traversal/encoded slash/backslash/query/hash/other paths receive no cookie or private binding. Client branch acquires no identity. Unvalidated server context forwards cookie only, no trusted headers. Returned composable exposes only `$api`; no secret in returned data. Source replay is NOT built Nitro local dispatch or SSR page proof.

## New finding T13-F01 — medium, broken image consumers (not tenant exposure)

`deploy/shared/guard.mjs:54-55` still denies all `/web/image` routes. Actual consumers:

1. `apps/web/app/composables/useBranding.ts:11-21,29-32` derives favicon `/web/image/res.company/{company}/logo/32x32?v={actual_version}` from the now-working serializer URL and installs it in document head.
2. `apps/web/app/components/hr/EmployeeCard.vue:31` renders `/web/image/hr.employee/{employee.id}/avatar_128`.

Repro: `node --test tools/shared_isolation_acceptance/known-regressions.test.mjs` gives **1 pass, 2 failures**, each `forbidden_route` at guard55. Positive logo control remains successful. User impact: missing institution favicon and HR avatar images, not demonstrated cross-tenant exposure. Required fix: explicitly review narrowly tenant-bound company favicon and authorized HR avatar routes (or approved consumer redesign); maintain model/field/size allowlist, Odoo ACL/company guards and foreign-session/db-selector negatives. Do not broadly enable `/web/image/**`.

Consumer scan of apps/web/app found no additional production `/web/image` routes. HR document links use `/web/content/{id}`, already covered. Login, shell, branding preview and meeting-print use branding.logo_url directly and benefit from logo repair. Existing useBranding unit fixtures (`v=first/replaced`) are synthetic; they do not override actual serializer output.

## Fresh commands and results

| Command (workspace unless noted) | Result |
|---|---|
| `node --test tools/shared_isolation_acceptance/acceptance.test.mjs` | 4/4 pass, exit0; t13-matrix.log |
| `node --test tools/shared_isolation_acceptance/ssr-boundary.test.mjs` | 2/2 pass, exit0; source replay only |
| `node --test tools/shared_isolation_acceptance/known-regressions.test.mjs` | 1/3 pass, exit1, two T13-F01 consumer failures |
| `node apps/web/tests/tenancy-built-check.mjs` | six cases pass, exit0; t13-built.log; ALL_CHILDREN_EXITED |
| `npx vitest run` in apps/web | 911/911, 136 files, exit0; t13-web.log |
| `npm run lint` in apps/web | vue-tsc build/noEmit passes, exit0; t13-types.log |
| `git diff --check` | pass exit0 |
| SHA256 final config/plugin/guard/useApi/tenantRequest | t13-source-hashes.txt |

Independent matrix retained all prior assertions: read/write/files/session/WS each ten positives and ninety directional foreign-cookie pairs, jobs/restore pure ten/ninety; own-cookie foreign resource-ID synthetic oracle ten/ninety. Neither pure jobs nor mock data partitioning proves durable jobs or ORM isolation. WS forced close measured30003ms; registry disable/revision and fresh guard-instance checks pass. Final matrix duration30.345s. Loopback upstream62746/web62747/guard62748, replacement guard63187; all sockets destroyed and servers closed in finally. Built checks separately bound matching modes63082/63083 and terminated all children; preloader prevents outbound connections and enforces loopback port0.

## SSR/useFetch/client artifact limits

useApi uses bare `$fetch`; useMe and useBranding use `useFetch`. Inspected installed `node_modules/nuxt/dist/app/composables/fetch.js:105-115`: local relative paths on server select `useRequestFetch()`, unlike bare useApi. This source difference must not be mislabeled as a confirmed useMe/branding failure. Actual merged header behavior/tenant SSR in compiled Nitro remains NOT RUN. Search existing shared artifact public output for x-nasq-proxy-token/x-nasq-tenant-revision/NASQ_SHARED_PROXY_TOKEN returned no matches, but that artifact may predate repair: NOT final client bundle security proof. No synthetic or real secrets embedded in committed source by this task.

## Remaining stage gates

CP shared worker remains dormant; durable registry+audit publication, lock/fencing/CAS/recovery absent. Real ten Odoo databases/filestores and ninety pairs across ACL reads, SQL writes, files, login/MFA/logout, bus notifications and jobs remain NOT RUN. Docker/image/Caddy/TLS/network access control, final built shared SSR/cache/no-client-secret validation and live crash recovery remain NOT RUN. These are distinct from repaired code defects. No release or isolation-stage approval.

## Deliverables / self-check

Changed owned files: acceptance.test.mjs (Origin contract, old assertions retained), known-regressions.test.mjs (real serializer plus two consumer regressions), new ssr-boundary.test.mjs and this report, final logs/hashes. Synthetic registry fixture reset to the same ten enabled targets. Historical t6 README and acceptance.log not overwritten.

Self-evaluation: accuracy4 (fresh logs, no final SSR claim); completeness3 (real runtime and final SSR gates explicitly open); clarity4 (repair versus missing gates separated); actionability4 (two minimal reproductions grouped under one finding); conciseness4 (long necessary scope caveats). Average3.8. Highest-impact follow-up is bounded image-route repair, then authorized final built SSR and real isolation evidence.
