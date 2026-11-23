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
| `effect_gate.py` | The only entry to the six effects above (see below). |
| `scratch_effect.py` | Scratch-only driver used by the packages acceptance test. |
| `catalog_source.py` | Re-export of the registered catalog source resolver from `tools/liwan_cli`. |

## Effect gate

`python3 -E -s -B -m tools.shared_saas_lifecycle.effect_gate` supervises one effect per connection, so the networked
worker needs no docker access. systemd starts it per socket connection as the `liwan-effect` account; local stacks and
tests spawn it with pipes. Wire protocol, JSON lines on stdin and stdout:

- in line 1 `{"effect": "<module name>"}` from the fixed map of the six effects; in line 2 the request (at most 65536
  bytes, no `config` field). The gate adds `config` from the file named by its own `LIWAN_SHARED_RUNTIME_CONFIG`
  (`releaseBackupConfig` removed for `tenant_drop_effect`). Later lines, such as `{"proceed": true}`, go to the effect.
  The peer keeps the connection open until the final line: stdin EOF means it hung up.
- out: the effect's lines unchanged, then `{"exit": <code>}` (128 plus the signal number when a signal ended it).
- refusal: `{"error_code": <code>}` then `{"exit": 2}`, with `request_invalid`, `effect_unknown`, `config_forbidden`,
  `runtime_unconfigured`, `runtime_invalid`, `runtime_untrusted`, `deletion_disabled` or `effect_start_failed`.
- trust rule: the config file, `composeFile`, `envFile` and all their ancestor directories belong to root or the gate's
  account and are not group or other writable; `stateDir` may be group-writable only with the sticky bit and its effect
  subdirectories belong to the gate's account. A real `tenant_drop_effect` run (`dryRun` not `true`) also needs
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
