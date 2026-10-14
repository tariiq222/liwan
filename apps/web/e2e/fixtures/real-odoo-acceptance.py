# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Create UI fixtures through Odoo shell on the isolated e2e database only."""
import json
import os
from pathlib import Path
from time import time_ns


def seed(environment, output):
    if environment.cr.dbname != 'nasq_scratch_e2e':
        message = 'real UI fixture refuses any non-scratch database'
        raise RuntimeError(message)
    if not output.is_absolute():
        message = 'fixture output must be an absolute path'
        raise RuntimeError(message)
    admin = environment['res.users'].search([('login', '=', 'e2e_admin')], limit=1)
    reader = environment['res.users'].search([('login', '=', 'e2e_employee')], limit=1)
    if not admin or not reader:
        message = 'run tools/e2e_seed.py before the UI fixture'
        raise RuntimeError(message)
    environment['res.lang']._activate_lang('ar_001')
    company = environment.company
    company.write({
        'name': 'Scratch UI Acceptance',
        'currency_id': environment.ref('base.SAR').id,
    })
    (admin | reader).write({'lang': 'ar_001', 'tz': 'Asia/Riyadh'})
    department = environment['hr.department'].search([('name', '=', 'قسم التحقق الحقيقي'), ('company_id', '=', company.id)], limit=1) or environment['hr.department'].create({
        'name': 'قسم التحقق الحقيقي', 'company_id': company.id,
    })
    employee = environment['hr.employee'].search([('work_email', '=', 'scratch-employee@example.test'), ('company_id', '=', company.id)], limit=1) or environment['hr.employee'].create({
        'name': 'موظف التحقق الحقيقي', 'work_email': 'scratch-employee@example.test',
        'department_id': department.id, 'company_id': company.id,
    })
    reader_employee = environment['hr.employee'].search([('user_id', '=', reader.id), ('company_id', '=', company.id)], limit=1) or environment['hr.employee'].create({
        'name': 'قارئ التحقق الحقيقي', 'user_id': reader.id,
        'work_email': 'e2e_employee@example.test', 'company_id': company.id,
    })
    admin_employee = environment['hr.employee'].search([('user_id', '=', admin.id), ('company_id', '=', company.id)], limit=1) or environment['hr.employee'].create({
        'name': 'مدير التحقق الحقيقي', 'user_id': admin.id,
        'work_email': 'e2e_admin@example.test', 'company_id': company.id,
    })
    grant_employee = environment['hr.employee'].create({
        'name': 'موظف منح حساب التحقق',
        'work_email': f'scratch-grant-{time_ns()}@example.test',
        'company_id': company.id,
    })
    output.write_text(json.dumps({
        'company': company.id, 'admin': admin.id, 'reader': reader.id,
        'department': department.id, 'employee': employee.id,
        'reader_employee': reader_employee.id, 'admin_employee': admin_employee.id,
        'grant_employee': grant_employee.id, 'grant_email': grant_employee.work_email,
    }))
    environment.cr.commit()


seed(env, Path(os.environ['E2E_REAL_FIXTURE_OUTPUT']))  # noqa: F821 (Odoo shell)
