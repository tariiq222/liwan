# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bootstrap one synthetic runtime admin in an already-installed isolated DB.

Invoke only through the fixture's isolated Odoo shell command. This script
never prints or persists the supplied password; it prints only synthetic login.
"""
import os

login = os.environ['NASQ_FIXTURE_ADMIN_LOGIN']
password = os.environ['NASQ_FIXTURE_ADMIN_PASSWORD']
marker = os.environ['NASQ_FIXTURE_MARKER']
company = env.ref('base.main_company')
env['nasq.tenant.profile']._nasq_initialize_legacy_policy(
    env['nasq.feature.registry']._nasq_installed_module_ids(),
)
user_model = env['res.users'].with_context(no_reset_password=True)
user = user_model.with_context(active_test=False).search([('login', '=', login)], limit=1)
values = {
    'name': 'Outage Fixture Administrator',
    'password': password,
    'company_id': company.id,
    'company_ids': [(6, 0, [company.id])],
    'group_ids': [(6, 0, [env.ref('base.group_user').id,
                           env.ref('nasq_core.group_employee').id,
                           env.ref('nasq_core.group_access_admin').id,
                           env.ref('project.group_project_manager').id])],
    'active': True,
}
if user:
    user.write(values)
else:
    values['login'] = login
    user = user_model.create(values)
hr_role = env.ref('nasq_core.role_hr_manager')
project_role = env.ref('nasq_core.role_pmo_manager')
service = env['nasq.access.service'].sudo()
admin_role = env.ref('nasq_core.role_system_admin')
service._nasq_replace_assignments(user, [
    {'role_id': admin_role.id, 'company_id': company.id},
    {'role_id': hr_role.id, 'company_id': company.id},
    {'role_id': project_role.id, 'company_id': company.id},
])
user._nasq_sync_capability_groups()
marker_department = env['hr.department'].search([('name', '=', marker), ('company_id', '=', company.id)], limit=1)
if not marker_department:
    marker_department = env['hr.department'].create({'name': marker, 'company_id': company.id})
env.cr.commit()
print('fixture admin and DB marker provisioned:', login)
