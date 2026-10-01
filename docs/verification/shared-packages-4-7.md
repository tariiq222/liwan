# Shared SaaS gate — packages 4–7: provisioning, backup/restore, sandbox payment, full journey

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

**Status:** completed for their local scope on real loopback PostgreSQL. These
packages close the remaining shared-lane gates that can be proven without real
Odoo, a real payment provider, TLS/Caddy, or a deployment. They are NOT a
launch approval, NOT real Odoo ACL evidence, and NOT production adapter
evidence. Execution branch: `codex/shared-isolation` (uncommitted working tree
on top of `d780862e`). No commit/merge/push/deploy; no real payment network.

## New migrations (additive, registered transactionally)

- `schema_007.sql` — `shared_backups` (insert-only, `consistency='verified'`
  at insert; no unverified stored state) and `shared_restore_approvals`
  (single-consumption guard: a consumed approval can never authorize a second
  restore; identity immutable).
- `schema_008.sql` — `shared_orders` (immutable quote + idempotency key,
  monotonic attempt counter) and `shared_payment_events` (provider event
  deduplication by event id).

## Package 4 — provision readiness and the activation gate

`apps/control-plane/src/shared/provision-readiness.ts`:

- `bootstrapFirstAdmin` binds the first administrator to the provisioning
  request identity in the tenant database; requires a digest-matched verified
  provision effect; idempotent per request; **no password column exists**.
- `inspectTenantReadiness` performs seven independent checks (verified job,
  provision operation, database connectivity, provisioned effect with matching
  digest, first-admin binding, policy modules, storage fence) — every check
  consults primary state, none trusts caller assertions.
- `activateSharedTenant` re-verifies the job durably inside the transaction
  and flips `tenants.status` to `active` — or records an audited
  `tenant.activation_refused` naming the failed checks and moves the tenant to
  `needs_intervention`. Never a false `active`, never a blind retry.

Evidence (`shared-provision-lifecycle.test.ts`, 4/4): happy path activates
with all seven checks; an unprovisioned tenant is refused with an audited
refusal while the healthy neighbour stays `active`; recovery after repair goes
through the same gate; admin bindings stay in their own databases only.

## Package 5 — backup and restore authority

`apps/control-plane/src/shared/shared-backup.ts`:

- `createTenantBackup`: consistent snapshot in one tenant-DB transaction,
  artifact file with digest, **independent readback verification of both the
  database state and the artifact before any authority record is inserted**.
- `approveSharedRestore`: operator decision referencing one verified backup
  and one explicit NEW target; requires `vendor.operations.run`; refuses any
  registry-mapped database as a target.
- `restoreBackupToNewTarget`: consumes the approval exactly once, refuses
  non-empty targets, applies the snapshot, and verifies the applied state by
  readback before committing consumption. The shared job queue keeps refusing
  restore operations — this module is the deliberate authority those guards
  were waiting for.

Evidence (`shared-backup-restore.test.ts`, 3/3): verified record + artifact
digest match; unverified tenant refused; registry-mapped target refused;
restore lands the source tenant's state (and only it) in the new target;
second consumption refused; re-restore into the now-occupied target refused;
expired approvals and unauthorized actors refused.

## Package 6 — order and sandbox payment lifecycle

`apps/control-plane/src/shared/shared-order.ts`:

- `createSharedOrder`: immutable quote snapshot, unique idempotency key;
  duplicate checkout replays the same order.
- `applyPaymentEvent`: the sandbox provider event is applied exactly once per
  event id; duplicates change nothing; attempts counted monotonically.
- `provisionPaidOrder`: links a paid order to exactly one provision job
  (race-safe without nested transactions; the provision business key is a
  per-tenant singleton so concurrent callers converge on the same job id).
- `reconcilePaidOrder`: `provisioned` only when the tenant is durably
  `active`; otherwise `paid_not_ready` — never a silent success.

Evidence (`shared-order-payment.test.ts`, 4/4): idempotent checkout; duplicate
provider event never charges twice; cancelled/failed payments provision
nothing; paid order converges to one job across retries; full provision →
activate → reconcile reaches `provisioned`; a paid order whose activation gate
never ran reports `paid_not_ready`.

## Package 7 — full journey acceptance

`shared-journey.test.ts` (1/1) walks one synthetic tenant end to end on live
SQL: order → sandbox payment → exactly one provision job → fenced effect in
the tenant database → first-admin binding → seven-check readiness inspection →
gated activation → order reconciled to `provisioned` → verified backup →
approved restore into a NEW target with readback verification — with the
audit trail asserted for every gated decision
(`shared_backup.verified`, `shared_restore.approved`,
`shared_restore.completed`, `tenant.activated`).

## Commands and fresh results

```sh
CONTROL_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/nasq_control_scratch_sharedgate20260928 \
NASQ_LIVE_GATE_ROOT=/tmp/nasq-shared-gate-sharedgate20260928 \
npm -w apps/control-plane test -- --no-file-parallelism
# 30 files passed, 345 tests passed (seven live suites included)
npm -w apps/control-plane run build   # tsc --noEmit exit 0
```

## Consolidated gate status after packages 1–7

| Gate | State |
| --- | --- |
| Live SQL registry/queue semantics, CAS, concurrency (pkg 1) | ✔ proven locally |
| AC-01/02 ten-tenant isolation matrix over the real guard + built Nuxt (pkg 2) | ✔ proven locally (synthetic upstream) |
| Physically fenced adapter; stale owner rejected at the storage boundary (pkg 3) | ✔ proven locally |
| Provision readiness + activation gate; no false active (pkg 4) | ✔ proven locally |
| Backup/restore authority with consistent capture and single-use approvals (pkg 5) | ✔ proven locally |
| Order/payment sandbox with idempotency and paid_not_ready (pkg 6) | ✔ proven locally |
| Full journey with audited gates (pkg 7) | ✔ proven locally |

## Explicit remaining boundaries (unchanged and still binding)

- **Real Odoo is not in the loop**: tenant databases hold marker schemas, not
  Odoo instances; AC-02's "actual ACL enforcement" and AC-06's real first-admin
  Odoo login remain open until an authorized Odoo drill runs.
- **No real payment provider**: the sandbox is an explicit test double;
  provider choice, currencies, taxes, cycles and refund policy remain user
  decisions before any real integration.
- **No TLS/Caddy edge, no production Docker adapter, no capacity
  measurements, no DNS/deployment** — all remain separately authorized work.
- Scratch resources are retained for future drills; deletion requires
  separate authorization.

> Note (2026-09-30): the scratch database `nasq_control_scratch_sharedgate20260928`
> referenced in this document was dropped by a later verification run. The results
> recorded here are historical and the live DB can no longer be re-inspected.
> Recovery is pending the owner's decision.
> Regenerated (2026-09-30): equivalent live evidence was rerun at current HEAD on fresh scratch databases — see [2026-09-30-regenerated-gate-evidence.md](2026-09-30-regenerated-gate-evidence.md).
