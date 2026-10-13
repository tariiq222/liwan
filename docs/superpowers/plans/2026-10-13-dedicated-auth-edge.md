# Dedicated authentication edge repair

**Goal:** Fix the three reported authentication/proxy defects in the dedicated deployment, with executable regression evidence.

**Design:** Caddy uses the socket peer as its client authority and overwrites private `X-Nasq-Client-IP/Host/Proto` fields on the Nuxt hop. The dedicated Compose deployment opts in to consuming those fields. Login and TOTP forward validated values to stock Odoo ProxyFix; local Nuxt without the opt-in keeps its existing behavior. One edge handler applies a 20/minute aggregate credential budget before choosing Nuxt or Odoo.

**Constraints:** Preserve unrelated changes, stock Odoo, shared-mode `proxy_mode=False`, cookies, CSRF checks, and tenant routing. Initial implementation scope did not authorize commit, merge, push or deployment; the later owner authorization and integration checkpoint are recorded below. Only the edge publishes ports. Clients sharing a real NAT address still share its budget.

**Ownership:** Inline coordinator owns auth handlers/helper, Nuxt configuration, dedicated Caddy/Compose, deployment tests and documentation. The shared deployment is a regression boundary, not an identity redesign. Final reviewer is read-only.

## Acceptance

- [x] Actual login and TOTP handlers transmit validated edge identity; public XFF/Forwarded values are ignored. Missing, malformed, ambiguous and unsupported authority configuration fails closed.
- [x] Real Caddy requests cannot reset the 20/minute budget by changing XFF or private headers. Credential endpoints share the same zone across backends, including case/encoded/trailing-slash aliases.
- [x] Private socket peers retain different identities even with spoofed headers or Connection-nominated private headers.
- [x] Stock Odoo with two workers sees the two actual client IPs, and failures from one peer do not block successful authentication from the other.
- [x] Shared tenant boundary and rate-limit regressions pass without weakening its Host/dbfilter or proxy-mode rules.
- [x] Relevant deployment suite, `npm test`, web type check/build, architecture and Git policies pass or have a reproduced baseline limitation recorded.

## Execution

1. Write handler wire tests and real Caddy regression probes; run against baseline and preserve expected failures.
2. Add a small dedicated-only opt-in identity validator, use it in login/TOTP, wire its runtime config and Compose setting, and verify RED→GREEN.
3. Move dedicated rate zones before upstream selection, use socket keys, add Nuxt auth/native MFA aliases and exclude overlap/session-info probes. Test real routing, exhaustion, spoofing and independent peers.
4. Build the changed web server and exercise it behind Caddy against isolated stock Odoo/Postgres. Never use `odoo19` or existing service state.
5. Update the edge contract, run integrated checks once, request independent review, fix actionable findings with regression tests, and save evidence.

## Review focus

1. Connection nomination stripping before header overwrite.
2. Alternate credential URLs reaching a different backend/budget.
3. Odoo requires X-Forwarded-Host to enable ProxyFix; XFF alone is insufficient.
4. Opt-in on externally reachable Nuxt would make private headers forgeable; only edge exposure is supported.
5. Shared Host/database selection must stay untouched; direct and shared modes remain distinct.

## Ledger

- Baseline: dedicated/shared deployment tests 9/9. Web preparation is required after `npm ci --ignore-scripts`; initial baseline failed before tests because `.nuxt` was absent, then prepared locally.
- Measurement: coordinator snapshot captured after initial diagnosis; whole-task attribution is incomplete. Global receipt attach hit an unrelated malformed legacy receipt, so this task uses an isolated receipt root. No savings claim.

- Handler TDD: baseline 28 failures/2 passes; corrected implementation and literal Host transport fixture pass 32/32. The two shared checks first failed because Node fetch ignored the explicit Host; using a real Node HTTP request preserves it without mocking tenant checks.
- Edge TDD: all three new real-Caddy regressions failed on baseline and pass on the fixed configuration.
- Fresh runtime: seven checks pass against a new private stack with stock Odoo19 and two HTTP workers; login sees distinct socket peers, one peer's 12 failures do not block the other, aggregate budget and real MFA pass. Stack stopped, scratch named volumes retained.
- Integrated gates: npm test passes (743 tool, 194 contract, 1360 web tests), deployment suite 83/83, shared Node boundary tests 29/29; build and web type check pass. Nuxt prepare was rerun after the build to refresh generated typing paths. Architecture/Git policy and diff check pass.
- Review: independent read-only review found no actionable issues and verified 13 additional exhausted-budget aliases plus duplicate private-header overwrite. No integration or delivery authorization inferred.
- Concurrent main advancement: only `.woodpecker.yml` changed since the task baseline; no overlapping auth/edge edits. No integration was performed.
- 2026-10-14: owner authorized local commit, latest-main integration and task-scoped cleanup. Source fix `845db804`, refreshed candidate `3b24d962`; combined npm test and deployment/policy gates passed. Push/deployment remain outside this authorization.
