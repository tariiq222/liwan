# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command

assert env.cr.dbname == 'nasq_charter_flow_20260908'
env['res.lang']._activate_lang('ar_001')
company = env.company
company.currency_id = env.ref('base.SAR')
for login, name, role in [
    ('charter_manager', 'Charter Manager', 'role_pmo_manager'),
    ('charter_reader', 'Charter Reader', 'role_employee'),
]:
    user = env['res.users'].search([('login', '=', login)], limit=1)
    if not user:
        user = env['res.users'].with_context(no_reset_password=True).create({
            'name': name, 'login': login, 'password': 'charter_scratch_only_2026',
            'lang': 'ar_001', 'tz': 'Asia/Riyadh', 'company_id': company.id,
            'company_ids': [Command.set([company.id])],
            'group_ids': [Command.set([env.ref('base.group_user').id])],
        })
        env['nasq.access.assignment']._nasq_access_create([{
            'user_id': user.id, 'role_id': env.ref('nasq_core.' + role).id,
            'company_id': company.id,
        }])
        user.write({'nasq_access_managed': True})
        user._nasq_sync_capability_groups()
manager = env['res.users'].search([('login', '=', 'charter_manager')])
manager.write({'group_ids': [Command.link(env.ref('project.group_project_manager').id), Command.link(env.ref('nasq_core.group_employee').id)]})
env.cr.commit()
print('Isolated charter browser accounts ready')
