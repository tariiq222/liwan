# T20 independent rebuilt transport verification

Review complete: **known T17-F01 transport defect closed in tested built scope; stage NOT READY**. No production edits, Git mutations, DB/Odoo/Docker/external upstream used. Historical t6/t13/t17 verdicts retained.

## Fresh artifact and corrected verifier

Built final sources using `NASQ_TENANCY_MODE=shared npm -w apps/web run build`; copied generated `.output` into owned `tools/shared_isolation_acceptance/t20-built-shared`. Build exit0. Selected source and actual Nitro artifact SHA256 ledger: t20-hashes.txt. Initial accidental default-mode build was cancelled (bash-106 SIGTERM) and not used; subsequent explicit shared build bash-107 completed0. Generated normal Nuxt build directories were used, no production source modification.

Corrected t17-built-ssr harness bookkeeping: explicit x-test-control marks independent transport controls; strict token/revision/Host assertions still apply to **every application request**, controls separately checked. Mock rejects wrong Host and missing token/revision for app traffic; no permissive echo acceptance. Controls retain nativefetch wrongHost403 and http.get correctHost200. Application log values use MATCH/MISSING, never token value.

## Actual built results

`T17_STRICT_HOST=1 T20_ARTIFACT="$PWD/tools/shared_isolation_acceptance/t20-built-shared/" node tools/shared_isolation_acceptance/t17-built-ssr.mjs` exits0.

- Real built `/login` SSR200 contains **T17 Synthetic Brand**; `/api/v1/me` and branding actual wire calls preserve tenant Host/token/revision. Direct API branding200. This repairs prior unbrandedHTML200/directAPI403, not just a status assertion.
- `/api/auth/login`200 with synthetic MFA-pending result; two Set-Cookie headers preserved. TOTP200 and two cookies preserved. Logout success204, remote logout500 produces client502 rather than false success.
- Redirect302 rejected as502 without following external Location. Binary response exact bytes `[0,1,255,128]`, two cookies preserved; HEAD200 no body.
- Oversized33MiB upstream response rejected502; nonresponding upstream deadline returns502 after at least14s (actual measurement raw log). Synthetic private token absent from oversized/error bodies checked.
- HTML contains neither synthetic token nor x-nasq-proxy-token. All310 public artifact files scanned for token and NASQ_SHARED_PROXY_TOKEN: absent.
- Every app wire request independently asserted exact Host/token/revision, including auth/session and failure probes. All child/mock sockets closed in finally; raw final log ends T17_SSR_CHILD_AND_MOCK_CLOSED. Test preload restricts child outbound to sole assigned loopback port; no existing upstream used.

These are actual compiled Nitro HTTP/SSR tests with synthetic upstream, NOT real Odoo authentication/MFA/session effects. T7-S01 is closed only for tested anonymous login/useFetch SSR and API binding. Authenticated useApi SSR pages, vendorActor built journey and every payload are NOT independently proven here; t19 vendor tests are implementation evidence, not substituted for this limitation.

## Other gates maintained

`t20-mode.mjs` reuses all assertions from existing six-case lifecycle harness, substitutes freshly built shared artifact and preserved dedicated t16 artifact. Both mismatches/invalid modes reject startup; matching static asset200 then test IPC mode mutation rejects static/proxy/API500 before outbound. ALL_T16_CHILDREN_EXITED. Dedicated artifact not rebuilt in this task; source plugin/config unchanged and ledger recorded.

Independent image actual serializer/consumer tests, image negatives, ten-tenant matrix and WS Origin controls pass8/8 together in t20-matrix.log. Read/write/files/session/WS each10 positives/90 foreign-cookie pairs, jobs pure10/90, resource-ID oracle mock10/90; NOT90 live database pairs. Existing broad web **912/912 in137files** passes; vue-tsc passes. No guard policy weakened.

## Buffered limits and unrun cases

Transport explicitly buffers request16MiB/response32MiB, not streaming. A10MiB decoded attachment expands to13,981,016 base64 bytes, below16,777,216 before ordinary JSON overhead; unbounded extra metadata could still exceed cap.32MiB response is a deliberate bound, not proof all future reports/downloads fit. No real PDF generation/export size audit or full file download journey performed. Client disconnect abort, oversized incoming body, vendorActor built route and all possible upstream status variants NOT independently exercised in this round; timeout/oversized response/redirect were exercised. These limits must remain documented in product compatibility acceptance.

## Commands

- Shared build above: exit0, t20-build-shared.log.
- Strict rebuilt SSR/auth harness: exit0, t20-final-ssr.log (earlier successful t20-auth-ssr.log lacks later size/deadline probes).
- `node tools/shared_isolation_acceptance/t20-mode.mjs`: exit0, six cases, t20-mode.log.
- `node --test tools/shared_isolation_acceptance/known-regressions.test.mjs tools/shared_isolation_acceptance/t17-image-negative.test.mjs tools/shared_isolation_acceptance/acceptance.test.mjs`: exit0, t20-matrix.log.
- `(apps/web) npx vitest run`:912pass; `(apps/web) npm run lint`:pass.
- `git diff --check`:pass at recorded check.

No new confirmed code finding in tested scope. T17-F01 closed; prior image/Origin/startup/mutation closures retained. Real Odoo10DB/filestore90pairs, ACL/roles/exact non-placeholder image bytes, durable registry+audit publication, SQL/CAS/fencing and job/backups/recovery, Caddy/TLS/network bypass remain missing. CP shared worker dormant. **NOT stage acceptance or release readiness.**

Self-check: strong actual-wire and built-positive evidence; coverage remains bounded (authenticated SSR/vendor/disconnect/live ACL missing). Follow up with security review of frozen sources and separately authorized runtime/durable gates, not a launch claim.
