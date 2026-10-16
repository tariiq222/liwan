# T17 independent final repair review — NOT READY

Frozen worktree codex/shared-isolation, d780862e. No production edits or Git operations. Historical t6 failure and T13 report retained. Owned new harness/report/log files only. No Odoo/DB/Docker or existing upstream used.

## New confirmed finding T17-F01 — HIGH functional shared routing blocker

Actual built `.output-t16-shared` accepts outer tenant Host and trusted token/revision, then local SSR `useFetch` requests for `/api/v1/me` and `/api/v1/branding` reach the Nuxt API proxy. Token and revision survive; **actual outbound HTTP Host becomes upstream authority `127.0.0.1:<mockport>` rather than registered tenant host**. Strict-host mock returns403. Direct built `/api/v1/branding` also returns403. `/login` itself returns200 but lacks synthetic branding (not502; do not infer success from page status).

Reproduction: `T17_STRICT_HOST=1 node tools/shared_isolation_acceptance/t17-built-ssr.mjs` exits1 on desired branded-HTML assertion. Raw `t17-ssr-strict-final.log` records four SSR calls plus direct API. Matching independent Node http.get control explicitly setting tenant Host returns200. Node24.21.0 native fetch with the same explicit Host instead sends URL authority and returns403. Initial permissive echo mock produced branded200 but failed Host assertion; it was not accepted as success.

Source chain: `apps/web/server/routes/api/v1/[...path].ts:8-15` passes tenant headers to H3 proxyRequest; installed H3 `dist/index.mjs:1148-1184` merges headers then uses fetch transport. `tenantRequest`/guard depend on Host lookup; `deploy/shared/guard.mjs:27-29` will not resolve guard's network address as tenant. This is a reproducible fail-closed availability/integration defect, NOT demonstrated cross-tenant leakage. Bare useApi and useFetch differ on local dispatch, but both eventually use this same API route when they reach it; this run proves useFetch/login plus direct API, not authenticated useApi page journey. Auth login/TOTP native-fetch calls should be included in repair validation, not assumed safe.

Required fix: use a server-only transport that demonstrably preserves trusted Host or an explicit reviewed internal tenant-selection protocol that does not trust public overrides; validate actual wire Host with strict receiver, restore me/branding/API/auth positives and retain all selector/header isolation negatives. Do not make mock permissive or change registry to accept network authority. No implementation fix performed.

## Previously found defects

- T6-F01 startup mismatch and T14-F01 post-start mutation: revalidated actual t16 artifacts through `node apps/web/tests/tenancy-mutation-check.mjs`, exit0, six cases. Both matching modes serve static200; injected test-only env mutation makes static, web-proxy and API paths500 with zero outbound attempts. Both mismatch directions and invalid runtime exit before listen. ALL_T16_CHILDREN_EXITED. This is actual H3/built request dispatch, not a swallowed-hook unit test. Config hash a5726f2aa5a61ab8ab6b1065126adf419c5824001dd14176b10110e9df67e1fc; plugin a36fe3ef92189cb900c459803e6b18d01bd9bcb47e0abf9fe863bf25d6422b97 match t16. Full selected source/artifact hashes in t17-hashes.txt. No rebuild was needed for these unchanged t16 snapshots; source fingerprints are not a universal reproducible-build attestation.
- T6-F02/T13-F01 logo/favicon/HR avatar: independent actual serializer/consumer tests all3 pass without weakening assertions. Guard existing mock suite4 also passes. Independent new image negatives1pass: arbitrary model/field/size/token/db/normalized traversal/encoded alias and POST deny; own GET/HEAD bind correct database. Odoo roles/company/bytes not executed. Existing mock is not a real role oracle; **role-bound Odoo evidence remains NOT RUN**, and HTTP200 may be stock placeholder rather than authorized image. Do not infer ACL from route acceptance or status200.
- T7-F03 WS origin prior closure unchanged; current guard suite includes10 positives/90 foreign session pairs. This run did not repeat every t13 HTTP surface matrix; prior t13 final per-surface10/90 remains historical evidence, not recounted as fresh live evidence.

## Built SSR secrecy evidence and limitations

Executed real built login SSR, not source replay. Strict mock receives synthetic traffic only, child connects solely to its designated loopback upstream port. Response HTML contains neither the synthetic private token nor x-webvue-proxy-token. Scanned **310 public artifact files**: no synthetic token or WEBVUE_SHARED_PROXY_TOKEN. This scan completes despite failing desired SSR branding assertion. It is bounded evidence for this artifact/anonymous page, not every authenticated SSR payload. T7-S01 is NOT closed because actual transport broke binding. No production debug route added; only test preload forces127.0.0.1 port0 and denies other outbound sockets.

## Fresh command evidence

| Command | Outcome |
|---|---|
| `node apps/web/tests/tenancy-mutation-check.mjs` | six cases pass, all children exited; t17-mode.log |
| `node --test tools/shared_isolation_acceptance/known-regressions.test.mjs deploy/shared/guard.test.mjs` |7/7 pass; t17-images.log |
| `node --test tools/shared_isolation_acceptance/t17-image-negative.test.mjs` |1/1 pass |
| `node tools/shared_isolation_acceptance/t17-built-ssr.mjs` |exit1 actual Host mismatch despite permissive mock200; t17-ssr.log |
| `T17_STRICT_HOST=1 node tools/shared_isolation_acceptance/t17-built-ssr.mjs` |exit1 strict directAPI403, page200 missing branding; http Host control200; native fetch403; t17-ssr-strict-final.log |
| `npx vitest run` in apps/web |911/911,136files pass; t17-web.log |
| `npm run lint` in apps/web |vue-tsc pass; t17-types.log |
| `git diff --check` |pass |

All invoked synchronous commands settled. Test children terminated and mock sockets/server closed in finally, logged T17_SSR_CHILD_AND_MOCK_CLOSED on both failed and successful-control paths. SSR connections used fresh kernel-assigned loopback ports (final mock58098); no resources left running. No actual token value appears in logged calls (MATCH/MISSING only). Fixture token is synthetic only.

## Outstanding gates

Not ready: T17-F01 requires repair/review. Real Odoo10 databases/filestores90pairs, image roles/ACLs and exact non-placeholder bytes, real auth/MFA/logout/WS notifications, Caddy/TLS/network bypass, durable registry/audit publication and fenced job execution/recovery remain absent. CP shared worker still dormant. Stage completion cannot be inferred from startup/mutation closure or911 green unit tests.

Self-evaluation: accuracy4 (actual wire/control evidence); completeness3 (authenticated SSR/roles/live matrix unproven); clarity4 (200 page versus403 API explicit); actionability4 (strict runnable reproduction); conciseness4. Highest priority: transport repair followed by identical strict rerun, not broader permissive mocks.
