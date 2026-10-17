# Tenant backup and restore acceptance — 2026-10-16 (T4)

> Historical evidence imported on 2026-10-17 from documentation commit
> `ad0bed8144ec599e2be3f3c0c5b91f957552f9d9`. The runs below concern source
> `67902a053821ea4895047c804015addcc2e4f15a` and the explicitly named tool
> commits, before the WebVue source/name reconciliation. They were not rerun
> for current WebVue. Results, old NASQ names, commands and source paths are
> retained as historical identifiers, not current operating instructions.
> Tool source is preserved in Git at `002fee8c7a08a63bc4077f9f107819169ef91aa6`;
> The original seven-file implementation is not imported. Current tools are a
> narrower provisioning-only adaptation with separate, fresh evidence requirements.
> This record does not establish current acceptance, merge, deployment or release approval.

Local scratch evidence only. **Not deployment authorization, not production evidence.**

- Script: `tools/foundation_acceptance/backup_restore.mjs` (shared helpers in `lib.mjs`) on branch
  `codex/tools-foundation-provision` (`cfbcf319` add, `002fee8c` tightened checks after review), based on `main` at `67902a05`.
- Command: `NASQ_IMAGE_TAG=67902a0 node --import tsx tools/foundation_acceptance/backup_restore.mjs`
- Images: tag `67902a0` (as in T2). macOS Docker Desktop.

## Journey

1. Provision tenants A and B through the real control-plane worker (as T2) and check edge sign-in and cookie isolation.
2. As A's admin through the edge: create a project, a task and an attachment with known bytes; download it and record its sha256.
3. **Backup through the product path:** `POST /v1/shared/tenants/:id/jobs` (`backup`), executed by the worker
   (`odoo_backup.py capture`). Tenant B is polled during the capture to measure the shared-service outage.
4. A's backup cannot be approved for B (HTTP 409).
5. **Restore through the product path:** `POST .../restore-approvals`, then a `restore` job into the isolated restore
   services (restore-db, restore-odoo); the worker verifies database, filestore, inventory and admin readback.
6. **Publish the restored route:** no product route or CLI exists, so a fenced test-only helper calls `publishOdooRestore`
   (scratch control DB, loopback, `nasq-shared-found*` project only; the function still enforces vendor job authority).
7. On the restored host: admin signs in, `/api/v1/me` is the original admin and company, the project and task exist,
   the attachment downloads with the same sha256.
8. Isolation: A's original session, B's session and the restored session are each rejected on the other hosts with
   `403 tenant_boundary_rejected` (the restore edge also uses its own session keys). A and B still work afterwards.
9. Negative cases: a backup copy missing one attachment member (56 → 55 tar members; the untouched copy passes first)
   fails with `artifact_hash_mismatch`; a restored target whose attachment file was deleted moves from `present` to `unknown`.
10. Historical full teardown removed scratch volumes, the control database and run logs. This is not an approved default for a current rerun; preserve evidence and volumes.

## Runs

| Run | Host load (1 min) | Result |
|---|---|---|
| Implementer, after `002fee8c` | — | 52/52 in 250s |
| Mine, `--keep` then `--down` | ~10–14 | 50/50 in 219s (teardown rows not counted with `--keep`) |
| Mine, full | 8.9 → 67.5 during the run | 52/52 in 191s |
| Mine, full (3 earlier attempts) | 20–26, and one at 67 | FAIL: edge sign-in timed out with `ECONNRESET` (twice), or provisioning went to `needs_intervention` (once) |

T2 (`provision_two_tenants.mjs`) passed 22/22 on the same commit during the same window.

The report associated the failed attempts with concurrent heavy host load (20–67 on 14 cores).
That is a correlation, not an isolated root-cause diagnosis: `ECONNRESET` alone does not prove
that nothing was listening in the container. Preserve the failures alongside the quiet-host
results; the harness was not proven stable under contention.

**Measured outage of tenant B during A's capture:** one outage of 8.3–12.4s per run (capture total ~17–19s). It comes
from `odoo_backup.py capture` stopping the shared `odoo` service, so it hits **every tenant** on that service.

## Product gaps reported at the historical source

1. **No product path publishes a restored target.** `publishOdooRestore` (`apps/control-plane/src/shared/odoo-backup.ts:111`)
   is called only from tests; `http.ts:389-410` and `admin.ts` expose no publication. `docs/verification/shared-restore-acceptance.md`
   and `docs/superpowers/plans/2026-10-01-shared-saas-restore.md:36` describe an operator helper that no longer exists.
2. **Backup effect output parsing is fragile.** `odoo_effect.py:169` merges stderr into stdout before `json.loads` in
   `odoo_backup.py:215-226`; any stderr line (e.g. Compose progress output) breaks the capture. The harness sets
   `COMPOSE_PROGRESS=quiet`, which hides only one source.
3. **One failed job stops the worker for all tenants.** At the historical source, a non-transient failure marks the job `needs_intervention`
   (`job-worker.ts:273`) and `job-loop.ts:14-16` stops the process by design. Its intended behavior needs a product decision; no current acceptance is inferred here.
4. **Two paths for the registry.** Capture reads `<stateDir>/registry/registry.json` (`odoo_backup.py:265`), separate from
   `tenantRegistryPath` (`config.ts:49`).
5. **Backup is not live.** Capture stops the shared Odoo service (see the measured outage above).

## Not covered

Live backup without downtime, Linux hosts, stability under heavy host contention, retention/encryption of backups,
and backups of the control-plane database itself.
