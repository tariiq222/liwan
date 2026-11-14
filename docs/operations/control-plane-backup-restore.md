# Control plane database: backup and restore

The control plane's own PostgreSQL database holds every customer, subscription, order, invoice, payment attempt, invoice adjustment (credit and debit notes), audit event, the commercial outbox, the tenant registry bindings and the vendor accounts. Tenant backups (`deploy/backup_pipeline.py`, described in `deploy/OPERATIONS.md`) cover only each tenant's Odoo database and filestore. This runbook covers the other database.

Status: implemented and proven locally against scratch PostgreSQL 16 with a filesystem store. No real bucket has been written, no schedule is installed, and no production restore has been timed. Those are listed at the end.

## What is backed up

| Item | Value |
| --- | --- |
| Source | The control plane database (`liwan_control` in the local harness; the production name is the operator's). |
| Source name in the bucket | `control-plane`. Keys are `control-plane/<hourly or daily>/<UTC stamp>/`. A tenant of that name is refused. |
| Capture | `pg_dump -Fc --serializable-deferrable`, run by `deploy/backup_pipeline.py capture --control-plane`. One transaction-consistent snapshot of this one database, so no quiescence step is needed. The manifest still carries the pipeline's fixed word `UNVERIFIED`; it is never upgraded. |
| Artifact | `database.dump` alone, in the same reproducible archive as a tenant artifact, encrypted with AES-256-CBC and PBKDF2 through `openssl`. Three objects per capture (ciphertext, `checksums.sha256`, keyed manifest), the manifest last. |
| Not in the artifact | Secrets held outside the database: `CONTROL_SERVICE_KEY`, `CUSTOMER_COMMERCIAL_SERVICE_KEY`, `ADMIN_SECRET_KEY`, the payment provider keys, the tenant registry file and the shared runtime config. Keep them in the operator's secret store; a restored database is useless to a control plane that cannot read its keys. |

## Schedule, RPO and retention

Run the script on the host that can reach the control plane database, from the repository root, with the environment described in `deploy/control-plane/env.example`:

```sh
# every 30 minutes, kind "hourly" (kept 7 days)
*/30 * * * *  deploy/control-plane/backup-control-plane.sh hourly
# once a day, kind "daily" (kept 30 days)
15 2 * * *    deploy/control-plane/backup-control-plane.sh daily
# a watchdog from a second host or a second scheduler (it needs only the bucket and alert variables): alerts when the newest backup is older than the RPO
*/10 * * * *  deploy/control-plane/backup-control-plane.sh check
```

The script captures, then prunes with the pipeline's retention rule (hourly 7 days, daily 30 days, the newest of each kind always kept), and on any failure runs `deploy/alerts.py backup_failed --database control-plane --reason ...` (email and Telegram). `check` runs `backup_pipeline.py age --control-plane` and runs `backup_stale --database control-plane` when the newest complete backup is older than 3600 seconds.

RPO. The owner's target is one hour. A dump loses everything written after the newest capture started, so the worst case is the cadence plus the capture duration. At an hourly cadence that is more than one hour, and the age (measured from the capture start) crosses 3600 seconds every hour while the next capture is still running, so `backup_stale` would fire. The 30 minute cadence above keeps the worst case near 30 minutes plus the dump time. This is a property of the schedule, not something the code enforces: the cadence is the operator's entry.

Is a dump enough? For a one hour RPO, yes, provided the cadence is 30 minutes or less, captures complete, and the alerts are delivered. It gives no point-in-time recovery: the data between the newest dump and the loss is gone. Continuous WAL archiving would be needed for an RPO of seconds or to stop at an exact moment before a bad change. It is not built. It would take `wal_level=replica`, `archive_mode=on` and an `archive_command` that encrypts and uploads each WAL segment to the Riyadh bucket (pgBackRest or WAL-G with an S3-compatible endpoint and client-side encryption, or a small script reusing `openssl` and `deploy/s3_client.py`), periodic base backups with their own retention, a monitored archive lag, a point-in-time restore procedure (`recovery_target_time`) and a drill for it. The bucket, region, encryption and alert rules would stay the same.

Storage rules are the tenant ones: an S3-compatible bucket in Riyadh, nothing leaves Saudi Arabia, encrypted before upload. The passphrase file (`LIWAN_BACKUP_PASSPHRASE_FILE`, mode 0600 or 0400) is the only key. Lose it and every backup, tenant or control plane, is unreadable. Keep one copy outside the backup host and outside the bucket (an owner decision, not made here).

Access. `pg_dump` runs as a role that can read every table (`pg_read_all_data` is enough), with the password in a `PGPASSFILE` of mode 0600. The dump contains customer contact data, vendor account and passkey records and audit history; treat the staging directory (`LIWAN_CONTROL_BACKUP_WORK_ROOT`, removed after each run) accordingly.

## While the control plane is lost

Rule R5: the product runs without the control plane. Nothing in `odoo-addons` or `apps/web/app` imports it, and the customer workspaces keep their data, sessions and API. The local fixture `deploy/control-plane-outage/` shows authenticated customer sessions and writes with no contact to the management services; it is not a real outage test.

What stops until the control plane is back:

- Sign-up, the subscription pages and plan or branch changes in the customer UI (they go through the commercial BFF).
- Payments being recorded: the Moyasar webhook and return endpoints, the reconcile poll, invoices, credit notes and the outbox. A customer can still pay at Moyasar; the money is recorded only when the control plane is back (see the reconcile section).
- The commercial scheduler and the shared worker: renewals, dunning, suspension and reactivation pushes, trial endings, tenant provisioning, tenant backup and restore jobs.
- Vendor admin (`apps/vendor-admin`).

What each tenant holds meanwhile: the last status and entitlement the control plane pushed. A tenant suspended for non-payment stays read-only; a vendor suspension stays a full lockout; an active tenant stays active. One limit is time: Odoo itself compares `commercial_valid_until` with today (`liwan_platform/models/entitlement_service.py`, `_liwan_effective_state`), so a tenant whose paid-through date passes while no renewal can be pushed becomes `expired`. An outage that outlasts the earliest such date locks those tenants even though they paid.

## Restore to a new instance

Prerequisites: a new PostgreSQL 16 server (the same major version as the `pg_dump` that captured), the role that will own the objects (for example `liwan_control`), `psql` and `pg_restore` of that version, the repository checkout, the bucket variables and the passphrase file from the operator's secret store, and a private empty scratch directory. Do not start the API, the worker or the shared worker yet.

```sh
export LIWAN_BACKUP_PASSPHRASE_FILE=/path/to/passphrase   # plus the LIWAN_BACKUP_S3_* variables
export PGPASSFILE=/path/to/pgpass
PYTHONPATH=. python3 -B deploy/control-plane/restore_control_plane.py restore \
  --scratch-root /var/tmp/control-plane-restore-<date> --target-db liwan_control \
  --owner-role liwan_control --pg-host <new-server> --pg-user <admin-role> --expect-migration <N>
```

`<N>` is the highest `schema_migrations` version the control plane build you will run records (56 at the time of writing); omit it for a backup taken before that build and run the build's migration afterwards (`npm -w apps/control-plane run migrate`, forward only), then verify again with `restore_control_plane.py verify --target-db liwan_control --expect-migration <N>`.

The script refuses a missing or tampered artifact (the manifest tag is checked before the ciphertext is fetched, both digests before it is trusted), refuses a target database that already exists, refuses `odoo19`, `production`, `postgres` and `template*` names, restores with `--no-owner --no-acl`, and writes `control-plane-restore.json`. It exits 0 verified, 3 not verified, 2 refused. The verification reads back:

- row counts of `tenants`, `customers`, `subscriptions`, `orders`, `invoices`, `invoice_lines`, `invoice_adjustments`, `payment_attempts`, `payment_events`, `commercial_outbox`, `audit_events`, `shared_registry_bindings`, `vendor_accounts`;
- the `invoice_number_seq` position, which must be ahead of the highest issued invoice number (`NSQ-<year>-<serial>`), together with the latest invoice number;
- the highest `schema_migrations` version.

After `pg_restore` and before it reads anything back, `restore` stamps `control_plane_state.restored_at` with the restore time in the new database and records `restored_at_stamped` in `control-plane-restore.json`. The deletion runner starts no customer's workspace deletion until `restored_at` plus 72 hours has passed: from the preflight on, a request that is `due` stays `due` (working and withdrawable) with its hold renewed to that moment and a new notice that says why, and a request that was `deleting` but not committed when the backup was taken is withdrawn by the system, its workspace reinstated, and replaced by a fresh `due` request with the same hold. The reason: a control plane restored from an older backup may have lost a customer's withdrawal of a deletion request, and replaying the old request would destroy a workspace the customer chose to keep. Within those 72 hours the customer or the vendor can withdraw again; the final hold is meant to give that time. A backup taken before the table existed (before migration 66) holds no deletion request to replay, so it stays unstamped and the record says `restored_at_stamped: false`; run the build's migration afterwards as above. `verify` (a read of an already restored database) never writes the stamp, so a database restored by hand with `pg_restore` instead of this script needs exactly `UPDATE control_plane_state SET restored_at = now() WHERE singleton = true;` run against the restored database before the control plane or its shared worker starts. A manual `pg_restore` never writes the stamp, so without that statement a withdrawal lost in the restore would not be protected.

A passing verification says the restored copy is complete and readable. It does not say the copy is current: see the next section.

## Reconcile after a restore up to one hour old

The restored database is the state at the capture start. Everything the old control plane did after that is missing from it, while the tenants and the payment provider kept going. Do these in order, with the workers still stopped.

1. Fix the invoice sequence first. Invoices issued in the gap carry numbers above the restored sequence, and customers may hold them (email, PDF). Issuing from the restored sequence would reuse a number. Find the highest number a customer could have received (outgoing mail logs for the window, the mail provider's sent list) and set the sequence beyond it with a margin, for example `SELECT setval('invoice_number_seq', <highest seen + margin>)`. Numbers in between are gaps that never existed in the restored books; whether a gap in invoice numbering is acceptable is a tax and accounting question for the owner, not decided here.
2. Account for payments in the window (capture start to the moment the old control plane stopped). The reconcile poll (`reconcileUnknownAttempts`, run by the commercial scheduler every `LIWAN_COMMERCIAL_RECONCILE_EVERY` ticks, default 10) looks up payment attempts in status `created`, `unknown`, `redirected` or `pending` at Moyasar, in batches of up to 20 (at most 100), and settles them through the normal order state machine. So an attempt that already existed in the backup and was paid in the gap is found and settled once the scheduler runs. It cannot find what has no row: an order or attempt created after the capture start leaves no record to look up, and a Moyasar webhook for it has nothing to match. For those, list Moyasar payments from the capture start onward in the provider dashboard, compare their ids with `payment_attempts.provider_ref`, and for each unmatched paid one decide with the owner: refund, or re-create the order and attach the payment by hand. Bank transfer claims (`bank_transfer_claims`) made in the gap are lost the same way; ask those customers to resubmit.
3. Compare tenant status. `subscriptions.tenant_status_pushed` (and `tenant_suspension_reason_pushed`) record what the control plane last confirmed written to Odoo, and the status worker pushes only when that differs from the wanted status. After a restore these markers describe the capture time, not the tenant. If the old control plane suspended or reactivated a tenant in the gap, Odoo holds the newer status while the restored markers say it already matches, so the worker will not correct it. For every bound tenant, read its observed status and compare it with the status the restored subscription wants. For tenants that differ, settle the payment question from step 2 first, then clear the markers so the worker asserts the wanted status again, as `finalizeVerifiedRestore` does for a restored tenant database (`apps/control-plane/src/shared/shared-backup.ts`):
   ```sql
   UPDATE subscriptions SET tenant_status_pushed = NULL, tenant_suspension_reason_pushed = NULL,
     tenant_status_failures = 0, tenant_status_next_at = NULL WHERE tenant_id = '<tenant uuid>';
   ```
   Clearing every tenant's markers is safe only after step 2, because a customer who paid in the gap and is still marked unpaid in the restored data would be suspended by the push.
4. Compare entitlements. A plan or branch change applied in the gap leaves Odoo on a newer commercial revision than the restored subscription. No automatic comparison exists for this direction (`reconcileAfterRestore` handles a restored tenant database, the opposite case). Any reconfigure job the restored control plane enqueues carries the restored revision, so read each tenant's observed revision and compare it before the shared worker starts.
5. Start the API, then the worker and the shared worker. Check the audit feed and the attention list in vendor admin for `payment.duplicate_charge`, failed fulfilment and pending suspensions, and re-run `check`.

Write down the capture start time and the time the old control plane stopped; the width of that window is the real data loss of the incident.

## Test the restore

Run the same command against a scratch database on the production host class, at least monthly and after any change to the pipeline or the schema, and keep the JSON record:

```sh
PYTHONPATH=. python3 -B deploy/control-plane/restore_control_plane.py restore \
  --scratch-root /var/tmp/control-plane-drill-<date> --target-db liwan_control_scratch_drill \
  --compare-with liwan_control --pg-host <host> --pg-user <role>
```

`--compare-with` also requires the counts, the sequence and the migration version to equal the live database. They differ by whatever was written since the capture, so a drill on a live system reads the difference, not a pass. Drop the scratch database afterwards. The record holds `backup_age_seconds_at_start`, `elapsed_seconds`, `rpo_ok` and `rto_ok` against the 1 hour and 4 hour budgets, from the same functions the tenant drill uses.

Offline checks: `PYTHONPATH=deploy python3 -B -m unittest deploy/test_backup_pipeline.py` and `python3 -B -m unittest deploy/control-plane/test_restore_control_plane.py` (both run in the CI `static` stage).

## Not covered and still open

- No schedule is installed and no real bucket has been written; the first production capture, its multipart upload and a restore from the bucket are untested.
- The restore was timed only on a tiny scratch database. The 4 hour RTO is unmeasured for the production database.
- The `check` watchdog on the same host as the captures fails with them; it should run elsewhere.
- No point-in-time recovery (see above).
- Entitlement drift after a restore (step 4) and payments that left no row (step 2) are manual decisions.
