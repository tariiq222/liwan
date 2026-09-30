# Shared registry and worker — local handoff

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

## Verdict and scope

The requested local implementation/verification deliverable is complete with the
limitations below. This is **not** phase-one acceptance, production readiness,
activation of shared execution, or permission to deploy. The durable registry
and tenant-bound queue/worker code are implemented and locally verified. Physical
execution stays fail-closed without an explicitly supplied trusted adapter.

Execution branch: `codex/shared-isolation`, worktree
`/Users/tariq/code/nasq-shared-isolation`. Existing dirty work is preserved.
No commit/merge/push/deploy, Odoo resource creation or customer database operation
was performed for this objective. `odoo19` was not used for tests.

## Delivered

- Authorized SQL registry schema/store, immutable resource identity, revision CAS,
  append-only history, durable filesystem publication and pending-reader barrier.
- Exclusive non-stealable publisher lock and documented offline recovery procedure.
- Registry-bound shared queue, server-owned provision policy, business-key/digest
  replay checks, signed actor binding and audit in the insertion transaction.
- Worker attempt/fence/lease ownership checks, durable prepared/started intent,
  fail-closed ambiguous-effect reconciliation and conditional verified receipts.
- Dispatcher/loop/runner composition with expiry, eligibility filters, cancellable
  idle/backoff waits and explicit adapter requirement; no daemon activated.
- Positive signed HTTP-to-store publication/recovery and queue/replay tests.
- Built Nuxt authenticated concurrent/alternating SSR identity and one actual
  useApi/Vue Query query with per-tenant HTML/payload markers, revocation checks,
  transport byte/deadline/abort behavior and signed vendor actor forwarding.

## Verification

- `env -u CONTROL_TEST_DATABASE_URL npm -w apps/control-plane test && npm -w apps/control-plane run build`:
  **309 tests passed in23 files; one live-PG suite skipped; TypeScript passed**
  (bash-172).
- Focused web tenant routing/publication/request/transport/body-limit/proxy/SSR
  forwarding suite: **32 tests in7 files passed**; `npm -w apps/web run lint`
  passed (`vue-tsc --build --noEmit`, bash-170).
- `node --experimental-strip-types --test tools/shared_isolation_acceptance/operational-ssr.test.mjs`:
  passed against built Nuxt, synthetic loopback upstream (bash-164). Includes
  18 /search query SSR checks plus entitlement-revocation requests and prior
  /account, transport and signed vendor checks. No browser JavaScript executed.
- Independent read-only review found the external-read-under-SQL-lock issue;
  fixed in execution and recovery, with race tests and followup review. Final
  scoped registry/job/HTTP/schema review found no concrete remaining correctness
  bugs. An overstated numeric finding was withdrawn after source verification.
  Review is not proof of absence of bugs or operational acceptance.

## Explicit limitations and next approval boundary

SQL is modeled in shared integration tests: schema migration, triggers, real
concurrent SQL sessions, locking and durability have **not** been certified.
Filesystem/HTTP/socket tests are real local operations, not production topology.
The trusted adapter contract does not itself implement physical fencing; there
is no production shared adapter and no shared process activation. Restore remains
unavailable at HTTP/store/worker boundaries pending persisted backup authority
and separately authorized approvals. Neither repeated readback nor a callback
provides an atomic cross-system snapshot. In-flight adapter calls are not aborted
by runner shutdown. Pending markers prevent new routing reads, not already
in-flight traffic. Stale publisher locks require approved offline quiescence.

SSR evidence covers one Vue Query key and fresh server requests, not every query,
browser hydration, client navigation/session-switch caches or real Odoo ACLs.
Live PostgreSQL and Odoo resources require separate explicit approval. Phase-one
closure requires ten database/filestore isolation, ninety directional pairs,
session/MFA/ACL/company and Caddy/TLS/network-bypass drills. Later provisioner,
backup/restore, onboarding/billing, non_saas and launch work is not silently
included in this local handoff.

## Evidence map

- `shared-local-acceptance-matrix.md`: current concise evidence by objective.
- `shared-operational-progress.md`: chronological checkpoints; earlier counts
  and remaining-gate notes describe their historical checkpoint, not this verdict.
- `shared-registry-offline-recovery.md`: unexecuted operator recovery procedure.

## Self-evaluation

| Axis | Score | Evidence / improvement |
| --- | --- | --- |
| Accuracy | 4/5 | Fresh tests and source-checked review; modeled SQL remains a material evidence limit. |
| Completeness | 4/5 | Local registry/worker/SSR/transport and review delivered; physical execution and browser hydration not established. |
| Clarity | 4/5 | Matrix and this handoff separate evidence classes; chronological log is long and can look contradictory if read as current state. |
| Actionability | 4/5 | Exact commands, paths and approval boundary supplied; operator drill still needs an approved isolated environment. |
| Conciseness | 2/5 | Incremental log grew beyond700 lines with repeated gates; use this handoff/matrix as primary summary. |

Overall: **3.6/5**. Highest-impact improvements: approved real SQL concurrency
verification, browser hydration coverage, and a physically fenced adapter before
activation. Immediate documentation improvement applied: this single handoff
supersedes scattered incremental status for current scope. Would the user agree?
Likely on the local evidence, but not if interpreted as a runnable shared SaaS
release; that interpretation is explicitly rejected above.
