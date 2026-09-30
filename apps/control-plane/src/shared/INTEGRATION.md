# Shared provisioning contracts — t3 handoff

> Historical checkpoint: the commands, results, branch and unmerged status below
> describe the execution stage recorded here. Shared packages 1–7 were subsequently
> integrated into `main` through `7ffee66e` and `3fd76c38`. For the consolidated
> implementation status and remaining release gates, see [current hosting status](../../../../docs/project-closure/saas-hosting-direction-status.md).
> This annotation does not rerun tests or broaden the original evidence.

Status: **contract proof only**. No adapter, DB creation, payment, deployment,
worker registration or tenant activation was implemented here. No Compose runtime
is relabeled shared SaaS. The contracts reuse the existing catalog source digest,
control_plane policy envelope and whitelisted receipt pattern (worker.ts
policyForCreate/verifiedManagedCreate/publicReceipt), not their dedicated runtime.

## Interfaces

- `packages/commercial-contracts/src/shared/provisioning.ts`: strict Zod schemas
  for binding, policy, job, backup, observation, journal and receipt.
- `apps/control-plane/src/shared/provisioning.ts`: `bindJob`, `businessKey`,
  `payloadDigest`, `assertSameBinding`, `reconcileSharedJob`, `verifiedReceipt`.
- Jobs are parsed/cloned and recursively frozen. Callers must not mutate them.
- Binding is `{tenantId,database,filestore,registryRevision}`. Revision is positive
  **per tenant**, increments on host/enabled changes; registry snapshot revision
  is deliberately absent. Routing owner agreed to these fields. A host is not an
  identity and must not supply a database name or a new provisioning allocation.
- `currentTarget` adds only `enabled`. Integration extracts these five fields
  from the authoritative routing target; strict validation rejects extra host or
  snapshot fields rather than treating them as job authority.

## Required integration, owned by baseline (t5)

1. Expose the contract file as package subpath `@nasq/commercial-contracts/shared`
   in package.json and replace the temporary relative source imports in planner
   and test. No barrel/export edits were made in t3.
2. Authenticate and authorize using current vendor grants before queueing AND
   executing. Resolve the identity from the trusted tenant registry, not body
   input. Validate published catalog source SHA, tier and derived policy using
   the existing catalog/policy loader. Shape validation is not catalog authority.
3. Add durable `business_key` and immutable canonical job payload/digest. Enforce
   UNIQUE `(tenant_id,business_key)` in the DB. Provision's key is singleton
   `['shared-v1',tenantId,'provision','initial']` for the tenant lifetime, independent
   of requestId, revision or attempt. Same key + different payload = conflict,
   never another job/resource. Same key + same payload reuses the existing job.
   Existing `UNIQUE(actor_uid,issuer,tenant_id,request_id)` is insufficient.
   Transport requestId remains audit metadata; attemptId is execution identity.
   Backup/restore use caller requestId for operation deduplication; retries retain
   it. A new explicit backup/restore request is a distinct authorized operation.
4. Enforce unique tenant/database/filestore in authoritative registry, immutable
   DB/filestore allocation and permanent tombstones. Do not reuse deleted tenant
   identities. A target revision change invalidates old jobs, even with matching
   resources, and requires explicit reconciliation; no automatic job rebinding.
5. In one transaction under a fenced per-tenant lock, persist intent before any
   effect. Each append-only journal event carries immutable job, attemptId,
   monotonically increasing sequence and stage. Enforce CAS on sequence and
   fence; a stale worker cannot write events or issue effects. `execute` means
   permission to CAS prepared→started, commit it, recheck authorization/binding,
   then call a separately trusted adapter while still fenced. It is NOT permission
   to call the adapter directly from an unpersisted decision.
6. Read database, filestore AND artifact manifest through an authoritative adapter.
   `absent` means **all** expected effects absent; inability to inspect is unknown,
   not absent. Partial effect means intervention. Ownership metadata must bind
   business key + payload digest + all binding fields. The `verified` boolean is
   trusted adapter evidence, never an HTTP caller assertion. Checksums and
   consistency in a backup manifest need independent readback/verification.
7. Crash reconciliation never repeats an effect from started/verified when absent.
   It requires intervention. Present+verified with matching persisted intent may
   propose `record_verified`; persist that event by CAS before `verifiedReceipt`.
   Intervention is sticky. Verified replay still requires fresh matching readback.
   Do not mark active from `record_verified`, a journal alone, or a process exit.
8. Receipt construction requires durable verified journal AND fresh readback.
   Persist receipt atomically with operation completion. Reuse existing independent
   policy/module/profile verification for provision. Backup artifact completeness,
   actual file hashes, application consistency and restore health remain adapter
   responsibilities. UUID `approvalId` validates shape only: check its durable
   authorization, tenant, backup digest, expiry and consumption before restore.
9. Restore accepts only exact source binding, including revision. Cross-tenant
   cloning and rebinding old backups after a revision change are deliberately
   unsupported; never strip identity metadata to make an old backup pass.

## Fresh executable evidence

Journeys: provision once across retries; reject identity changes before effects;
reconcile crash without blind creation; retain tenant identity in backup/restore;
issue receipts only after verified journal/readback.

Command from isolated `/Users/tariq/code/nasq-shared-isolation`:

```sh
npm -w apps/control-plane test -- src/shared/provisioning.test.ts
npm -w apps/control-plane run build
npm -w packages/commercial-contracts run build
git diff --check
```

Final result: **33 tests passed**, both TypeScript checks exit 0, diff check exit 0.
RED evidence: initial suite could not import not-yet-implemented shared contract;
receipt extension then executed 33 tests with 1 intended failure
(`verifiedReceipt is not a function`) and 32 passing. GREEN: 33/33 after receipt
implementation. Test narrowing initially failed TS2339 and was fixed; final
builds pass. No commit checkpoint was made (explicitly prohibited).

Coverage command attempted:
`npm -w apps/control-plane test -- src/shared/provisioning.test.ts --coverage --coverage.include='src/shared/provisioning.ts' --coverage.reporter=text`
failed because `@vitest/coverage-v8` is not installed. No dependency/lockfile edits
or coverage percentage claim. Broader existing regression suites belong to t5.

## Limitations and self-check

This proves strict contracts and a pure decision state machine with synthetic
observations. It does **not** prove durable transactions, concurrent-worker
fencing, actual backups, Odoo DB/filestore isolation, or release readiness.
No live databases, upstream Odoo or odoo19 were used.

Self-evaluation (not independent review): accuracy 4/5 (33 executable tests, no
runtime proof); completeness 4/5 (coverage instrumentation unavailable); clarity
4/5 (integration protocol is necessarily detailed); actionability 4/5 (exact
integration hooks supplied but adapter/storage work remains); conciseness 4/5
(handoff duplicates some safety invariants intentionally). Overall 4.0/5.
Priorities: independent review, durable integration with fenced CAS tests, then
instrument coverage when the owner authorizes dependency changes. These limits
are explicit so the reader should not mistake contract completion for release.
