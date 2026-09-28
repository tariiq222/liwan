# Shared isolation — security review ledger (t21 current, t18 historical)

## Current verdict — t21 transport review

**T17-F01 CLOSED within the independently reviewed source and t20 built-mock scope. Stage remains NOT READY.** No new confirmed exploitable code finding is raised by this bounded review. This does not certify every transport edge case or close the missing operational capabilities.

**T7-S01:** the original missing-identity source defect is repaired, and anonymous built login/useFetch SSR plus direct API binding now have positive wire evidence. Close that tested subset only. Authenticated bare-useApi SSR, simultaneous tenant A/B rendered data/cache/hydration, the built vendorActor journey, and real Odoo sessions remain **OPEN evidence gates**, not proven residual code vulnerabilities. Earlier startup/Origin/image/dynamic-mode closures retain their stated limits.

### Scope and new independent checks

T21 read current `tenantTransport.ts`, API/auth/vendor call sites, transport test source, t20 report, corrected strict harness and raw final SSR log. It did not start services, listeners, tests, builds, Docker, Odoo or databases and made no Git or implementation changes. Only this report was edited. A read-only Python SHA256 comparison freshly verified **all nine** entries in `tools/shared_isolation_acceptance/t20-hashes.txt`, exit0: config, mode plugin, transport, three auth handlers, API proxy, final built index and Nitro chunk. This confirms those exact files match the recorded evidence, not a whole-tree reproducible-build attestation. Vendor-control/useApi/public artifacts are not individually covered by that nine-entry hash ledger.

### Transport security review

- **Destination/SSRF:** `apps/web/server/utils/tenantTransport.ts:14-19,40` obtains binding through `tenantUpstreamHeaders`, then connects only to the configured HTTP/HTTPS hostname/port. Credentials, non-root base paths, base query/fragment and unsupported protocols reject. Call sites provide server runtime config, never a body/query-selected authority. Only relative API/session paths are accepted, and normalized traversal/backslash/CRLF/fragment/absolute URL forms reject. Encoded application paths remain subject to the guard; accepting a path does not alter the fixed socket destination. Operator-controlled DNS/configuration is still a trust assumption, not protection from a compromised operator.
- **Host/session fidelity:** `:22-30,40` constructs Host/token/revision from validated binding, never arbitrary options authority. Cookie is passed to the guard, which remains responsible for signed tenant-envelope verification and SID unwrapping. `:24-27` forwards only selected application request headers. Native Node HTTP/HTTPS replaces the opaque fetch Host handling. HTTPS uses standard Node TLS validation; a real HTTPS-upstream test is not supplied.
- **Redirects:** `:41-43` rejects 3xx except304 and never follows Location. This prevents forwarding private credentials to a redirected authority. Guard validation was not relaxed, and the registry was not expanded to network addresses.
- **Responses:** `:52-58` removes standard hop-by-hop headers and every Connection-nominated field; arrays are appended separately, preserving multiple Set-Cookie values. Binary bytes and status are retained; HEAD/204/205/304 responses have no body. Response headers otherwise come from the trusted upstream, not an unrestricted third party. Actual built binary/HEAD/two-cookie evidence exists; exhaustive statuses, malformed/truncated responses, compression/cache/range semantics and Connection-nominated-header cases remain unproven by t20. Do not call that exhaustive transport conformance.
- **Bounds:** request and response buffering are explicitly16MiB/32MiB (`:6-7,20-21,44-47,70-82`); no unbounded streaming claim. Request upload has its own15s timer and outbound transport another15s timer (`:63,73`), so the HTTP journey can span approximately30s plus processing; “15s total deadline” is accurate only for the outbound phase, not upload+outbound together. Per-request caps are not aggregate concurrency/memory protection. Auth handlers parse their JSON before transport; public shared ingress currently supplies the earlier guard body cap. Do not claim the transport alone bounds every pre-parsed body.
- **Cancellation:** `:35-37,61-65` destroys outbound request on incoming abort or unfinished downstream close and removes listeners when settled. t20 did not independently exercise disconnect races, already-aborted events, incoming oversize or slow uploads. Keep these as required adversarial verification, not a pass inferred from source.
- **Auth/logout:** shared login/TOTP/logout now call this transport; dedicated retains native fetch. Shared logout checks HTTP/RPC failure before cookie deletion (`server/api/auth/logout.post.ts:9-17`), eliminating the prior silent upstream failure path for shared mode. A mocked successful destroy response does not prove actual Odoo SID revocation. Vendor actor uses shared transport for `/me` and still validates `MeSchema`; dedicated keeps its prior fetch path (`utils/vendor-control.ts:46-63`).
- **Dedicated:** API retains `proxyRequest(event,url)` in its dedicated branch, and auth/vendor branches preserve dedicated implementations. t20 broad912 tests/types and the preserved dedicated lifecycle artifact support limited regression claims; final dedicated transport/auth integration was not rebuilt and exercised in t20.

### Corrected verifier and evidence strength

Inspected `tools/shared_isolation_acceptance/t17-built-ssr.mjs:14-17,59-71`: transport controls are explicitly tagged with `x-test-control`; every **application** call still must have exact tenant Host/token/revision. The production transport allowlist does not forward that test-only header, so this does not create an application bypass. Strict Host validation applies even to controls. Control separation fixes the t18 bookkeeping concern without weakening app identity assertions. `httpHostControlStatus=200` is asserted; native-fetch403 and directAPI200 are recorded in the raw result but not both explicitly asserted at their individual call sites. Strengthen these desired-result assertions in a future verifier maintenance task; the logged successful built application binding/branding remains valid evidence.

Reviewed `t20-final-ssr.log` records:

| Evidence attributed to t20 | Result | Boundary |
|---|---|---|
| Real compiled login SSR/direct API | Branded200/directAPI200; all app wire Host/token/revision exact | Actual Nitro, synthetic strict upstream; not actual Odoo |
| Login MFA/TOTP/logout |200/200/204; remote logout failure502; two cookies | Synthetic auth replies; no real MFA/session semantics |
| Redirect/binary/HEAD | Redirect502, exact `[0,1,255,128]`, two cookies, empty HEAD | Built transport behavior |
| Response limit/deadline |33MiB→502; deadline502 at15002ms | Outbound phase only |
| Secret checks | Login HTML clean;310public files clean for sentinel/config name | Tested artifact/page only; not all authenticated payloads |
| Lifecycle | Fresh shared + preserved dedicated six cases; no outbound after mutation | Startup/dynamic invariant retained |
| Other regressions | Matrix8pass, web912pass, types pass | Mock/pure/type evidence, not live tenant isolation |

Raw final log ends `T17_SSR_CHILD_AND_MOCK_CLOSED`. This t21 review did not independently recreate those runtime observations; it independently checked their harness, source chain and matching artifact hashes. No token leakage or new Origin/image ACL bypass was identified in the transport changes. Real image ACL/placeholder byte conditions in the historical review remain mandatory.

### Remaining work and resources

1. Separately authorize bounded built tests for authenticated bare-useApi SSR, vendor actor, concurrent tenant/cache separation, disconnect/abort and incoming size/deadline behavior; include malformed/truncated upstream and response header/status edge cases. Preserve strict controls and final source/artifact provenance.
2. Real Odoo: ten isolated DB/filestore bindings and90 directional pairs; actual login/MFA/logout invalidation, reads/writes/files/WS events and role/company/non-placeholder image bytes. Never use `odoo19`.
3. Actual edge/network/image validation: Caddy/TLS/browser cookie+Origin, private backend bypass denial, effective Docker networking and restart/revocation.
4. Durable authenticated registry+audit atomic publication, fencing/CAS/tombstones/rollback/crash recovery; shared control-plane jobs/backups/restores and real SQL/artifact/readback proofs. CP remains dormant; transport repair supplies none of these capabilities.
5. Preserve non_saas local-policy/immutable classification constraints and obtain real ORM/offline runtime evidence separately.

**Current decision:** known T17-F01 repaired in tested scope; T7-S01 only partially discharged as above; operational isolation and release remain NOT READY. No launch, deployment or missing-capability acceptance follows from this update.

Self-check (t21): accuracy4 (matched hashes and inspected wire evidence, not rerun); completeness4 (requested surfaces examined, adversarial/runtime gaps explicit); clarity4 (current/historical ledger separated); actionability4 (specific remaining cases); conciseness3 (historical audit retained).3.8/5. Next improvement is bounded authenticated/concurrent/abort verification and separately authorized durable/live gates.

---

# Historical t18 review — retained unchanged below

The following verdict describes the pre-t19/t20 checkpoint. It is superseded **only where explicitly stated by the t21 disposition above**; its failed evidence and operational cautions are not erased.

## Verdict

**NEEDS REVISION / NOT READY. Review complete; isolation stage and release NOT accepted.**

The remaining confirmed code blocker is **T17-F01 (high): shared Nuxt-to-guard HTTP transport loses the tenant Host**. T7-S01 cannot be closed as a working end-to-end SSR boundary. Previous startup, dynamic-mode, Origin and narrow image-route defects are closed only at the evidence levels stated below. Historical t6 failure remains intact.

Reviewed checkout: `/Users/tariq/code/nasq-shared-isolation`, identified by preceding verification as `codex/shared-isolation` at `d780862e`. This t18 review read current implementation, installed H3, test harnesses and raw t17 evidence; it did not execute Git, builds, tests, listeners, Docker, Odoo or databases. Only this report was written. Prior executable results are explicitly attributed, not presented as fresh t18 runs.

## Finding disposition

| ID | Severity | Disposition and evidence boundary |
|---|---|---|
| T6-F01 | High | **Closed: startup mismatch gate.** Immutable compile-time literal and synchronous assertion remain in `apps/web/server/plugins/tenancy-build-mode.ts:3-15`. t17 six-case built evidence rejects both mismatch directions and invalid modes before listening. |
| T6-F02 | Medium | **Closed: company-logo route rejection.** `deploy/shared/guard.mjs:53-59` admits exact GET/HEAD serializer contract, rejecting selector/duplicate query expansion. Real Odoo response bytes/cache remain unverified. |
| T7-F03 | Medium | **Closed: missing Origin check in code.** `guard.mjs:39-43` requires exact HTTPS tenant Host Origin and rejects duplicate raw Origins, including on the internal-token path. Real browser/Odoo bus delivery remains unverified. |
| T13-F01 | Medium | **Closed: blocked favicon/HR-avatar routes.** `guard.mjs:44-51,63` narrowly admits the two actual consumers, with method/query/path restrictions. t17 actual serializer/consumer and negative tests pass. This is NOT acceptance of real HR image authorization. |
| T14-F01 | Low, conditional | **Closed: swallowed dynamic-mode hook.** Plugin now wraps H3 `options.onRequest`, asserts before the original callback, and awaits `previous.apply(this,args)` (`:20-25`). Installed H3 `dist/index.mjs:2000-2003` awaits it before traversing the stack. t17 built static/proxy/API mutation tests reject with zero outbound attempts. No remote environment-mutation primitive claimed. |
| T7-S01 | SSR investigation | **OPEN end-to-end; superseded in part by confirmed T17-F01.** Source forwarding repair is present, but actual built login/useFetch and direct API fail at downstream Host transport. Authenticated bare-useApi rendering still needs a positive journey. |
| T17-F01 | High | **OPEN confirmed functional integration blocker**, detailed below. Fail-closed availability defect, not demonstrated cross-tenant disclosure. |

## T17-F01 — shared transport loses tenant Host

### Current source chain

1. `apps/web/server/utils/tenantRequest.ts:11-17` authenticates private token, resolves incoming Host in the registry and checks tenant revision. `:20-22` returns trusted `host`, token and revision.
2. `apps/web/server/routes/api/v1/[...path].ts:8-15` passes those headers to H3 `proxyRequest` in shared mode; dedicated retains its original two-argument call.
3. Installed H3 `node_modules/h3/dist/index.mjs:1148-1184` merges headers and uses a fetch transport.
4. Actual t17 wire evidence shows the transport emits the upstream URL authority instead of the registered Host. `deploy/shared/guard.mjs:27-29` requires the registered Host even for internal callers, so the request is rejected. The private token does not legitimately authorize bypassing host selection.

### Evidence independently inspected in t18

`tools/shared_isolation_acceptance/t17-built-ssr.mjs:13-19` defines a strict Host receiver; `:29-36` makes built login/direct API requests plus separate native-fetch and Node HTTP controls. Raw `t17-ssr-strict-final.log:1` records:

- Built `/login`: HTTP 200, **no synthetic branding**.
- Built direct `/api/v1/branding`: HTTP 403.
- Actual built upstream calls: token MATCH, revision `1`, Host `127.0.0.1:58098` rather than `t17.acceptance.test`.
- Native Node fetch with explicit Host: 403.
- Node `http.get` with explicit Host: 200.
- Desired branding assertion fails; cleanup is recorded.

This is stronger than source header-object tests: the receiving socket observed Host. It proves the tested Node24.21.0/artifact behavior, not that every fetch implementation always ignores Host. The receiver is synthetic, not actual Odoo; failure occurs before Odoo would be reached.

### Authentication scope must be included in repair

All three BFF flows use the same native-fetch style:

- `server/api/auth/login.post.ts:12-16`: authentication and injected DB.
- `server/api/auth/totp.post.ts:9-13`: MFA plus session cookie.
- `server/api/auth/logout.post.ts:7-13`: session destroy, then local cookie deletion.

These are source-supported affected candidates, **not independently demonstrated auth-flow failures in t17**. Logout ignores response status and transport failure before returning 204; a successful local logout response alone cannot prove remote session revocation. Repair validation must test remote effects, not only HTTP status or deleted browser cookie.

### Required fix and acceptance constraints

Preferred bounded option: a **server-only shared transport** using Node HTTP/HTTPS with a fixed validated configured upstream address and explicit trusted Host, demonstrated at the receiving socket. Keep dedicated behavior unchanged. Do not derive socket destination, scheme or authority from public request Host, URL, body or headers. Reject redirects, or implement a separately reviewed fixed-origin policy; never forward private token/cookie through arbitrary redirects. Preserve repeated Set-Cookie headers, streaming/content handling, status/error semantics, hop-by-hop header filtering, request cancellation and bounded time/body sizes. Do not log secrets or credentials.

Alternative: an explicit authenticated internal tenant-selector protocol, requiring coordinated guard and ingress changes, strict stripping/rejection of public overrides, token authentication, registry/revision lookup and conflict rejection. This is a larger trust-contract change, not permission to accept arbitrary tenant headers. Do not add the network authority to the registry, weaken Host validation, bypass the guard or make the mock permissive to remove 403.

Rebuild the corrected shared artifact and require strict positive `/me`, branding, direct API, authenticated useApi SSR, login/MFA/logout, with actual wire binding; retain foreign/stale cookies, registry revisions, selector/RPC/header negatives and both dedicated regressions and mode gates.

**Harness caveat for the repair verifier:** `t17-built-ssr.mjs:34-35` appends uncredentialed direct transport controls to the same `calls` array. The final loop at `:46` requires token/revision on every entry, including those intentionally uncredentialed controls. Once branding is fixed, that blanket assertion can fail for test bookkeeping alone. Keep distinct tagged/segregated control calls and assert Host/token/revision for actual built application calls; separately assert each control's expected behavior. Do not weaken the strict receiver or delete application assertions. The already observed branding failure and wrong wire Host are unaffected by this caveat.

## Images: route repair is not an ACL grant

Reviewed guard allows only:

- GET/HEAD `/web/image/res.company/{positive-id}/logo/32x32` with the serializer-formatted `v` parameter only.
- GET/HEAD `/web/image/hr.employee/{positive-id}/avatar_128` with no query parameters.

Normalization/encoded aliases, arbitrary models/fields/sizes and query overrides including access tokens are excluded. Database Host and tenant cookie binding remain intact. No new addon ACL, public HR grant or sudo was introduced in this repair.

Stock `/web/image` is `auth='public'` (`/Users/tariq/code/odoo/addons/web/controllers/binary.py:183`), but calls `ir.binary._find_record` at `:191`. Stock `odoo/addons/base/models/ir_binary.py:50-55` permits elevated content through a verified limited token or model-specific `_can_return_content`; otherwise it checks ordinary read access. Base `_can_return_content` defaults false (`odoo/orm/models.py:5847-5861`). The previously reviewed HR source has no such override. Nasq's `odoo-addons/nasq_platform/models/ir_binary.py:9-28` delegates to this access path and adds suspension checks; it does not establish a new HR read capability.

Stock image handling can return a placeholder on access/error (`binary.py:198-208`). Therefore mock bytes or HTTP200 **do not prove actual authorized employee image bytes**. Required real tests: role/no-role, anonymous/pre-auth session, revoked user, other company, foreign tenant, suspended tenant and forbidden access-token inputs; compare known fixture image hashes against placeholder bytes. If intended Nasq roles fail stock access, use a separately authorized endpoint/design rather than broad permissions or sudo. Public company branding and private HR must remain distinct.

## Preserved boundaries and secret evidence

- Startup literal is not overridable runtime configuration. The replacement onRequest wrapper addresses Nitro's swallowed-hook problem before routeRules, not an ordinary middleware assumed to run first. Revalidate H3/Nitro lifecycle ordering after dependency upgrades.
- Guard Origin check is before upstream selection and is not waived by the internal proxy token. No new Origin bypass was identified in the reviewed changes.
- Dedicated API proxy branch is unchanged; t17 reports broad 911 web tests and types passing. This is regression evidence, not a dedicated production acceptance claim.
- `useApi.ts` forwards cookie/private headers only to constrained relative API paths on middleware-validated SSR context. The actual t17 anonymous login HTML did not contain the synthetic token/private header name. Its scan of 310 public artifact files found neither that token nor `NASQ_SHARED_PROXY_TOKEN`.
- Those negative scans apply only to the inspected artifact and anonymous journey. They are not proof for every authenticated SSR payload, error response, source map, redirect or cached page. No token leakage is established, but a universal no-leak claim is not justified.

## Evidence ledger and attribution

All execution below belongs to **t17**, reviewed by t18 without rerunning resources:

| Evidence | Recorded outcome | What it establishes |
|---|---|---|
| `t17-mode.log` + `apps/web/tests/tenancy-mutation-check.mjs` | Six cases, matching static200, post-mutation three paths rejected, zero outbound; all children exited | Built startup/dynamic gate within harness |
| `t17-images.log`, actual consumer tests + guard tests | 7/7 | Positive route contracts and mock guard behavior |
| `t17-image-negative.test.mjs` and report | 1/1 | Narrow image-path negatives |
| `t17-ssr-strict-final.log` + strict harness | Exit1, built API403 and unbranded page200; HTTP Host control200 | Remaining transport defect |
| `t17-web.log`, `t17-types.log` and report | 911 tests; types pass | Broader unit/type regressions, not working shared transport |
| `t17-hashes.txt` | Selected source and artifact hashes | Traceability, not full reproducible-build attestation |

Selected recorded hashes: config `a5726f2aa5a61ab8ab6b1065126adf419c5824001dd14176b10110e9df67e1fc`; corrected mode plugin `a36fe3ef92189cb900c459803e6b18d01bd9bcb47e0abf9fe863bf25d6422b97`; guard `26df479bebf727e21db039aeec6e838bc3cbedfdc29586c9bee318276deaa500`.

## Readiness gates — none waived

1. **Repair T17-F01, then independently rebuild/reverify.** Approved isolated output directories, loopback ephemeral strict receiver, synthetic registry/secrets, blocked unintended outbound connections and finally-closed processes. Test concurrent A/B SSR data/cache/hydration and client/HTML/payload/error/source-map secret sentinels. Include all auth flows and actual remote logout effect.
2. **Real Odoo isolation and image authorization:** separately named scratch resources, never `odoo19`; ten independent databases/filestores and ninety directional pairs for read/write/files/session/auth/MFA/logout/WebSocket events, revocation and restart. Source dbfilter reasoning and mock90 pairs are not this proof.
3. **Network/edge/image:** actual Caddy parser/TLS/browser cookie and Origin behavior, container image startup, private backend reachability and bypass denial, including effective Compose networking. Static templates alone are insufficient.
4. **Registry publisher:** durable authorized atomic snapshot+audit publication, monotonic/fenced CAS, permanent identity/resource tombstones, crash/rollback/restart tests. In-memory mutation primitive plus read-only directory mounts do not implement this capability.
5. **Jobs/backups/restores:** shared CP remains dormant/fail-closed. Implement and verify durable identity, authorization, SQL uniqueness, fencing/CAS/recovery, artifact checksums/consistency, restore approval consumption and independent readback before active status. Strict schemas and pure planners are not operational execution.
6. **non_saas:** preserve immutable classification/local_policy and no subscription expiry; pure tests do not replace real ORM/SQL/offline-full-runtime verification.

No commit, merge, push, deploy, runtime resource creation or cleanup is authorized by this report. **Code repair closure and stage readiness are separate decisions; both are presently blocked by the items above.**

## Review self-check

Accuracy 4/5: exact source chain and raw wire controls, but execution evidence is attributed to t17 rather than independently rerun here. Completeness 4/5: all requested findings explicitly disposed; live proofs remain intentionally absent. Clarity 4/5: separates repaired code, open transport and missing capabilities. Actionability 4/5: bounded transport options and strict resource tests; implementation still required. Conciseness 3/5: detailed evidence/ACL caveats increase length. Average 3.8/5. Highest-value next step is strict transport repair and independent built verification, not more permissive mocks.
