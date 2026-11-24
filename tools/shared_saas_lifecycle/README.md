# Shared SaaS Odoo effects (`tools/shared_saas_lifecycle`)

The physical-effect scripts the control plane worker runs for shared tenants. Each is a stdin/stdout JSON
program with a unit test; the worker adapters that call them are `apps/control-plane/src/shared/odoo-adapter.ts`
and `apps/control-plane/src/shared/admin-password-runner.ts`.

| Module | Purpose |
|---|---|
| `odoo_effect.py` | Provision one scratch Odoo database from a catalog solution and read it back. |
| `odoo_backup.py` | Back up and restore one tenant database and filestore. |
| `subscription_effect.py` | Observe and reconfigure a tenant against its subscription (no module install). |
| `admin_password_effect.py` | Set the tenant administrator password for one accepted invitation. |
| `tenant_status_effect.py` | Set the tenant profile status (`active` or `suspended`) so a suspended subscription stops the tenant's users. |
| `tenant_drop_effect.py` | Final deletion of a tenant workspace in separate idempotent stages (see `docs/operations/tenant-deletion-effects.md`). `tenant_drop_files.py` is its stdlib-only file removal, also run inside the Odoo containers. |
| `tenant_storage_effect.py` | Provision one tenant's object storage: bucket, IAM user, policy and secret key on OCI, wired into the tenant's `fs.storage` record (see "Tenant storage effect"). `oci_provision.py` is the OCI side, run only inside the one-shot `tenant-storage` container. |
| `effect_gate.py` | The only entry to the seven effects above (see below). |
| `effect_schema.py` | The gate's per-effect request schemas: allowed keys, exact types, strict identifier patterns. |
| `scratch_effect.py` | Scratch-only driver used by the packages acceptance test. |
| `catalog_source.py` | Re-export of the registered catalog source resolver from `tools/liwan_cli`. |

## Tenant storage effect

`tenant_storage_effect` (operations `ensure`, `verify`, `rotate`; dropping the resources belongs to the tenant drop effect) keeps no
state of its own: OCI (resources, key ids and ages) and the tenant's `fs.storage` records (`tenant_files`, and `tenant_files_next`
during a rotation) are the truth, and every call reconciles them, so a repeated or interrupted call is safe. One operation per
tenant at a time (an advisory lock file in the effect-owned `tenant-storage` state directory, created by `init-host.sh`; a second call answers `operation_in_progress`).

| Answer | Meaning |
|---|---|
| `result` with `state: pending_key`, `stage`, `retryAfterSeconds` | the key is stored but a new OCI key needs about 7 minutes; call `verify` (or `ensure`) again after that. No call waits |
| `result` with `state: active`, `stage: verified` | a real write and read through the stored key worked; only now is the storage the attachment default |
| `error_code` | `oci_refused`, `oci_unreachable`, `key_not_valid` (not working 15 minutes after issue), `store_failed`, `limit_reached`, `bucket_mismatch` (the stored record names another bucket: never overwritten), or an effect code (`request_invalid`, `operation_in_progress`, `authority_lost`, `script_failed`) |

Stages: `key_stored` (pending) and `verified` (active). The control plane records the answer on the tenant's row (`requestId` is the id of one
run, a fresh uuid per run). The request carries no resource name: the container derives `lw-<24 hex>` from an HMAC of the tenant id with the
naming key, and uses it for the bucket, the IAM user and (per tenant) the group and policy. Policy mode `OCI_POLICY_MODE`:
`per_tenant` (default; one group and one policy per tenant, `target.bucket.name = '<bucket>'`) or `fixed` (one shared policy comparing
`request.user.name` with `target.bucket.name`; unproven on the real account, test it there before relying on it).

The secret key is readable only when OCI creates it. It travels in memory from the container's stdout to the stdin of the Odoo
script that writes `fs.storage`, and is in no answer, log or exception (tests prove it); the gate relays this effect's stdout to the worker.

Who calls it: the shared worker of the control plane (`apps/control-plane/src/shared/tenant-storage.ts`), in a loop of its own beside the job loop
(one run at a time, so a run never holds back a backup, restore or reconfiguration), off unless `LIWAN_TENANT_STORAGE_ENABLED=true`. It adds a `tenant_storage` row for each enabled SaaS tenant whose onboarding is active and
runs `ensure`; a `pending_key` answer schedules `verify` after `retryAfterSeconds`; failures back off (1 minute doubling to an hour) and stop
after six failed runs since the last `active` (a pending answer does not clear the count), until an operator asks again. An operator reads or requests work at `GET`/`POST /v1/shared/tenants/<id>/storage`
(`operation`: `rotate` or `ensure`, with a `reason`; each request is audited as `tenant_storage.requested`; a rotation of a tenant that never stored a key answers 409 `tenant_storage_not_ready`). The product (`odoo-addons`, `apps/web`) does not depend on it, and a tenant outside
SaaS gets no row and keeps local storage.

What bring-up must provide (nothing here edits Compose or host files):

- A compose service `tenant-storage` (profile-gated, never started by `up`), with `logging: driver: none`: the container prints the new secret key on its stdout (the one moment it can be read), and the default `json-file` driver would write it to the host disk: the image that holds this repository's `tools/` and the
  `openssl` binary, entrypoint `python3 -E -s -B -m tools.shared_saas_lifecycle.oci_provision`, `stdin_open` off (the effect pipes the
  request), no published port, on an internal network whose only route out is an allowlist forward proxy (`HTTPS_PROXY`) that permits
  CONNECT to `identity.<home region>.oci.oraclecloud.com:443` and `objectstorage.<region>.oraclecloud.com:443` and nothing else.
- Environment (settings only, no secret): `OCI_TENANCY_OCID`, `OCI_USER_OCID` (the dedicated provisioning user, used for nothing else),
  `OCI_FINGERPRINT`, `OCI_COMPARTMENT_OCID`, `OCI_REGION` (`me-jeddah-1`), optional `OCI_HOME_REGION` (IAM writes go to the home
  region), `OCI_NAMESPACE`, `OCI_POLICY_MODE`.
- Two files, never environment variables, mode 0400 and owned by the container user: `/run/secrets/oci_provision_key` (the API signing
  key; `OCI_KEY_FILE` overrides) and `/run/secrets/oci_naming_key` (random bytes, kept for the life of the deployment: changing it
  changes every name; `OCI_NAMING_KEY_FILE` overrides). The container refuses a file that group or other can touch.
- The shared Odoo must reach `<namespace>.compat.objectstorage.<region>.oraclecloud.com` (add it to its egress allowlist), and the
  OCA `fs_storage`, `fs_attachment` and `fs_attachment_s3` addons must be installed in the tenant database.

The provisioning identity can mint a key for any tenant and delete any bucket; an OCI Audit alert on IAM operations and bucket
deletion is a condition before production, and the backup target belongs to another compartment under another identity.

## Effect gate

`python3 -E -s -B -m tools.shared_saas_lifecycle.effect_gate` supervises one effect per connection, so the networked
worker needs no docker access. systemd starts it per socket connection as the `liwan-effect` account; local stacks and
tests spawn it with pipes. Wire protocol, JSON lines on stdin and stdout:

- in line 1 `{"effect": "<module name>"}` from the fixed map of the seven effects; in line 2 the request (at most 65536
  bytes, no `config` field, matching the effect's schema in `effect_schema.py`: only the keys the control plane sends,
  exact types and sizes, a strict full-match pattern for every identifier, and no `/`, backslash, NUL or `.`/`..`
  value outside the named free-text fields (names, logins, the password, the issuer); anything else is `request_invalid`
  and no effect starts). The gate adds `config` from the file named by its own `LIWAN_SHARED_RUNTIME_CONFIG`
 . Later lines, such as `{"proceed": true}`, go to the effect.
  The peer keeps the connection open until the final line: stdin EOF means it hung up.
- out: the effect's lines unchanged, then `{"exit": <code>}` (128 plus the signal number when a signal ended it).
- refusal: `{"error_code": <code>}` then `{"exit": 2}`, with `request_invalid`, `effect_unknown`, `config_forbidden`,
  `runtime_unconfigured`, `runtime_invalid`, `runtime_untrusted`, `deletion_disabled` or `effect_start_failed`.
- trust rule: the config file, `composeFile`, `envFile` and all their ancestor directories belong to root or the gate's
  account and are not group or other writable; `stateDir` may be group-writable only with the sticky bit and its effect
  subdirectories belong to the gate's account and are not writable by group or other (`backups` is 0750: the worker
  reads manifests there and cannot write; `classifications` is 0755). A real `tenant_drop_effect` run (`dryRun` not `true`) also needs
  `LIWAN_TENANT_DELETION_ENABLED=true` in the gate's own environment.
- the effect runs with an explicit minimal environment in its own process group; on hang-up or SIGTERM the group gets
  SIGTERM, then SIGKILL after 20 seconds.

Run the unit tests from the repository root:

```sh
python3 -B -m unittest discover -s tools/shared_saas_lifecycle -p 'test_*.py'
```

The opt-in Docker lifecycle stack (compose project, Caddy edge, vendor Odoo/web, browser journeys, fault and
restore acceptance) was removed when the vendor console moved to `apps/vendor-admin` and every vendor call began
to require an account session. Its recipe and dated evidence stay in Git history and in
`docs/verification/shared-first-tenant-acceptance.md` and `docs/verification/shared-restore-acceptance.md`.
A replacement live stack must serve `apps/vendor-admin` on a vendor host and sign in with the control plane
account model (see `apps/vendor-admin/README.md` and `tools/vendor_admin_local_check.mjs`).
