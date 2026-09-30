# Shared SaaS gate — package 1: live PostgreSQL SQL evidence

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

**Status:** completed for its scope; this is NOT phase-one acceptance, not the
AC-01/02 ten-tenant matrix, not Odoo, network, TLS, adapter, or deployment
evidence. Execution branch: `codex/shared-isolation` (uncommitted working tree
on top of `d780862e`). No commit/merge/push/deploy was performed.

## Authorized scratch environment

User approved creating new scratch-only resources on local loopback PostgreSQL
(`127.0.0.1:5432`). Names were checked for non-existence before creation; no
pre-existing database was read, modified, or dropped. Inventory:
`/tmp/nasq-shared-gate-sharedgate20260928/RESOURCES.txt`.

- Control database: `nasq_control_scratch_sharedgate20260928`
- Tenant databases (10, synthetic, EMPTY — no Odoo install): `nasq_shared_scratch_sharedgate20260928_t01..t10`
- Scratch root: `/tmp/nasq-shared-gate-sharedgate20260928` (filestores t01..t10, registry/, logs/, fixtures/)
- `odoo19` and all pre-existing databases untouched.

## New evidence: live-SQL integration suite

New file `apps/control-plane/src/__tests__/shared-live-pg.test.ts` (gated on
`CONTROL_TEST_DATABASE_URL` loopback `nasq_control_scratch_*`; skips otherwise).
It runs migrations 1–6 against real PostgreSQL and exercises the REAL store
implementations (not scripted fixtures) with two synthetic SaaS tenants:

1. **Registry publication on live SQL**: `publishRegistryMutation` for two
   tenants; durable filesystem snapshot (`registry/registry.json`) matches SQL
   state; append-only audit rows recorded per mutation.
2. **CAS / reservation / immutability on live SQL**: stale snapshot revision ⇒
   `registry_revision_conflict`; stealing another tenant's host ⇒
   `registry_host_reserved`; rewriting tenant identity ⇒
   `tenant_binding_immutable`; unauthorized actor ⇒ `registry_forbidden`.
   Revision unchanged by rejected mutations.
3. **Recovery from a crashed publisher**: leftover `.pending` barrier plus a
   stale on-disk snapshot; `recoverRegistry` republishes authoritative SQL
   state (both targets, correct revision), recovery audited.
4. **Concurrent enqueue dedup**: 5 parallel `enqueueSharedJob` calls with the
   same provision requestId ⇒ one row, one id, 4 replays; different-actor
   replay ⇒ `shared_replay_forbidden`.
5. **Concurrent claim race**: two parallel `runSharedJob` on one job ⇒ exactly
   one `verified` (effects applied exactly once, events
   prepared→started→verified), the other `shared_job_not_claimable`.
6. **Lease expiry fencing on live SQL**: quarantined to `needs_intervention`,
   fence incremented, lease cleared, expiry audited; the OLD owner's event
   write is rejected by the DB trigger (ownership mismatch); re-claim refused
   while quarantined; new enqueues for the tenant blocked
   (`shared_reconciliation_required`).
7. **Operator recovery of an ambiguous effect**: `recoverSharedJob` with a
   fresh external observation verifies the crashed backup WITHOUT re-applying
   the effect; receipt retains the crashed attempt identity.

## Commands and fresh results

- `CONTROL_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/nasq_control_scratch_sharedgate20260928 NASQ_LIVE_GATE_ROOT=/tmp/nasq-shared-gate-sharedgate20260928 npm -w apps/control-plane test -- src/__tests__/shared-live-pg.test.ts`
  ⇒ **8 passed (8)**.
- Same env + `npm -w apps/control-plane test -- src/__tests__/service.test.ts`
  ⇒ **11 passed (11)** (pre-existing live suite, re-verified).
- `npm -w apps/control-plane run build` ⇒ exit 0 (`tsc --noEmit`).
- Full suite, sequential (live suites share one scratch DB and must not run in
  parallel): same env + `npm -w apps/control-plane test -- --no-file-parallelism`
  ⇒ **25 files passed, 328 tests passed**, zero skips.

## Boundaries of this evidence

- The two live suites use the same scratch database and conflict when vitest
  runs files in parallel; they must be invoked sequentially
  (`--no-file-parallelism`) or in separate runs. Non-live regressions are
  unaffected (they pass with the env var unset, matching the prior handoff).
- Tenant databases t01..t10 remain empty: this gate proves control-plane SQL
  semantics only. AC-01/02 resolver/proxy/session/websocket crossing matrix,
  real Odoo instances, physical fenced adapter, backup/restore authority,
  billing sandbox, TLS/Caddy, and capacity measurements are NOT covered.
- Scratch resources are retained for the next packages; deletion requires
  separate authorization.
