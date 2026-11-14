# Tenant deletion effects (operator reference)

Status: implemented and proven locally against a throwaway PostgreSQL cluster and temporary directories. No real tenant, bucket, provider or production-size data was touched. The control-plane runner that sequences these stages is built separately.

The final deletion of a tenant's workspace is a set of separate stages. Each one can be called alone, observes before it acts, treats "already absent" as done, observes again and returns evidence made of states and counts. Nothing returned or logged holds a secret, file content or a name below a removed directory.

| Piece | File |
| --- | --- |
| Stages | `tools/shared_saas_lifecycle/tenant_drop_effect.py` |
| File removal (also run inside the Odoo containers) | `tools/shared_saas_lifecycle/tenant_drop_files.py` |
| Off-site backup purge | `deploy/backup_pipeline.py purge` |
| Tenant marker written at provisioning | `tools/shared_saas_lifecycle/odoo_effect.py` (`liwan.control.tenant_id`) |

## The plan and its digest

Every name comes from the plan the control plane sends; the effect derives nothing. The plan is refused unless `planDigest` equals the SHA-256 of its canonical JSON (keys sorted, no whitespace, non-ASCII kept as UTF-8, strings, integers, booleans and lists only).

```
plan = { schemaVersion: 1, requestId, controlTenantId, tenantId, database, filestore, host,
         customerName, controlPlaneDatabase, restoreCopies: [name], backupIds: [uuid] }
request = { action: <stage>, dryRun: bool, plan, planDigest,
            config: { schemaVersion: 1, projectName, composeFile, envFile, stateDir, domainSuffix, aiEgressDir? } }
```

A mutating stage asks for a permit (`{"permit": "<stage>"}` on stdout, `{"proceed": true}` on stdin, the same protocol as the other effects) once, before its first change. A dry run never asks. The result is `{"result": {...}}`, a refusal is `{"error_code": "<code>"}` and a non-zero exit.

## Stages

| Stage | What it does |
| --- | --- |
| `verify` | Read-only. Name guards, then the identity checks below. An absent database reports `state: absent`. |
| `drop_database` | Runs `verify`, asks the permit `drop-database`, runs `verify` again, closes the database the way provisioning closes it (`REVOKE CONNECT` from `PUBLIC` and the application role, `ALLOW_CONNECTIONS false`, terminate sessions), then `DROP DATABASE ... WITH (FORCE)` and observes that it is gone. |
| `remove_filestore` | Refuses while the database still exists. Resolves `<dataDir>/filestore/<database>` strictly, renames it to `<database>.deleting-<request id>`, removes it, observes. A leftover renamed directory from a crashed run is finished (`state: resumed`). The tenant export archive lives inside the filestore and goes with it (counted as `exportFiles`). |
| `remove_restore_copies` | Only the names in `plan.restoreCopies`, each matching `^liwan_scratch_[a-f0-9]{32}$`: its database in `restore-db`, its files in `restore-odoo`, `restore-effects/<name>.json` and `classifications/<name>.json`. Never enumerates by pattern. |
| `purge_local_backups` | Only the ids in `plan.backupIds`, each `<stateDir>/backups/<uuid>`. |
| `remove_side_files` | `credentials/<db>.json`, `classifications/<db>.json` and `<aiEgressDir>/<db>.hosts`. |

Shared evidence shapes: a file or directory removal returns `{state: absent|removed|resumed|would_remove, files, directories, bytes, exportFiles}` (a single file returns only `state`); a database returns `{state: absent|dropped|would_drop, sessionsTerminated}`.

## Identity checks and refusal codes

The tenant database is dropped only when every check passes. A mismatch is a hard refusal; nothing is guessed or partially matched.

| Check | Code |
| --- | --- |
| Plan is not an object with exactly the plan keys, digest malformed, floats | `plan_invalid` |
| Digest does not match | `plan_digest_mismatch` |
| Database or filestore is not `^[a-z][a-z0-9_]{0,62}$` | `database_name_invalid` |
| `database != filestore` | `database_filestore_mismatch` |
| `postgres`, `template0`, `template1`, `odoo19`, `production`, `liwan_dev`, `liwan_ai`, or a `_`-separated segment `odoo19`, `production`, `prod`, `postgres`, `template0`, `template1` | `database_blocklisted` |
| Equals, or contains as a `_` segment, `plan.controlPlaneDatabase` | `database_is_control_plane` |
| Starts with `liwan_scratch_` (a restore copy, never a tenant drop) | `database_is_scratch_copy` |
| Restore copy name is not `^liwan_scratch_[a-f0-9]{32}$` | `restore_target_invalid` |
| Backup id is not a lowercase UUID | `backup_id_invalid` |
| Host is not a routed host of this runtime | `host_invalid` |
| The identity query cannot be read | `identity_query_failed` |
| `web.base.url` is not `https://<plan.host>` | `identity_base_url_mismatch` |
| `web.base.url.freeze` is not set | `identity_base_url_not_frozen` |
| Not exactly one `liwan.tenant.profile` | `identity_profile_count` |
| Profile is not `commercial_mode='saas'` with entitlement source `control_plane` | `identity_profile_mode` |
| Root company name differs from `plan.customerName` after NFC normalisation | `identity_company_mismatch` |
| `liwan.control.tenant_id` missing / different from `plan.controlTenantId` | `identity_marker_missing` / `identity_marker_mismatch` |
| Filestore stage while the database exists | `database_still_present` |
| Path outside the root, relative, empty or with a bad name; a symbolic link anywhere on the path | `path_invalid`, `name_invalid`, `path_symlink` |
| Target and its renamed twin both present | `filestore_ambiguous` |
| Removal did not finish or the observation after it still sees the target | `remove_failed`, `files_still_present` |
| Fence, drop or SQL failed | `database_fence_failed`, `database_drop_failed`, `database_command_failed` |

Any other failure is reported as `tenant_drop_failed` with no detail.

## The tenant marker

Provisioning (`odoo_effect.py`) writes the system parameter `liwan.control.tenant_id` with the control tenant id, in the same transaction that pins `web.base.url`, and the read-back after provisioning requires it. The provision request must carry `controlTenantId` at its top level (beside `host` and `companyName`), a lowercase UUID; the provision job schema itself does not carry it. Odoo system parameters are writable only by `base.group_system` and Odoo's generic endpoints are closed (the `ir.http` guard), and no LiwanOS API takes a parameter key from a caller. This was read in code; it was not attacked.

## Off-site backups

`python3 deploy/backup_pipeline.py purge --tenant <registry id> --settle-seconds <n>` lists every key under `<id>/`, deletes, waits, lists and deletes again, then lists once more and fails (exit 3, `status: incomplete`) unless the prefix is empty. It refuses an empty id, a slash, anything outside `^[a-z][a-z0-9_-]{0,62}$` and `control-plane`. It is not `prune`: nothing is kept. The report holds counts only.

## What is never touched

The reservation files under `<stateDir>/reservations/` (the tombstone that prevents reuse of the name), the registry row, the control-plane database and its backups, any database or directory not named in the plan, other tenants' prefixes in the bucket.

## Dry run

`dryRun: true` runs every check of a stage and reports what it would do (`would_drop`, `would_remove`, `blockedBy`), changes nothing and asks no permit. `remove_filestore` in a dry run before the database is dropped reports `blockedBy: database_still_present` instead of refusing.

## Not proven locally

- A real bucket: versioning, object lock or cross-region replication keep earlier versions this purge cannot see; `list` shows current keys only.
- Production-size data: no timing, no large filestore, no large prefix on S3 (pagination was proven with a capped fake listing and the S3 client's own tests).
- `docker compose exec` into `db`, `restore-db`, `odoo` and `restore-odoo`: the argument lists are tested, no container was started.
- Release-route admission (`effect_operation`) is not asked: a retiring tenant has no route. The runner must retire the route before calling the stages.
- Backup artifacts the control plane writes as `<backupRoot>/<id>.json` (`shared-backup.ts`) are not under `<stateDir>/backups/` and are not removed here.
- A capture that started before the retirement may still be running outside the settle wait.
