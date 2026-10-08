# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seed the e2e scratch database through Odoo (never through the Nuxt UI).

Run by tools/e2e_isolated.mjs after the first install of ``nasq_scratch_e2e``:

    odoo-bin shell -c <scratch conf> -d nasq_scratch_e2e --no-http < tools/e2e_seed.py

Idempotent: it opens the legacy full-product policy once and creates or
resets the two test accounts. The values below are test-only credentials for
the disposable scratch database; they are mirrored (default only) in
e2e.config.ts and can be overridden with E2E_USER_<NAME>_PASSWORD.
"""
import os

DB_GUARD = 'nasq_scratch_e2e'
ACCOUNTS = (
    # login, display name, groups, password env var, default password
    ('e2e_admin', 'E2E Admin', ('base.group_user', 'base.group_system', 'nasq_core.group_employee', 'nasq_pmo.group_pmo_manager',
      'nasq_hr.group_hr_manager', 'nasq_core.group_access_admin'),
     'E2E_USER_ADMIN_PASSWORD', 'nasq-e2e-admin-2026'),
    ('e2e_employee', 'E2E Employee', ('base.group_user', 'nasq_core.group_employee'),
     'E2E_USER_EMPLOYEE_PASSWORD', 'nasq-e2e-employee-2026'),
)

if env.cr.dbname != DB_GUARD:  # noqa: F821
    raise SystemExit(f'e2e_seed refuses database {env.cr.dbname!r}; only {DB_GUARD} is allowed')  # noqa: F821

# Every application of the release is installed; open the full legacy policy
# (pmo.enabled and the rest) once. A configured tenant is never rewritten.
registry = env['nasq.feature.registry']  # noqa: F821
env['nasq.tenant.profile']._nasq_initialize_legacy_policy(registry._nasq_installed_module_ids())  # noqa: F821

users = env['res.users'].with_context(no_reset_password=True)  # noqa: F821
for login, name, groups, password_var, default_password in ACCOUNTS:
    password = os.environ.get(password_var) or default_password
    group_ids = [env.ref(xmlid).id for xmlid in groups]  # noqa: F821
    user = users.search([('login', '=', login)], limit=1)
    values = {'name': name, 'email': f'{login}@example.test', 'group_ids': [(6, 0, group_ids)], 'password': password}
    if user:
        user.write(values)
    else:
        users.create({**values, 'login': login})

env.cr.commit()  # noqa: F821
print('e2e seed done:', [account[0] for account in ACCOUNTS])  # noqa: T201
