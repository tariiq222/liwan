# Runtime upgrade bounded implementation report

## Changed files

- `odoo-addons/nasq_core/models/access_service.py`
  - Added the explicit approved meeting-permission delta for `role_employee`,
    `role_system_admin`, and `role_vendor_support`.
  - Added private, superuser-only,
    `_nasq_upgrade_builtin_meeting_permissions()`.
  - The hook links only missing `meetings.*` permissions and preserves all
    existing role relations, assignments, and custom roles.
- `odoo-addons/nasq_core/data/access_migration_post.xml`
  - Runs the hook after permission/role seed files and before
    `data/res_users_data.xml`.
- `odoo-addons/nasq_core/tests/test_access_migration.py`
  - Added `test_builtin_meeting_upgrade_is_additive_and_idempotent`.
  - Added `test_builtin_meeting_upgrade_requires_superuser`.

## Focused verification

- `python3` AST parse of `access_service.py` and `test_access_migration.py`: PASS
- XML parse of `access_migration_post.xml`: PASS
- `ruff check odoo-addons/nasq_core/models/access_service.py odoo-addons/nasq_core/tests/test_access_migration.py`: PASS
- `git diff --check`: PASS

Odoo/database tests were not run by this worker per the bounded-task brief;
the root agent must run the TransactionCase methods against the isolated
rehearsal database.

## Residual risk

The runtime hook and TransactionCase assertions still require an Odoo
upgrade/test run to verify XML function execution order and ORM behavior on
the isolated database.
