# Shared operational acceptance matrix — current local checkpoint

This is a current summary, not phase-one closure. Historical incremental command
results are in `shared-operational-progress.md`. Execution tree is
`/Users/tariq/code/nasq-shared-isolation`, branch `codex/shared-isolation`.
No commit, merge, push, deployment, new Odoo resources or customer databases are
part of this work. No tests run against `odoo19`.

## Evidence and remaining boundaries

| Objective | Implemented/local evidence | Not established |
| --- | --- | --- |
| Durable registry authority | Schema005, authorized store/CAS, immutable resource mapping, audit, SQL-derived publication | Live migration/trigger/SQL isolation semantics |
| Publisher crash and conflict | Exclusive filesystem lock, pending barrier, real filesystem tests with paused writer, SIGKILL child, rename boundary and recovery | Distributed filesystem support; executed offline operator repair |
| Worker tenant identity | Registry-derived queue binding and server catalog/policy; worker/recovery revalidate identity, authority and ownership | Physical storage-boundary fencing; deployed shared adapter |
| Duplicate and ambiguous effects | Business key/digest, actor-bound replay, prepared/started intent, verified receipts, no blind replay, expiry quarantine | Live SQL claim races, external effect crash/restart drill |
| Ownership loss | Attempt/fence/lease conditional writes; rollback/lost-ack tests; external observation outside DB transactions with final revalidation | Atomic external observation snapshot; physical adapter guarantees |
| Signed operational HTTP | Real loopback HMAC/tampering/nonce-replay; signed HTTP through real stores for publication, stale CAS, uncertain-commit recovery and queue replay; real publication filesystem | SQL remains modeled; live persistence and concurrent nonce constraint |
| Authenticated SSR | Built /account concurrent/alternating identity checks; /search exercises useApi and same Vue Query key for two tenants, rendered HTML and payload separation | Browser hydration, client navigation/session-switch cache checks; actual Odoo sessions |
| Revocation in SSR | Fresh request after A entitlement revoked has no prior project and no project upstream call, B remains usable | Removal of already delivered browser data; actual ACL enforcement |
| Transport | Built oversized upload413, real slow upload deadline, disconnect propagation, subsequent tenant response,206/304/header checks | Production Caddy/TLS/network bypass and real backend behavior |
| Independent review | Read-only worker review; lock-holding observation finding fixed; followup found no demonstrated identity/authority bypass in refactor | Final whole-change acceptance review; SSR review found meaningful one-query evidence, not all-query/hydration proof |

## Fresh checkpoints

- Full control-plane regression after HTTP/store integrations and runner checks:
  **309 tests passed, 23 files passed, one live-PG suite skipped**;
  `tsc --noEmit` passed after scheduler/exhaustion fixes (bash-172).
- Focused web routing/publication/request/transport/body-limit/proxy/SSR-forwarding
  suite: **32 tests across7 files passed**; `npm -w apps/web run lint`
  (`vue-tsc --build --noEmit`) passed (bash-170).
- Built operational test with search SSR and entitlement revocation passed
  (bash-153). Upstream is a synthetic, tenant-aware loopback server; production
  Nuxt artifact is exercised but no Odoo instance is involved.
- Worker focused suite currently contains49 passing tests. SQL state changes and
  transactions in these tests use scripted fixtures, not a real PostgreSQL server.

## Next bounded work

1. SSR-test review completed; explicit project proxy-token/revision assertions
   and accurate summary log added. Full built test passed again (bash-164).
2. Positive HTTP→store publication/recovery and queue/replay integration completed
   locally: registry store14 tests, job store7 tests, TypeScript passed. SQL remains
   modeled; this does not close live database durability/concurrency validation.
3. Final independent registry/job/http/schema review found no concrete remaining
   correctness bugs in its scope. Reviewer withdrew the overstated numeric-bound
   finding after source recheck. Full regression rerun passed (bash-172). Missing
   physical adapter/restore authority remain explicit, not accepted features.
4. Request separate authorization before any real PostgreSQL/Odoo environment
   drill. Phase-one acceptance needs ten-database/filestore isolation, ninety
   directional pairs, session/MFA/ACL/company and Caddy/TLS/bypass evidence.

Restore remains deliberately unavailable at HTTP, enqueue and worker boundaries.
The current shared runner is explicit composition code, not an activated daemon.
A production provisioner, durable backup/restore approvals, billing/onboarding,
non_saas offline runtime and launch belong to separately tracked unfinished work;
this matrix does not claim their acceptance.
