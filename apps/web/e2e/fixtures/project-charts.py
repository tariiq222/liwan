# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, fields

# Odoo shell supplies this environment; the exact database guard comes first.
env = globals()['env']
assert env.cr.dbname == 'nasq_charts_scratch_20260907'
assert not env['res.users'].search_count([('login', '=', 'chart_manager')])
env['res.lang']._activate_lang('ar_001')
company = env.company
company.currency_id = env.ref('base.SAR')
users = []
for login, name, role in [('chart_manager', 'مدير المشاريع', 'nasq_pmo.role_pmo_manager'), ('chart_other', 'مدير آخر', 'nasq_pmo.role_pmo_manager')]:
    user = env['res.users'].with_context(no_reset_password=True).create({
        'name': name, 'login': login, 'password': 'chart_test_only_2026', 'lang': 'ar_001',
        'company_id': company.id, 'company_ids': [Command.set([company.id])],
        'group_ids': [Command.set([env.ref('base.group_user').id])],
    })
    env['nasq.access.assignment']._nasq_access_create([{
        'user_id': user.id, 'role_id': env.ref(role).id, 'company_id': company.id,
    }])
    user.write({'nasq_access_managed': True})
    user._nasq_sync_capability_groups()
    users.append(user)

names = [
    'تطوير البوابة الرقمية', 'تجهيز مركز التأهيل', 'برنامج تدريب الكوادر',
    'أتمتة خدمات المستفيدين', 'توسعة العيادات التخصصية', 'حوكمة البيانات',
    'تحديث البنية التقنية', 'قياس تجربة المستفيد', 'برنامج الشراكات',
    'تطوير الخدمات المساندة', 'اعتماد الجودة المؤسسية', 'مبادرة الاستدامة',
]
projects = []
now = fields.Datetime.now()
for index, name in enumerate(names):
    owner = users[0] if index < 10 else users[1]
    project = env['project.project']._nasq_create_from_policy(name, user_id=owner.id, date_end='2026-12-31')
    if index != 11:
        project._nasq_set_status(['on_track', 'at_risk', 'off_track', 'on_hold', 'done'][index % 5])
    if index not in (4, 11):
        budget = 40000 + index * 10000
        env['nasq.project.finance.entry'].create({
            'project_id': project.id, 'kind': 'budget', 'title': 'الميزانية المعتمدة', 'amount': budget,
        })
        env['nasq.project.finance.entry'].create({
            'project_id': project.id, 'kind': 'expense', 'title': 'مصروفات التنفيذ',
            'amount': int(budget * [0.35, 0.65, 1.15, 0.82][index % 4]), 'expense_date': '2026-09-07',
        })
    if index != 11:
        for number in range(10):
            env['project.task'].create({
                'project_id': project.id, 'name': f'مهمة التنفيذ {number + 1}',
                'user_ids': [Command.set([owner.id])],
                'state': '1_done' if number < index else '01_in_progress',
                'date_deadline': now + timedelta(days=-2 if number % 3 == 0 else 20),
            })
    projects.append(project)
env.flush_all()
for index, project in enumerate(projects):
    env.cr.execute('UPDATE project_project SET write_date = %s WHERE id = %s', [now - timedelta(hours=12 - index), project.id])
env.invalidate_all()
env.cr.commit()
