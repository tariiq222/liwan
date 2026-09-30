# Shared restore queue — end-to-end wiring on live PostgreSQL

> Historical checkpoint: the commands and results below describe the execution
> stage recorded here. This work was committed on branch `codex/shared-restore`
> (based on `844290b9`) and is integrated into local `main`; it is NOT pushed.
> For the consolidated implementation status and
> remaining release gates, see [current hosting status](../project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

**Status:** completed for its local scope on real loopback PostgreSQL. The
shared-tenant restore path is wired end-to-end through a signed HTTP route, an
approval-gated enqueue, a worker/recovery/dispatcher that run restore only
through the fenced adapter, and a single control transaction with explicit lock
ordering. This is NOT a real Odoo/filestore restore, NOT production adapter
evidence, and NOT a launch approval. Execution branch: `codex/shared-restore`
(based on `844290b9`), integrated into local `main`. No push/deploy.

## Scope

The code change in `apps/control-plane` wires shared-tenant restore
end-to-end across four layers: HTTP input validation, approval-based enqueue,
worker/recovery execution through the fenced adapter, and dispatcher integration.
Evidence is live PostgreSQL on disposable local scratch databases.

## Change summary

### HTTP layer

The signed route `POST /v1/shared/tenants/{UUID}/jobs` now accepts a strict
restore job body `{schemaVersion, requestId, operation:'restore', approvalId}`.
Caller-injected fields that should be server-derived return 422.

### Enqueue layer

Enqueue derives everything from `shared_restore_approvals` + `shared_backups`.
Validation requires:

- Approval must be unconsumed and unexpired.
- Approval must reference a verified backup belonging to the same tenant.
- Target must not be reserved (`restore_target_reserved`).
- Duplicate approval use is blocked.
- Replay is actor-bound.

Enqueue checks the reservation (registry) on the HTTP path. Row emptiness is
checked only when a tenant connector is present; on the HTTP path without a
tenant connector, row emptiness is checked at execution under an EXCLUSIVE lock
(see residuals).

### Worker, recovery and dispatcher

All three run restore only through the fenced adapter. `restoreBackupToNewTarget`
executes ONE control transaction with this lock order:

1. `pg_advisory_xact_lock(REGISTRY_ADVISORY_LOCK)` — the same key the registry
   publisher takes.
2. The approval row `FOR UPDATE`.
3. A re-check that the target is unreserved.
4. A tenant transaction: `LOCK TABLE ... IN EXCLUSIVE MODE`, then the emptiness
   check, then the writes.
5. Tenant readback.
6. Conditional consumption plus the `shared_restore.completed` audit.
7. COMMIT.

`finalizeVerifiedRestore` marks the approval consumed exactly once, in the same
transaction as the verified receipt, in both the worker and recovery paths. A
lost acknowledgement therefore cannot leave the approval reusable.

### Advisory lock clarification

A reviewer claimed session-level vs transaction-level advisory locks don't
conflict. This was refuted by the PostgreSQL documentation and by an empirical
two-session test: error `55P03` was observed in both directions.

## Test list

`shared-restore-queue.test.ts`: 17 live tests covering:

| # | Test name | Scenario |
|---|---|---|
| 1 | rejects a cross-tenant approval before queueing | Fabricated tenant id fails with `tenant_operations_unavailable` before reaching the approval lookup |
| 2 | refuses a restore enqueue without a live vendor operations grant | Revoked `vendor.operations.run` → `shared_job_forbidden`; grant restored after |
| 3 | rejects an approval that belongs to another fully registered tenant | Second tenant's approval used by first tenant → `shared_restore_approval_unavailable`; no job queued, no consumption |
| 4 | refuses to execute a queued restore after its grant is revoked | Job queued successfully, but `runSharedJob` with revoked grant → `shared_job_forbidden`; no effect, no consumption |
| 5 | runs an approved restore once through the loopback fenced storage adapter, leaving only source-tenant data | Happy path: enqueue → run → verified; double dispatch → `shared_job_not_claimable`; target carries only source tenant's fencing/effects/admin; neighbour untouched |
| 6 | refuses an already consumed approval at enqueue | First restore consumes the approval; second enqueue → `shared_restore_approval_unavailable` |
| 7 | refuses an expired approval at enqueue | Expired fixture approval → `shared_restore_approval_unavailable` |
| 8 | recovers a crashed restore by readback without a second consumption or re-execution | Simulated crash after applyFenced but before verified; lease expiry → quarantine; `recoverSharedJob` reconciles by readback → verified; no second consumption; direct authority call also refused |
| 9 | rejects at enqueue a target registered to another tenant after approval | Approved target became a registered tenant DB after approval → `restore_target_reserved`; zero jobs, zero audits |
| 10 | rejects at enqueue a target that already carries rows | Foreign rows seeded before enqueue → `restore_target_not_empty`; zero jobs, zero audits |
| 11 | queues a restore whose approved target is not reachable yet; the effect stage decides | Unreachable target (never created) passes enqueue; job stays queued; effect stage decides |
| 12 | serializes a registry binding published while a restore is in flight | Restore holds REGISTRY_ADVISORY_LOCK; concurrent `publishRegistryMutation` blocks deterministically (verified via `pg_locks` waiter query, not timing); publication proceeds only after restore commits |
| 13 | blocks a concurrent target writer until the restore commits, with no mixed state | Writer with `lock_timeout=300ms` hits timeout against restore's EXCLUSIVE lock; restore completes cleanly; only source tenant data lands |
| 14 | applies one effect when two jobs and two calls race on one approval | Second enqueue for same approval refused; two concurrent `restoreBackupToNewTarget` calls → exactly one fulfilled, one rejected; one consumption, one audit |
| 15 | refuses at the effect stage a target bound to another tenant after enqueue | Target free at enqueue, bound to third tenant before effect; `runSharedJob` → `restore_target_reserved`; quarantined; no consumption; direct authority call also refused |
| 16 | quarantines a restore whose target becomes non-empty after enqueue | Target empty at enqueue, foreign rows seeded before effect; `runSharedJob` → `effect_identity_mismatch`; quarantined; no consumption; direct authority call → `restore_target_not_empty` |
| 17 | finalizes a restore whose control acknowledgement was lost after the tenant commit | Effect committed but `beforeConsume` hook throws; approval unconsumed, zero audits; quarantine → recovery consumes approval and records audit exactly once; second recovery → `shared_job_not_recoverable`; consumed approval cannot be reused |

Each fix was demonstrated RED then GREEN. Test 12 checks deterministically
through `pg_locks` that the publication is waiting on `REGISTRY_ADVISORY_LOCK`,
not through timing.

## Commands and fresh results

```sh
# Focused restore queue suite (live PG):
CONTROL_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/nasq_control_scratch_<db> \
NASQ_LIVE_GATE_ROOT=/tmp/nasq-shared-restore-<suffix> \
npm -w apps/control-plane test -- src/__tests__/shared-restore-queue.test.ts
# 17 passed (17)

# Full control-plane suite, serial (live suites share one scratch DB):
# The independent verifier needed --hookTimeout=60000 after the first run's
# shared-backup-restore beforeAll timed out at the default 10s.
npm -w apps/control-plane test -- --no-file-parallelism --hookTimeout=60000
# 381 passed, 0 failed (two consecutive runs by independent verifier)

# Baseline (main): 344 passed, one suite failed to load due to missing
# apps/web/.nuxt (environment issue, not a code regression).

# Full control-plane suite without DB:
env -u CONTROL_TEST_DATABASE_URL npm -w apps/control-plane test
# 329 passed, 8 skipped

# Build:
npm -w apps/control-plane run build
# tsc --noEmit exit 0

# Root suite (without DB env to avoid live-PG conflicts):
env -u CONTROL_TEST_DATABASE_URL npm test
# contracts 178 passed + web/tools 918 passed

# Independent policy review: pass.
# Backup/restore re-review: F1/F2/F3/F6 closed.
```

No regressions vs `main`.

## Explicit remaining boundaries (residuals)

- **N2 — control transaction duration:** the control transaction stays open
  across the tenant write. A slow tenant DB holds a control connection and
  delays registry publications. No `lock_timeout`/`statement_timeout` is set
  on this path; one must be set before production.
- **HTTP enqueue emptiness gap:** enqueue checks the reservation (registry) on
  the HTTP path, and checks row emptiness only when a tenant connector is
  present. Row emptiness on the HTTP path is checked at execution under an
  EXCLUSIVE lock.
- **No filestore re-hash:** the filestore artifact is not re-hashed at restore.
- **Not a real Odoo restore:** tenant storage is synthetic marker schemas. This
  is NOT a real Odoo database + filestore restore, and there is no RPO/RTO
  measurement.
- **Loopback adapter only:** the adapter is the loopback fenced storage adapter,
  not a production Docker/Odoo adapter. No shared daemon is activated.
- **F4 — file parallelism:** fixed by serial execution. Live suites fail when
  run with vitest's default file parallelism, because they share one control DB
  and TRUNCATE the same tables. `apps/control-plane` `test` now runs
  `vitest run --no-file-parallelism --hookTimeout=60000`, so a plain
  `npm -w apps/control-plane test` is green without extra CLI flags; some
  `beforeAll` hooks exceed vitest's 10s default, hence the 60s hook timeout.
  Restoring file parallelism would require a per-file control database, not a
  per-file lock.

## Not proven

- Real Odoo database + filestore restore.
- Production Docker/Odoo adapter fencing.
- RPO/RTO measurements.
- Lock timeout behavior under slow tenant writes.
- Filestore artifact integrity at restore time.
- Any deployment, DNS cutover, or production readiness.

## Incident note (2026-09-30)

An earlier verifier dropped seven pre-existing local scratch databases by
pattern: `nasq_control_scratch_{ci,citest,closure20260930,merge923a,runtime_b72a6,sharedgate20260928,aebb2cfcb0}`.
It did not touch `odoo19` or any customer database. The written evidence in
docs remains valid as records of their runs, but those live databases no longer
exist to re-inspect. Recovery is pending the owner's decision.

A subsequent run by a different verifier cleaned up by exact name only. The new
rule: drop only databases the run created, by exact name — never by pattern.
