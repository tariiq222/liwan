# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bootstrap one synthetic runtime admin in an already-installed isolated DB.

Invoke only through the fixture's isolated Odoo shell command. This script
never prints or persists the supplied password; it prints only synthetic login.
"""
import os

login = os.environ['WEBVUE_FIXTURE_ADMIN_LOGIN']
password = os.environ['WEBVUE_FIXTURE_ADMIN_PASSWORD']
marker = os.environ['WEBVUE_FIXTURE_MARKER']
company = env.ref('base.main_company')
env['webvue.tenant.profile']._webvue_initialize_legacy_policy(
    env['webvue.feature.registry']._webvue_installed_module_ids(),
)
user_model = env['res.users'].with_context(no_reset_password=True)
user = user_model.with_context(active_test=False).search([('login', '=', login)], limit=1)
values = {
    'name': 'Outage Fixture Administrator',
    'password': password,
    'company_id': company.id,
    'company_ids': [(6, 0, [company.id])],
    'group_ids': [(6, 0, [env.ref('base.group_user').id,
                           env.ref('webvue_core.group_employee').id,
                           env.ref('webvue_core.group_access_admin').id,
                           env.ref('project.group_project_manager').id])],
    'active': True,
}
if user:
    user.write(values)
else:
    values['login'] = login
    user = user_model.create(values)
hr_role = env.ref('webvue_hr.role_hr_manager')
project_role = env.ref('webvue_pmo.role_pmo_manager')
service = env['webvue.access.service'].sudo()
admin_role = env.ref('webvue_core.role_system_admin')
service._webvue_replace_assignments(user, [
    {'role_id': admin_role.id, 'company_id': company.id},
    {'role_id': hr_role.id, 'company_id': company.id},
    {'role_id': project_role.id, 'company_id': company.id},
])
user._webvue_sync_capability_groups()
marker_department = env['hr.department'].search([('name', '=', marker), ('company_id', '=', company.id)], limit=1)
if not marker_department:
    marker_department = env['hr.department'].create({'name': marker, 'company_id': company.id})
env.cr.commit()
print('fixture admin and DB marker provisioned:', login)
