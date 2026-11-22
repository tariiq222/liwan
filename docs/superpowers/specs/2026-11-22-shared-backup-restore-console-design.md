# Backup and restore of a shared-mode workspace from the vendor console

> Design for plan task T43 of [the audit fixes plan](../plans/2026-11-21-vendor-console-audit-fixes.md). Status:
> the owner took the decisions of section 4 on 2026-11-22; not built. The study read code only; nothing was run.
> `CP` is `apps/control-plane/src`, `VA` is `apps/vendor-admin`.

## 1. What exists today, and what is missing

Server:

- Start a backup: `POST /v1/shared/tenants/:tenant/jobs` with `{reason, job:{schemaVersion:1, requestId,
  operation:'backup'}}` (`CP/http.ts`, `CP/shared/job-store.ts`).
- Job progress: `GET /v1/shared/tenants/:tenant/jobs/:job` returns `state`, `operation`, and `backupId` once
  verified (`CP/shared/odoo-backup.ts`).
- Restore approval: `POST /v1/shared/tenants/:tenant/restore-approvals` with `{backup_id, reason}` returns
  `{approval_id, expires_at}`. It checks the backup manifest hash and reserves a new target database
  `liwan_scratch_<uuid>`. Its lifetime is fixed at one hour.
- Run a restore: the jobs route with `operation:'restore', approvalId`. The server builds the payload from the
  approval. One approval gives one job.
- Publish the restored copy: `GET|POST /v1/shared/tenants/:tenant/restore-publications/:approval`. Publishing gives
  the copy its own host `r<approval>.restore.<suffix>`.
- Recover and abandon a stuck job.

Console: `VA/app/pages/operations/[id].vue` offers publish, recover and abandon for shared jobs. The proxy passes
`shared/tenants/**`.

Missing:

1. The console cannot start a shared backup. `TenantOperationsPanel.vue` posts to the dedicated-mode route, and
   `availableTenantOperations` returns `[]` in shared mode, so the form is hidden.
2. No route lists the backups of a workspace. A backup id is visible only through the progress route of its own job.
3. No route lists approvals. An approval id the browser loses cannot be found again.
4. No console screen calls `restore-approvals` or queues a restore job.
5. The approval row does not store who approved (`CP/migrations/schema_007.sql`); only the audit event does.

## 2. Operator flow

| Step | Screen | Route |
| --- | --- | --- |
| 1. Start a backup | Workspace page, Operations tab, new "Backups" section: reason, then an inline confirmation that states the outage. | Existing `POST …/jobs` (backup); then the operation page. |
| 2. See the backups | The same section: time, state, who started it, and whether a restore exists for it. | New `GET /v1/shared/tenants/:tenant/backups` (`vendor.read`): verified backups with their job id, any unexpired unused approval, and the restore jobs made from them. |
| 3. Restore to a separate copy | One action on a verified backup row: reason, confirmation. It makes the approval call, then the job call. An unused approval shows as "resume" on the row. | Existing `POST …/restore-approvals`, then `POST …/jobs` (restore). |
| 4. Publication | The existing publish section of the operation page, unchanged. | Existing `restore-publications`. |

The Operations tab shows this section in shared mode although `available_operations` is empty. The list route also
says whether a backup can be started now.

## 3. Safety rules

- Who: backup, approval and restore need `vendor.operations.run`, checked again inside the transaction.
  Publication needs `vendor.operations.run` and `vendor.tenants.manage`.
- Step-up: every write gated on `vendor.operations.run` already requires a fresh passkey confirmation; the console
  handles `step_up_required` on each call.
- The workspace grant: every step fails unless the workspace is `saas` and `operations_enabled` is true.
- The live workspace during a restore is not touched: a restore writes to a new database and filestore, and the
  server refuses a target that is already bound. No route replaces live data with a backup.
- The live workspace during a backup: the acceptance record
  (`docs/verification/shared-restore-acceptance.md`) says the worker stops the shared Odoo service, checks that no
  writers remain, captures, then restarts it: a short outage for every workspace on the shared stack. This is read
  from the record, not from the adapter code. Task 1 confirms it in the code before the confirmation text is written.
- One job at a time: a job that needs intervention blocks new jobs for that workspace; the console shows this state
  and links to the blocking operation.
- Every write takes a reason of 3 to 1000 characters and writes an audit event. The browser sends only ids and a
  reason; binding, digests and target stay server-derived.

## 4. Decisions (owner, 2026-11-22)

| # | Question | Decision |
| --- | --- | --- |
| D1 | A second person to approve a restore | No: one person with step-up, as the server works today. The approver is stored on the approval row so a second person can be required later. |
| D2 | Gate on starting a backup | A confirmation that states the outage. |
| D3 | Approval and run in the console | One action makes both calls (recommended default, taken). |
| D4 | Approval lifetime | Stays fixed at one hour (recommended default, taken). |
| D5 | Removing a restored copy | Out of this item; the list shows the existing copies (recommended default, taken). |

## 5. Out of scope

Replacing the live workspace with a backup; scheduled backups, retention, deleting backups or restored copies;
customer-initiated backup or restore, and downloading a backup; dedicated-mode backup and restore; the control plane's
own database backup; changes to the worker, the adapter or the publication logic.

## 6. Tasks (one commit each)

1. Server: `GET /v1/shared/tenants/:tenant/backups`, `vendor.read`, shared mode only: a read projection over the
   backup, job and approval tables, with no paths or digests in the response. Confirm the backup outage behaviour in
   the adapter and record it in the route comment. Tests: capability required; another workspace's backups never
   returned; unverified backups excluded; an expired or consumed approval not shown as usable; 503 outside shared mode.
2. Server: record the approver. A migration adds the approving account to `shared_restore_approvals`;
   `approveOdooRestore` fills it; the list route returns the label. Tests: the row carries the actor; old rows read.
3. Contracts: schemas for the backups list in `packages/commercial-contracts`.
4. Proxy: bind `…/backups` to GET and `…/restore-approvals` and `…/jobs` to POST. Tests for allowed and refused methods.
5. Console: the Backups section, read only, used by `TenantOperationsPanel.vue` in shared mode; Arabic and English
   texts. Tests: list, empty, error and forbidden states; hidden in dedicated mode.
6. Console: start a backup: reason, inline confirmation with the outage text, POST, then the operation page. Tests:
   disabled without a reason or the capability; the request body; a cancelled step-up; server error codes mapped to
   messages (check `shared_reconciliation_required` reaches the browser as a 409).
7. Console: restore from a backup: the approval call, then the job call with a client `requestId` kept for a retry;
   "resume" for an unused approval. Tests: both calls in order; a failed second call leaves a row that can be resumed;
   an expired approval disables resume; refresh after success.
8. Docs and live proof: `docs/operations/saas-commercial-runbook.md` with the console path, and the flow added to the
   vendor-admin live proof (`apps/vendor-admin/README.md`).
