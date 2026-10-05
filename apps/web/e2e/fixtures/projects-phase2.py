# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
assert env.cr.dbname == 'nasq_phase2_20260907', 'isolated database required'
company = env.company
company.currency_id = env.ref('base.SAR')
for login, name, role in [
    ('phase2_manager', 'Phase Two Manager', 'nasq_pmo.role_pmo_manager'),
    ('phase2_reader', 'Phase Two Reader', 'nasq_core.role_employee'),
    ('phase2_no_pmo', 'Phase Two Access Admin', 'nasq_core.role_system_admin'),
]:
    user = env['res.users'].search([('login', '=', login)], limit=1)
    if not user:
        user = env['res.users'].with_context(no_reset_password=True).create({
            'name': name, 'login': login, 'password': 'phase2_test_only_2026',
            'company_id': company.id, 'company_ids': [Command.set([company.id])],
            'group_ids': [Command.set([env.ref('base.group_user').id])],
        })
    if not env['nasq.access.assignment'].search_count([('user_id', '=', user.id), ('role_id', '=', env.ref(role).id), ('company_id', '=', company.id)]):
        env['nasq.access.assignment']._nasq_access_create([{'user_id': user.id, 'role_id': env.ref(role).id, 'company_id': company.id}])
    if login == 'phase2_manager':
        user.write({'group_ids': [Command.link(env.ref('project.group_project_manager').id)]})
    user.write({'nasq_access_managed': True})
    user._nasq_sync_capability_groups()
    print(login, sorted(env['nasq.access.service']._nasq_capability_keys(user=user)))
env.cr.commit()
