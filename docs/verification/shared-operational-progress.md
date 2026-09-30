# Shared operational continuation — in progress

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

This is implementation evidence, **not phase-one acceptance**. Worktree:

> Note (2026-10-01): restore is now wired end-to-end through the signed queue,
> worker and fenced adapter on live local SQL. See
> [shared-restore-queue.md](./shared-restore-queue.md) for the evidence record.
> Historical statements below that restore "remains unavailable" describe the
> checkpoint at which they were written, not the current branch state.
`/Users/tariq/code/nasq-shared-isolation`, branch `codex/shared-isolation`,
starting HEAD `d780862e`. Existing dirty implementation is preserved. No commit,
merge, push, deployment, Odoo or customer database operation is authorized here.
Real Odoo resources and SQL execution need the user's separate approval.

## Scope and ownership

- Coordinator: existing control-plane integration files, registry reader,
  migration registration, final checks and evidence.
- Registry implementer: new `src/shared/registry-store*`, `registry-publisher*`
  and `src/schema_005.sql` within `apps/control-plane`.
- Job implementer: new `src/shared/job-store*`, `job-worker*` and
  `src/schema_006.sql` within `apps/control-plane`.
- Built verification implementer: new `operational-ssr.test.mjs`,
  `operational-probe.mjs`, optional `operational-fixtures.mjs` within
  `tools/shared_isolation_acceptance`.
- Read-only scouts completed; their recommendations are not test evidence.

No parallel writers own an existing shared file. Dependencies and generated
state remain local to the existing execution worktree. The built verification
lane initially targets the historical T20 artifact; final modified-source
verification requires a fresh build owned by the coordinator.

## Fresh commands and results

1. `npm -w apps/control-plane test -- src/shared/provisioning.test.ts src/__tests__/shared-dormant.test.ts src/__tests__/shared-migration.test.ts src/__tests__/shared-registry-refresh.test.mjs`
   - Baseline: 42 passing tests, four files, exit 0.
   - Contract/mock/filesystem tests only, not PostgreSQL or Odoo proof.
2. From `apps/web`: `npm exec -- vitest run server/utils/__tests__/tenantRegistryPublication.test.ts`
   - RED: two tests executed and failed because a pending publication marker
     did not prevent reading the old enabled snapshot.
   - Reader now checks `${registryPath}.pending` with `lstatSync` both before
     and after the snapshot read. Only ENOENT permits proceeding; dangling
     symlinks and other filesystem errors fail closed.
   - GREEN: three tests pass after adding dangling-marker/disabled-snapshot
     coverage. No cached enabled fallback.
3. From `apps/web`: `npm exec -- vitest run server/utils/__tests__/tenantRegistryPublication.test.ts server/utils/__tests__/tenantHostResolver.test.ts server/utils/__tests__/tenantRequest.test.ts`
   - 23 passing tests at the initial two-test publication checkpoint.
4. `npm -w apps/control-plane test -- src/__tests__/shared-registry-refresh.test.mjs`
   - One test passes with the actual guard `requestPlan` consumer: an incomplete
     publication rejects an old valid session; a published disabled snapshot
     still rejects it; a newer reenabled revision rejects the stale cookie.
5. `npm -w apps/control-plane test -- src/__tests__/shared-migration.test.ts`
   - RED: one failure / five passes for missing version-five registration.
   - Registration added; GREEN pending completion of the schema by its owner.

6. `npm -w apps/control-plane test -- src/__tests__/config.test.ts`
   - RED: two failures / 47 passes for the absent registry publication path.
   - GREEN: 49 pass after accepting optional absolute `NASQ_TENANT_REGISTRY_PATH`
     as `tenantRegistryPath`; relative paths rejected, default config preserved.
7. `npm -w apps/control-plane test -- src/__tests__/registry-http.test.ts`
   - RED: four failures, all existing 404 responses. Signed mutation/recovery
     routes must enforce management capability and explicit publication path.
   - Implementation pending the registry writer's final exported interface.

8. `NASQ_TENANCY_MODE=shared npm -w apps/web run build`
   - Fresh shared `.output` build exit 0 (job `bash-122`), including reader barrier.
   - Build emitted plugin-timing and third-party annotation warnings, no fatal error.
   - Operational verifier was instructed to use this artifact rather than T20.
9. `env -u CONTROL_TEST_DATABASE_URL npm -w apps/control-plane test -- src/__tests__/adapter-boundary.test.ts src/__tests__/worker-managed.test.ts src/__tests__/worker-real-adapter.test.ts src/__tests__/shared-dormant.test.ts src/__tests__/config.test.ts`
   - 115 tests pass across five files, exit 0 (job `bash-123`).
   - Legacy/dedicated regression checks with synthetic adapters; no live DB URL.

## Required invariants under implementation

- Explicit immutable UUID control-tenant → registry slug mapping; neither is
  inferred from the other or from public Host.
- PostgreSQL authority, authorization recheck, CAS revisions, permanent identity
  and resource reservation, durable audit.
- Writer raises/fsyncs publication barrier before authority commit; serialized
  publication replaces snapshot atomically and clears barrier only on success.
  Uncertain commit/publication retains fail-closed state. Recovery reads authority,
  never an arbitrary caller snapshot. Operator-controlled filesystem is assumed.
- In-flight requests may already have read a snapshot; no claim of cancelling
  already authorized effects or instantaneous websocket revocation is made.
- Shared jobs require storage uniqueness, persisted intent and immutable binding,
  fenced effect authority, fresh authoritative readback and durable receipts.
  A lease check followed by an unchecked callback is not effect fencing.
- No physical shared provisioner or real backup/restore success is inferred from
  synthetic adapter tests. Default unavailable adapters must remain fail closed.

## Delegation correction and direct implementation checkpoint

All three implementation delegates reported harness write denials and delivered
**no files and no executed tests**. Their guidance is not implementation evidence.
The coordinator implemented the registry slice directly; the scopes listed above
are historical assignments, not a claim of delivered delegated work.

New direct code: `schema_005.sql`, `shared/registry-store.ts`,
`shared/registry-publisher.ts`, their tests, and signed HTTP route integration.
The UUID→slug mapping, immutable identity trigger, retained host history,
authorization inside the transaction, snapshot CAS, publication barrier and
explicit recovery have been written. Deep transaction/fault/concurrency tests
and independent review are still required before calling this complete.

Fresh checkpoint:
`npm -w apps/control-plane test -- src/__tests__/registry-http.test.ts src/shared/registry-store.test.ts src/shared/registry-publisher.test.ts src/__tests__/shared-migration.test.ts && npm -w apps/control-plane run build`
passes 16 tests in four files plus TypeScript, exit 0. Publisher/store initial
RED imports failed because those new modules did not exist; this is missing-module
implementation evidence, not a runtime business-logic reproducer. HTTP tests did
execute and fail at 404 before integration, then passed.

`npm run lint` from apps/web completed exit 0 (job bash-124).

## Deeper registry tests and authenticated SSR checkpoint

- Registry transaction fixture now exercises authorized publish+audit, stale CAS,
  two competing writers, revoked manager, immutable resources, reserved host,
  uncertain commit after disable, and authorized recovery. This is a scripted
  PostgreSQL model with actual filesystem I/O, **not PostgreSQL execution**.
- Independent read-only reviewer found a failed first bootstrap could leave the
  pending marker unrecoverable. A runtime regression failed `registry_empty`
  (one fail/eight pass), then passed after permitting an empty revision-zero
  **deny-all** recovery artifact. Runtime readers still reject empty routing;
  subsequent explicitly authorized creation can proceed. Nine store tests pass.
- Recovery audit renamed `registry.recovery_requested`; it no longer claims
  successful publication before the filesystem step. Audit completion/failure
  semantics and missing-marker tests need further review.
- Review noted in-flight reader timing. Guarantee remains next read/handshake,
  not cancellation of a request that already acquired an allowed snapshot.
- `node --test tools/shared_isolation_acceptance/operational-ssr.test.mjs`
  passed against fresh shared `.output` (job bash-130): 24 authenticated
  `/account` SSR responses, 12 concurrent plus 12 alternating, distinct A/B
  identity and serialized `__NUXT_DATA__`, no other-tenant marker/private token.
  Strict mock requires matching Host/token/revision/cookie; preload restricts
  socket destinations to assigned loopback upstream. Child/listener closed.
  This proves the tested `useMe/useFetch` SSR path only: **not authenticated
  useApi, browser hydration, vendor journey, all caches, or actual Odoo sessions**.
- TypeScript control-plane check passes after the recovery fix.

## Built vendor identity and response semantics

`node --test tools/shared_isolation_acceptance/operational-ssr.test.mjs`
rerun passes (jobs bash-131 and bash-132) on the fresh artifact. In addition to
24 SSR responses it exercises actual built `/api/vendor/v1/context` forwarding:
A/B employee session `res.users` IDs become signed actors verified with the real
`verifyServiceRequest` helper. Incoming spoofed `x-nasq-actor` does not override
session identity; CP receives neither session cookie nor private routing headers.
This is a built BFF journey, not browser vendor-page interaction or real grants.
The strict mock also proves 206 range/content-range/content-disposition handling,
Connection-nominated hop-header removal, and empty 304 with preserved ETag.
Exact binary-byte coverage remains supplied by prior transport tests, not the
text collector in this new SSR harness.

Registry store suite now passes ten tests, including failed missing-marker
recovery audit not claiming `registry.recovered`. No SQL runtime claim.

## Shared queue storage foundation — not operational closure

Added `schema_006.sql` with a separate `shared_jobs` queue so dedicated workers
cannot accidentally claim shared work. Storage specifies tenant/business-key
uniqueness, one running job per tenant, immutable payload identity, fence/lease,
and append-only journal event rows. Migration registration proved RED then GREEN.
Added `shared/job-store.ts` trusted binding helper and initial PG enqueue path.
It rejects caller binding/key overrides and uses the existing business key/digest
semantics. Three binding tests plus seven migration tests pass; types pass.

**Important incomplete boundary:** provision enqueue currently refuses with
`shared_policy_authority_unavailable` until policy is derived from trusted catalog;
restore refuses with `shared_restore_authority_unavailable` until its stored
backup/approval path is complete. Backup insertion exists but is not wired to HTTP.
There is no shared job worker implementation yet. No schema006 live SQL or
physical effect fencing claim is justified by these tests.

## Initial worker implementation checkpoint (not accepted)

Added `shared/job-worker.ts`: separate queue claim, fresh binding/grant checks,
lease+attempt+fence CAS on journal updates, durable prepared/started events before
adapter invocation, observation-based result verification, and transactional
receipt completion. Default absent adapter refuses before any claim. Only that
refusal test has run; **effect fencing, crash recovery and journal behavior still
need executable regression tests and independent review**. The adapter interface
requires physical enforcement; an interface promise is not live fencing proof.
Worker is not wired into worker-main and no physical adapter is installed.

Provision enqueue now derives policy from locked published catalog selected by
its enrolled tenant, not caller policy. Runtime RED missing derivation function
then GREEN four job-store tests. Combined worker/store tests five pass and
TypeScript passes. Restore authority and operational route integration remain
unfinished. This supersedes the earlier provision-refusal checkpoint only.

## Worker model verification checkpoint

Worker tests now exercise prepared/started persistence before mock effect,
verified receipt after matching readback, stale ownership before effect,
started+absent readback never re-executed, adapter exception quarantine,
partial/unknown observation quarantine, disabled binding refusal, and foreign
readback rejection. `npm -w apps/control-plane test -- src/shared/job-worker.test.ts src/shared/job-store.test.ts`
passes 13 tests (nine worker/four store). TypeScript passed at the preceding
five-worker-test checkpoint. Tests use a scripted storage model and mock adapter;
no physical fencing proof, real transactional concurrency, or live recovery scan.

## Upload and cancellation focused checks

Added `tenantBodyLimits.test.ts`: >16MiB incoming rejection413, exact16MiB byte
preservation, stalled stream destroyed at15s total deadline using fake timers.
Extended actual socket `tenantTransport.test.ts`: after upstream receives request,
client aborted event rejects operation, closes upstream socket, removes listener,
and a subsequent request succeeds. Four tests across both files pass.

First upload test run exhausted Vitest worker heap because deep equality
enumerated a16MiB Buffer; replaced test assertion with length+Buffer.equals,
then rerun passed in181ms. This was a test assertion memory problem, not evidence
of transport memory safety under arbitrary concurrency. Slow-upload deadline is
a unit/fake-clock proof; compiled HTTP upload/cancellation still needs checking.

## Signed queue integration checkpoint

Added signed `POST /v1/shared/tenants/{UUID}/jobs`, requiring current operations
capability, explicit shared mode and configured registry publication path. Body
is strict `{reason,job}`; enqueue derives authoritative binding and provision
policy. Route authorization reproduced404→403 RED/GREEN; five HTTP guard tests
pass. No physical adapter/run loop is enabled by this route.

Enqueue scripted-PG test now proves two provision request UUIDs return the same
stored ID with one insertion and that caller policy is rejected. Combined store
and worker suites pass14 tests; TypeScript passes. SQL uniqueness remains an
unexecuted database constraint until separately authorized PostgreSQL testing.

## Lease expiry and tenant exclusion checkpoint

Added `expireSharedLeases`: expired running tasks move to needs_intervention,
increment fence and clear lease; never automatically requeue. Runtime RED missing
function then GREEN ten worker tests, types pass. Enqueue and claim now check
other running/intervention tasks under tenant advisory locking; combined worker
and store regression passes15 tests. Dedicated source runtime remains untouched.
A second independent review of queue/worker is running. Physical fencing and
process crash/reconciliation are not proven by these mock checks.

## Broad control-plane regression and second review

`env -u CONTROL_TEST_DATABASE_URL npm -w apps/control-plane test` passed225 tests,
18 files; one PostgreSQL integration suite skipped (job bash-133). This preceded
the additional corrupt-digest regression. Runtime RED then GREEN now11 worker
tests verifies corrupt stored business key/digest is rejected before observation.
TypeScript passed at that checkpoint.

Independent worker reviewer reports physical fence enforcement is still only an
adapter contract; no live adapter proves it. Also flags restore/recovery gap,
stale observation risk, explicit mutation predicates and unresolved-tenant gate.
The gate had already been added during review; journal/receipt updates now also
include attempt/fence/running/unexpired predicates with affected-row checks
(11 worker tests pass). Remaining review items are open; no review pass claimed.

## Fresh-readback regression and async quarantine repair

Independent stale-observation concern reproduced: a mock readback changed from
verified to unknown before completion, but the old worker issued a receipt.
Completion now performs fresh authoritative observation while job/authority/
binding rows are locked; post-effect binding is refreshed too. The new test then
exposed an async `return owned(...)` escaping the surrounding catch; changed to
`return await owned(...)` so failed completion is quarantined. Final12 worker
tests and TypeScript pass. Actual adapter uncached/readback behavior still needs
its own implementation and live proof. Additional reviewer note about cross-actor
replay is open for remediation; no review pass claimed.

## Replay identity repair

Reviewer cross-actor replay finding reproduced with a different authorized
actor, then fixed: exact-key replay requires the stored issuer and actor ID to
match and writes a `shared_job.replayed` audit event. Different actor/issuer
rejected, original actor replay retains same job ID, one insertion. Store suite
passes5 tests including explicit queued/replayed audit assertions; types pass.

## Read-only expired-job reconciliation

Added `recoverSharedJob` as an operator-authorized backend function, not yet an
HTTP endpoint: locks quarantined job, checks current authority/binding, observes
existing effect twice, audits recovery observation, and commits verified journal/
receipt only for an exact matching effect and preexisting started/prepared intent.
It never calls applyFenced. Absent/unknown and explicit sticky intervention stay
quarantined. Two missing-function RED tests then GREEN; final15 worker tests
pass including sticky intervention; types passed at14-test checkpoint.
No actual adapter/recovery drill or process runtime activation claimed.

## SQL event ownership declaration

Added schema006 BEFORE INSERT event guard tying event attempt/fence/sequence to
locked current job, requiring valid lease for running events and permitting only
verified reconciliation for quarantined jobs. Verified terminal row becomes
immutable. Structural RED/GREEN test plus15 worker model tests pass; types pass.
**Structural text assertion is not SQL syntax/execution or enforcement proof**;
real migration/trigger tests remain explicitly unrun. Existing mock recovery
fixtures are not a substitute for the new trigger's actual PostgreSQL behavior.

## Built cancellation and oversized request

Extended fresh-artifact operational harness: actual HTTP POST16MiB+1 returns413
and makes zero upstream upload calls. Actual client socket disconnect after mock
upstream receives the request closes the upstream within3s; another tenant's
subsequent authenticated SSR response remains clean. Harness passes (bash-134,
bash-135). These replace the earlier unit-only limitation for oversized incoming
requests and disconnects; slow upload remains fake-clock-only at this checkpoint.

## Built real-time slow upload

Fresh compiled harness now sends an unfinished POST with one byte each second.
Server resets it at the total15s deadline (ECONNRESET), with no upstream request;
client20s safety timeout does not fire. Following tenant-B SSR still succeeds.
`node --test tools/shared_isolation_acceptance/operational-ssr.test.mjs` passes
in16.0s (bash-136); web `npm run lint` exit0 (bash-137). Slow incoming upload is
now actual HTTP evidence, not only fake timers. No Odoo or existing services used.

## Expiry audit checkpoint

Lease expiry now uses one data-modifying CTE: quarantine + fence increment and
`shared_job.lease_expired` audit insertion succeed or roll back together. Audit
reason records old attempt ID and new fence; last intent journal remains intact
for read-only reconciliation. Missing audit assertion reproduced RED, then15
worker tests pass and TypeScript passes. The SQL shape is checked with mocked
storage only, not actual PostgreSQL atomicity or migration behavior.

## Transaction-model rollback and recovery authorization

Worker test fixture now models BEGIN/COMMIT/ROLLBACK for row+event changes
(previous fake did not undo mutations). A failed completion affected-row CAS
rolls back the provisional verified event and leaves no receipt; subsequent
quarantine has the correct journal sequence. Recovery with revoked operator
permission rejects before external observation.17 worker tests pass; TypeScript
passed at16-test checkpoint. This is a stronger single-transaction model, not
real PostgreSQL lock contention/concurrency or a physical fencing proof.
Live Git status confirms codex/shared-isolation with preexisting dirty work
preserved; no Git integration or external resources touched.

## Recovery binding preflight repair

New test reproduced an external observe call before disabled-binding rejection
in recoverSharedJob. Recovery now validates enabled status, exact binding and
journal against current registry before any adapter observation.18 worker tests
and TypeScript pass. Registry publisher's session-disconnect fencing concern
remains unresolved; no registry concurrency closure is implied.

## Unresolved operation and registry-revision regressions

Added explicit refusal test for another unresolved tenant job before observation
or claim transition. Added post-effect registry revision change regression:
no verified receipt, prepared/started intent retained for expiry/quarantine.
20 worker tests and TypeScript pass. These address missing regression coverage
from review, not a claim of multi-session PostgreSQL race proof.

## Filesystem publication serialization

Both registry mutation and recovery now acquire an exclusive `.publisher-lock`
file before PostgreSQL locking and hold it until all publication work settles.
Loss of the PG session alone therefore cannot admit a second compliant local
publisher. Real filesystem tests verify paused-owner exclusion and refusal to
steal crash leftovers;15 registry publisher/store tests and types pass.

Scope: one shared local filesystem and consistent configured path, all writers
using this protocol. No TTL/PID stealing. A hard process crash can leave the
lock and pending marker; offline operator repair must stop every publisher before
removing a leftover lock, retaining pending barrier and recovering from SQL.
This adds a deliberate availability tradeoff, not automatic crash recovery or
multi-host filesystem certification. Independent review is pending.

## Actual publisher crash check

Publisher test now launches a fresh Node process importing the actual publisher
module, waits for exclusive lock + pending barrier, then SIGKILLs only that test
child. Both files remain and a new owner is refused (no timeout/PID takeover).
6 publisher tests and TypeScript pass. Temporary crash evidence is retained;
no existing process or resource was killed. This proves local process-crash
fail-closed behavior, not a live PostgreSQL disconnect/recovery drill.

## Store-level publication ownership regression

Additional integration-model test holds actual filesystem ownership and calls
both publishRegistryMutation/recoverRegistry. Both refuse before any SQL query;
after owner release authorized mutation succeeds.17 publisher/store tests pass.
This verifies both public store entrypoints use the lock, not only the standalone
filesystem helper. Pending independent review and real SQL drill still apply.

## Publication review follow-up

Independent reviewer supports exclusive filesystem ownership across full store
operation, no time/PID stealing, and offline crash repair; this is design feedback,
not final acceptance. Test now proves parent cannot acquire while child is alive
as well as after its crash. Separate failure test proves a live failed publisher
releases ownership but retains pending barrier; a following locked completion
succeeds. Low-level primitive lock prerequisites are documented.18 registry tests
and TypeScript pass. Exact post-rename pause/SQL-disconnect drill remains unrun.

## Exact post-rename race boundary

Added controlled pause immediately after real filesystem rename and before
pending-barrier clearing. Competing publication is refused, marker remains,
and the completed snapshot stays at revision2 rather than reverting to1.
Initial run failed because native ESM rename cannot be spied on; a Vitest-only
module wrapper delegates to real rename and enables the pause.8 publisher tests
and TypeScript pass. This is a deterministic in-process pause plus earlier
cross-process lock evidence; actual PostgreSQL disconnect drill remains unrun.

## Recovery attempt integrity

Added application-level check that recovery journal attempt matches stored job
attempt before observation, complementing SQL event guard. A mismatched attempt
regression initially incorrectly returned a verified receipt in the storage model;
now rejects as corrupt. Recovery fixtures carry realistic attempt IDs.21 worker
tests and TypeScript pass. Actual SQL trigger remains unexecuted.

## Fresh broad regression after publication/recovery changes

Provision enqueue test now changes authoritative catalog policy between distinct
request IDs: idempotency_conflict is required, with one stored job and no extra
success audit. Full control-plane suite passes243 tests in19 files, one real-PG
suite skipped; TypeScript passes (bash-140, credentials unset). Existing dedicated
and managed regression suites included. No SQL migration or physical shared
adapter evidence is inferred from those existing suites.

## Queued journal validation ordering

Claim preflight previously passed null journal to reconciliation, allowing an
external observe call before discovering a mismatched stored journal. Regression
reproduced that call; claim now validates the actual journal before changing
state/fence.22 worker tests and TypeScript pass. Corrupt queued work remains
unclaimed; no physical effect or external observation occurs for that case.

## Safe numeric fencing boundary

Claim previously converted PostgreSQL bigint fence to JS Number without range
validation. Four RED cases (unsafe bigint, MAX_SAFE_INTEGER increment, negative,
non-numeric) now fail before claim mutation or adapter dispatch.26 worker tests
and TypeScript pass. This prevents precision-loss tokens; it does not implement
physical effect fencing or change the no-adapter runtime default.

## Shared dispatch tick scaffold

Added job-dispatcher.ts: refuses before database access without trusted adapter,
expires leases, selects oldest eligible queued job excluding unresolved tenants,
and delegates actual claim/authorization/fencing to runSharedJob. Selection is
not a claim; lost candidate races return contended. Three mock dispatch tests
and TypeScript pass. Dedicated worker-main unchanged; no daemon or physical
adapter activated. Independent worker follow-up review requested on latest code.

## Dispatch failures and recovery fence review

Dispatch tests expanded to7: contention calls worker only once; effect failure
propagates without retry; expiry failure prevents selection. Follow-up reviewer
identified missing recovery numeric fence validation; recovery now normalizes
and rejects unsafe/negative/non-numeric tokens before observation and uses the
validated value for event/CAS.29 worker plus7 dispatcher tests pass, types pass.
Reviewer confirms final target lock/readback path has no newly identified
snapshot race; this is not full approval. Null/malformed recovery journal handling
needs further inspection (claim-before-intent crash may legitimately have none).

## Null journal recovery evidence and review freshness

Four new recovery regressions: null journal (crash between claim and prepared)
remains quarantined for absent/unknown/present readbacks, never creates intent or
effect/receipt; malformed journal rejects before observation.33 worker tests and
types pass. No null-journal TypeError reproduced; reviewer corrected that concern.
Reviewer's final fence note described a stale snapshot: live source lines38-39
already validate recovery fence, with passing negative/unsafe tests. Treat the
finding as fixed by prior checkpoint, not as a new failure or final review pass.

## Scheduler eligibility filtering

Candidate query now excludes disabled/non-SaaS/operations-disabled tenants and
revoked or missing original actor grants before oldest-job selection. Worker
still independently checks live authority under locks; selection is not an
authorization boundary. Query-shape regression RED then GREEN,7 dispatcher tests
and types pass. Live SQL fairness/execution not tested; other corrupt queued-job
starvation cases and full scheduler supervision remain unimplemented.

## First observation authorization checkpoint

New regression revokes membership immediately after claim commit; old code
called observe before detecting revocation. Worker now rechecks current attempt,
fence, lease, grant and binding before its first observation.34 worker tests and
types pass. This narrows the pre-observation gap but does not claim atomic external
read authorization or cancellation of already-started I/O; physical adapters still
need their own enforced boundary.

## Stable publication-lock refusal

Filesystem ownership conflict now returns stable registry_lock_unavailable rather
than path-bearing EEXIST message, preserving OS error as internal cause. All
19 publisher/store tests and TypeScript pass. This completes the review's
low-level deterministic-error request; HTTP still safely maps generic failure
to503 and no operator cleanup endpoint is exposed.

## Signed operational request integrity

Loopback HTTP regressions now verify body tampering is401 for registry mutation,
recovery and shared queue endpoints, plus mutation signature transplanted to
recovery is401.9 HTTP tests pass; types passed at8-test checkpoint. These exercise
actual HMAC verification and HTTP handlers with mock storage, not live SQL or
successful publication/queue end-to-end integration.

## Signed nonce replay check

HTTP fixture now models used issuer/nonce pairs. Reusing an authenticated registry
request is401 even when the first request reached the configured-path503 guard.
10 HTTP tests and TypeScript pass. Nonce uniqueness in PostgreSQL is modeled,
not a live database constraint/concurrent replay certification.

## Positive signed queue route contract

New shared-queue-http.test.ts tests successful signed route dispatch: exact
trusted actor/issuer and URL tenant UUID reach enqueue; new task returns202,
replay200, caller actor override422 without enqueue.3 tests and types pass.
Enqueue service is mocked deliberately: proves HTTP wiring/status/identity, not
SQL insertion, physical execution, or combined end-to-end persistence.

## Shared scheduler lifecycle policy

Added injectable runSharedLoop: idle/contention waits, transient outage backoff,
non-transient propagation, and stop-before-next-dispatch after in-flight work.
Missing module RED then four loop/seven dispatcher tests GREEN; types pass.
No effect requeue logic, no process started, no change to dedicated worker-main.
Still requires production trusted adapter and explicit runtime integration; loop
unit tests are not live worker crash/restart or external-effect proof.

## Dispatch-result validation

Loop now rejects an unknown dispatch state instead of silently repeating ticks
without backoff. Regression initially resolved after two unexpected states; now
rejects on first tick with shared_dispatch_result_invalid.5 loop tests and types
pass. No deployed loop or adapter integration implied.

## Journal sequence overflow guard

Worker/recovery now increment journal sequence through safe integer guard before
any event insertion. Regression with maximum sequence previously persisted an
out-of-contract started event then failed later schema validation; now refuses
without event or adapter effect.35 worker tests and TypeScript pass.

## Restore refusal at execution boundaries

Enqueue-only restore refusal was insufficient: a preexisting persisted restore
payload could reach the trusted adapter through runSharedJob. Both claim and
recovery now explicitly refuse restore until durable approval/backup authority
is implemented. Two runtime RED then GREEN regressions prove no observation,
effect or receipt at either boundary.37 worker tests and types pass. This closes
a fail-open edge, not the missing restore feature; restore remains unavailable.

## Shared worker composition root

Added runSharedWorker to compose actual dispatcher + loop with caller-owned pool,
trusted adapter and AbortSignal; idle waits are interruptible. No pool creation,
migration, signal registration or adapter selection occurs implicitly. Three
composition tests plus12 loop/dispatch tests pass, types pass. Dedicated entrypoint
unchanged and no production caller activated. This is backend integration code,
not production adapter or deployed daemon proof.

## Pending idle wait cancellation

Added runner test that reaches the pending idle timer before aborting (unlike
previous microtask-abort case). Abort clears the timer, removes its listener and
prevents another dispatch.4 runner tests and types pass. Fake timers used; no
process or database shutdown drill claimed.

## Stale binding selection filter

Scheduler now requires exact JSONB payload binding equality with current registry
identity/revision before oldest-candidate selection. No unsafe cast from caller
JSON and no rewriting old task bindings. Query-shape RED/GREEN;7 dispatcher tests
and types pass. This avoids selecting known stale bindings but does not mark them
terminal or provide operator resolution; real PostgreSQL semantics remain unrun.

## Recovery completion CAS rollback

Added recovery-specific failed affected-row CAS regression: provisional verified
event and receipt roll back, started journal sequence remains2, task stays in
intervention and adapter never applies an effect.38 worker tests and types pass.
Storage transaction rollback is modeled; not a live DB contention test.

## Lost verified-commit acknowledgement

Fault model now commits verified row/event then throws a connection error before
acknowledgement. Worker propagates uncertainty without overwriting committed
receipt; a subsequent run refuses the already-verified task and effect count
stays1.39 worker tests and types pass. This models commit ambiguity; no actual
PostgreSQL connection was interrupted and physical effects remain mocked.

## HTTP job validation boundary

Malformed shared job previously surfaced as503 from downstream schema failure.
Route now strictly validates supported provision/backup request ID/version/operation
before enqueue; invalid jobs return422. Four queue HTTP tests and types pass.
Initial type check caught Buffer passed to string parser, corrected and rerun.
Restore is not exposed by this input contract while durable authority is absent.

## Caller authority injection HTTP coverage

Five signed provision requests injecting binding/policy/catalog/businessKey/
payloadDigest now explicitly tested as422 before enqueue; unsupported restore
also422.10 queue+10 registry HTTP tests and types pass. These tests preserve
server-owned derivation without asserting actual storage or provisioning effects.

## Enqueue audit failure rollback

Added scripted-storage regression failing audit insertion after backup job INSERT:
transaction rolls back exactly once, never commits and retains no queued row.
6 store tests and types pass. This checks transaction control flow and rollback
model, not actual PostgreSQL durability under connection loss.

## Consolidated regression checkpoint

Fresh complete control-plane run:293 tests pass across23 files, one live-PG suite
skipped; TypeScript passes (bash-145). Covers current runner/loop/dispatch,
worker/store, HTTP, publication, and existing dedicated/managed regressions.
New read-only independent review requested for lock ordering, ambiguous effect
retry and starvation on current code; pending, no verdict claimed.

## Independent review: execution readback lock scope

Review identified external observe awaited under job/binding/authority locks.
Execution final readback now occurs outside the transaction, followed by current
ownership/authority/binding checks and conditional receipt write.40 worker tests
and types pass, including transaction-state assertion on every run observation.
Recovery still holds locks across observation and needs analogous refactoring.
External effect stability remains a trusted adapter requirement, not an atomic
cross-system snapshot guarantee. Review starvation claim withdrawn by reviewer;
persisted started intent survives unavailable post-effect quarantine, but expiry
and operator reconciliation remain required. No final acceptance verdict.

## Recovery readback lock scope fixed

Recovery now snapshots a validated quarantined task in a short transaction,
observes externally without locks, then reloads current authority/binding/state
and compares attempt/fence/journal before finalization.41 worker tests and types
pass, including a fence change during readback: no event/receipt written. SQL
concurrency still modeled and stable external evidence still adapter-dependent.

## Unlocked recovery race coverage

Four additional regressions change authority, registry revision, journal sequence
or attempt during external observation. Each refuses finalization with no event,
receipt or applied effect; task remains quarantined.45 worker tests and types pass.
Independent followup found no demonstrated identity/authority bypass in the
lock-scope refactor. Reviewer confirmed second-read mismatch fails closed through
verifiedReceipt; neither read constitutes an atomic external evidence snapshot.
Race state changes use the scripted fixture, not concurrent live SQL sessions.

## Recovery second-observation disagreement

Added four regressions where first read is verified but second is absent, unknown,
partial or foreign-bound. All reject, retain intervention, and write no verified
event/receipt or physical effect.49 worker tests and types pass. This exercises
reviewer's safe-failure expectation; does not create atomic external snapshots.

## Post-review full regression

Fresh full control-plane check after lock-scope fixes:303 tests pass across23
files, one live PostgreSQL suite skipped; types pass (bash-147). The offline
publisher recovery runbook is in shared-registry-offline-recovery.md; no repair
executed. Read-only investigation started for remaining useApi/Vue Query SSR
coverage; existing /account proof must not be relabeled data-query cache proof.

## Built useApi / Vue Query SSR isolation

Extended operational-ssr.test.mjs with12 concurrent+6 alternating /search pages,
real useApi project query, same Vue Query key across tenants and tenant-specific
project markers in serialized payload. Exact upstream Host/cookie asserted and
foreign marker/private token excluded. Full built test passes including existing
transport deadline/abort/vendor checks (bash-151). Initial fixture lacked PMO
entitlement, leaving query disabled; added explicit read capability+entitlement.
Also corrected branding logo_url null to schema-valid string. No application
production code changed. Browser hydration and real Odoo remain unproven.

## Rendered query HTML assertion

Strengthened /search checks by stripping all script tags before asserting the
own-tenant project marker.18 pages prove actual rendered HTML as well as payload
serialization, not payload-only presence. Entire built operational test passes
(bash-152). This still is not a browser hydration test.

## SSR query cache after entitlement revocation

After successful tenant searches, synthetic /me revokes PMO entitlement for A.
Concurrent new /search requests show A has no previously cached project and makes
no further project upstream call; B still renders its own query data. Entire
built operational test passes (bash-153). This is fresh SSR request isolation,
not revocation of data already delivered to an open browser or live Odoo ACL proof.

## Positive signed registry publication integration

Real loopback HTTP/HMAC → real registry store → real temporary filesystem now
passes:200 revision1, exact snapshot contents, trusted issuer/actor in audit,
pending and publisher-lock absent after success.12 store tests and types pass.
Only SQL responses/transactions are scripted; no HTTP/store/publisher mock in
this test. Live PostgreSQL durability and concurrent nonce storage remain unproven.

## Signed stale-publication conflict integration

Extended successful HTTP→store→filesystem test with a freshly signed stale-CAS
request:409 registry_revision_conflict, unchanged revision/snapshot, no second
audit mutation and no pending/lock residue.12 store tests and types pass. This is
sequential CAS conflict with modeled SQL, not simultaneous database writers.

## Signed recovery after uncertain commit

New HTTP recovery integration begins with modeled SQL commit success/ack loss:
old enabled file remains but pending barrier exists. Signed recovery publishes
revision2 disabled target from SQL model, not old file; audit recorded and barrier/
lock cleared.13 registry store tests and types pass; real filesystem, modeled SQL.
Independent SSR-test review found no demonstrated vacuity: fixed query key,
project-specific HTML+payload markers, exact Host/cookie and entitlement revocation
checks are meaningful. Scope is one query, not every cache key or browser hydration.

## Signed queue-to-store integration

Real HMAC/HTTP + actual enqueue service now exercised together: backup request
returns202, freshly signed replay200 with same task ID, one job INSERT, payload
bound to registry identity and original signed issuer/actor.7 store tests and
types pass. SQL uses scripted rows; no worker or external backup effect executed.

## Runner database error composition

Runner tests now exercise actual database error classifier:08006 disconnect waits
without immediate redispatch and abort cancels backoff;42703 schema error escapes
instead of retrying forever.6 runner tests and types pass. Dispatch failures are
injected; this is not a real connection-loss or shutdown drill. Independent final
local source review requested, distinct from production/phase-one acceptance.

## Unsupported-operation scheduler filter

Selection now limits operations to provision/backup, matching currently available
HTTP/store/worker behavior. A previously persisted unsupported restore therefore
cannot stop the runner at oldest-candidate selection; worker refusal remains as
defense in depth.7 query-shape dispatcher tests and types pass. No live SQL
selection behavior or automated resolution of excluded tasks claimed.

## Exhausted registry revision preflight

Global snapshot max-1 cannot be incremented within schema005's strict bound.
Publisher now returns registry_revision_exhausted before pending barrier or SQL
mutation.14 store tests and types pass. Independent review's broader numeric
claim was checked against source: schema006 does not impose that upper bound on
fence/sequence, and MAX_SAFE_INTEGER itself is representable; no blanket narrowing
of journal/receipt was applied. Reviewer asked to correct that scope.

## Remaining gates

Finish registry and job implementation/integration, run focused and broad local
checks, rebuild and verify authenticated/concurrent SSR and vendor identity,
review independently, fix findings and reverify. Then request explicitly named
isolated test resources for real PostgreSQL migration and Odoo ten-database /
ninety-directional-pair, ACL/image, session/MFA, Caddy/TLS/network proof.
The `non_saas` full offline runtime and phase-one acceptance remain separate
unproven gates. No closure or launch claim is made.
