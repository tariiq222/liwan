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
| `scratch_effect.py` | Scratch-only driver used by the packages acceptance test. |
| `catalog_source.py` | Re-export of the registered catalog source resolver from `tools/liwan_cli`. |

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
