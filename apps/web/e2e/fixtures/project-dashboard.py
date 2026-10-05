# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, fields
from datetime import timedelta
assert env.cr.dbname == 'nasq_dashboard_scratch_20260907'
env['res.lang']._activate_lang('ar_001')
company = env.company
company.currency_id = env.ref('base.SAR')
users = []
for login, name, role in [('dashboard_manager', 'مدير المشاريع', 'nasq_pmo.role_pmo_manager'), ('dashboard_other', 'مدير آخر', 'nasq_pmo.role_pmo_manager'), ('dashboard_reader', 'قارئ المشاريع', 'nasq_core.role_employee')]:
    user = env['res.users'].with_context(no_reset_password=True).create({'name': name, 'login': login, 'password': 'dashboard_test_only_2026', 'lang': 'ar_001', 'company_id': company.id, 'company_ids': [Command.set([company.id])], 'group_ids': [Command.set([env.ref('base.group_user').id])]})
    env['nasq.access.assignment']._nasq_access_create([{'user_id': user.id, 'role_id': env.ref(role).id, 'company_id': company.id}])
    user.write({'nasq_access_managed': True})
    user._nasq_sync_capability_groups()
    users.append(user)
for index, name in enumerate(['تطوير البوابة', 'تجهيز المركز', 'برنامج التدريب']):
    owner = users[0] if index < 2 else users[1]
    project = env['project.project']._nasq_create_from_policy(name, user_id=owner.id, date_end='2026-12-31')
    project._nasq_set_status(['on_track', 'off_track', 'on_hold'][index])
    env['nasq.project.finance.entry'].create({'project_id': project.id, 'kind': 'budget', 'title': 'الميزانية', 'amount': 10000 * (index + 1)})
    env['nasq.project.finance.entry'].create({'project_id': project.id, 'kind': 'expense', 'title': 'مصروف تشغيلي', 'amount': [5000, 23000, 12000][index], 'expense_date': '2026-09-07'})
    env['project.task'].create({'project_id': project.id, 'name': 'مراجعة التنفيذ', 'user_ids': [Command.set([owner.id])], 'date_deadline': fields.Datetime.now() - timedelta(days=2)})
    env['project.task'].create({'project_id': project.id, 'name': 'اعتماد الخطة', 'state': '1_done'})
env.cr.commit()
print('Isolated dashboard browser fixture created')
