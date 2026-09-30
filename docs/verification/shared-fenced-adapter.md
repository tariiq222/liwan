# Shared SaaS gate — package 3: physically fenced adapter (live SQL)

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

**Status:** completed for its scope. This closes the "storage-boundary fencing"
gap named in the shared local handoff: an adapter whose fencing guarantee does
NOT rely on the worker's `assertOwned` callback. A stale worker that lost
ownership is rejected by the authoritative store itself, even when its
ownership callback lies. It is NOT the production Docker adapter, not Odoo
provisioning, not backup/restore authority, and not a deployment authorization.
Execution branch: `codex/shared-isolation` (uncommitted working tree on top of
`d780862e`). No commit/merge/push/deploy.

## New component: `apps/control-plane/src/shared/fenced-adapter.ts`

`createFencedStorageAdapter({ controlPool, connect })` implements the existing
`SharedFencedAdapter` contract with a cross-database fencing protocol:

1. **Authority serialization:** `applyFenced` opens a control-database
   transaction and takes `SELECT ... FOR UPDATE` on the authoritative
   `shared_jobs` row (resolved via the registry binding → control tenant →
   business key, never caller input).
2. **Re-verification under the lock:** state must be `running`, `attempt_id`
   and `fence` must match the caller's claim, `payload_digest` must match the
   job, and the lease must still be valid. A lease expiry (`expireSharedLeases`)
   updates the same row and therefore cannot interleave between this check and
   the effect write; a stale worker arriving after expiry/fencing is rejected
   here by the authority store.
3. **Fenced effect write:** while holding the authority row lock, the effect is
   written to the TENANT database (connection derived from the immutable job
   binding), which additionally keeps a per-tenant monotonic `shared_fencing`
   row and an idempotent `shared_effects` row keyed by business key + payload
   digest + attempt. Same-attempt retries are no-ops; a different attempt,
   fence, or digest on an existing effect is a hard conflict.
4. **Honest observation:** `observe` returns the stored digest as observed
   truth; a foreign digest surfaces as `effect_identity_mismatch` and
   quarantines the job (the caller's assertion is never trusted).

This is the reference adapter for the shared acceptance environment; the
production adapter (Docker/Compose) remains separately tracked work.

## New evidence: `apps/control-plane/src/__tests__/shared-fenced-adapter.test.ts`

Live PostgreSQL: control scratch DB + the authorized tenant scratch databases
`t01`/`t02` (schema-only, marker tables). Registry bindings are published
through the real `publishRegistryMutation`; jobs are enqueued through the real
`enqueueSharedJob`; execution uses the real `runSharedJob`.

| Scenario | Result |
| --- | --- |
| Two tenants' provision jobs run in parallel through the real worker with the fenced adapter: both `verified`; each effect row lands exactly once in its OWN tenant database; stored digest/attempt match the durable receipts | ✔ |
| Same live attempt re-applied directly (no worker): idempotent no-op, still one row; a forged attempt is rejected `stale_fence` by the authority store | ✔ |
| **The key attack:** job claimed (attempt X, fence 1), lease expired via real `expireSharedLeases` (→ `needs_intervention`, fence 2); the stale worker calls `applyFenced` directly with its OLD attempt/fence and a **no-op `assertOwned` that always succeeds** — rejected `stale_fence`, zero effects written; a forged current-fence attempt is rejected identically; nothing leaks into the neighbour database | ✔ |
| Per-tenant fence stays monotonic across jobs; all effect rows in each database belong to that database's tenant only | ✔ |

## Commands and fresh results

```sh
CONTROL_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/nasq_control_scratch_sharedgate20260928 \
NASQ_LIVE_GATE_ROOT=/tmp/nasq-shared-gate-sharedgate20260928 \
npm -w apps/control-plane test -- src/__tests__/shared-fenced-adapter.test.ts
# 4 passed (4)
npm -w apps/control-plane run build
# tsc --noEmit exit 0
# Full suite, sequential (three live suites share the scratch DB):
... npm -w apps/control-plane test -- --no-file-parallelism
# 26 files passed, 332 tests passed
```

## Explicit remaining boundaries

- The effect storage here is a marker table in the tenant scratch databases —
  it proves the fencing protocol, not a real Odoo database/filestore
  provisioning effect.
- `runSharedJob` still does not abort in-flight adapter calls on runner
  shutdown (pre-existing documented limitation, unchanged).
- Backup/restore authority, provisioner readiness checks, Odoo ACLs,
  TLS/Caddy, and billing remain packages 4–7.
