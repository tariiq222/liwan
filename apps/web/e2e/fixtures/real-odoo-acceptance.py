# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Create UI fixtures through Odoo shell on the isolated e2e database only."""
import json
import os
from pathlib import Path
from time import time_ns

# The accounts tools/e2e_seed.py creates that a real-Odoo spec signs in as, with the password the seed writes for
# each. Kept in one place so the fixture and the specs cannot disagree about how an account is reached.
SEEDED_ACCOUNTS = {
    'admin': ('e2e_admin', 'liwan-e2e-admin-2026'),
    'reader': ('e2e_employee', 'liwan-e2e-employee-2026'),
    'staff1': ('e2e_staff1', 'liwan-e2e-staff1-2026'),
    'staff2': ('e2e_staff2', 'liwan-e2e-staff2-2026'),
    'it_admin': ('e2e_it_admin', 'liwan-e2e-it_admin-2026'),
    'hr_manager': ('e2e_hr_manager', 'liwan-e2e-hr_manager-2026'),
    'no_roles': ('e2e_no_roles', 'liwan-e2e-no_roles-2026'),
}
# Accounts only the acceptance fixture needs, each one a combination no business persona holds.
EXTRA_ACCOUNTS = {
    # These journeys change the account or its grants, so each owns its own actor.
    'access_member': ('e2e_acceptance_access_member', 'عضو اختبار الوصول', 'liwan-e2e-access-member-2026', 'employee'),
    'access_reader': ('e2e_acceptance_access_reader', 'قارئ اختبار الوصول', 'liwan-e2e-access-reader-2026', 'employee'),
    'access_actor': ('e2e_acceptance_access_actor', 'مدير اختبار الوصول', 'liwan-e2e-access-actor-2026', 'system_admin'),
    # Reads projects and their finance ledger without the capability to change an entry.
    'finance_reader': ('e2e_acceptance_finance_reader', 'ليوان فينانس ريدر', 'liwan-e2e-finance-reader-2026', 'acceptance_finance_reader'),
    # Configures the leave policy and reads nothing else in HR except what the settings page needs.
    'leave_config': ('e2e_acceptance_leave_config', 'ليوان ليف كونفيغ', 'liwan-e2e-leave-config-2026', 'acceptance_leave_config'),
    # The employee the leave journeys request for, approve and cancel. It holds the plain employee role, so their
    # balance is never shared with a persona another journey mutates.
    'leave_staff': ('e2e_acceptance_leave_staff', 'سالم الموظف', 'liwan-e2e-leave-staff-2026', 'employee'),
    # Runs the project administration and finance journeys: the PMO role creates projects, manages their settings and
    # is a project manager, which is what project finance entry writes require.
    'pmo_manager': ('e2e_acceptance_pmo_manager', 'ليوان مدير المشاريع', 'liwan-e2e-pmo-manager-2026', 'pmo_manager'),
    # Records the compensation and confirms the end-of-service settlement that archiving a leaver requires while the
    # tenant enables hr.payroll. A dedicated account keeps that write out of every other journey's session.
    'payroll_officer': ('e2e_acceptance_payroll_officer', 'ليوان مسؤول الرواتب', 'liwan-e2e-payroll-officer-2026', 'payroll_offboarding_officer'),
}
# key -> (Arabic name, capability keys). Dependencies are added by the role service.
EXTRA_ROLES = {
    'acceptance_finance_reader': ('قراءة مال المشروع فقط', ('pmo.projects.read', 'pmo.tasks.read', 'pmo.finance.read')),
    'acceptance_leave_config': ('إعداد سياسة الإجازات فقط', ('hr.leave.config',)),
}
# The employee the leave journeys request for and grant to, so their balance is not shared with a persona another
# journey mutates. It starts with one approved annual allocation.
LEAVE_EMPLOYEE_EMAIL = 'acceptance-leave@example.test'


def with_dependencies(Permission, permissions):
    closure = permissions
    while missing := closure.dependency_ids - closure:
        closure |= missing
    return closure


def ensure_role(environment, company, Permission, key):
    """The role KEY: the built-in one when it exists, else the fixture's custom role with its documented grants."""
    Role = environment['liwan.access.role']
    role = Role.with_context(active_test=False).search([('key', '=', key)], limit=1)
    if key not in EXTRA_ROLES:
        if not role:
            message = f'run tools/e2e_seed.py before the UI fixture: role {key} is missing'
            raise RuntimeError(message)
        return role
    name_ar, capability_keys = EXTRA_ROLES[key]
    permissions = with_dependencies(Permission, Permission.search([('key', 'in', capability_keys)]))
    values = {'name_ar': name_ar, 'permission_ids': [(6, 0, permissions.ids)]}
    if role:
        role.write(values)
        return role
    return Role.create({**values, 'key': key, 'type': 'custom', 'company_id': company.id})


def ensure_account(environment, company, roles, key, mobile):
    login, name, password, role_key = EXTRA_ACCOUNTS[key]
    user = environment['res.users'].with_context(no_reset_password=True).search([('login', '=', login)], limit=1)
    values = {
        'name': name, 'email': f'{login}@example.test', 'password': password, 'company_id': company.id,
        'company_ids': [(6, 0, company.ids)], 'group_ids': [(6, 0, environment.ref('base.group_user').ids)],
        # The API refuses an account without a mobile number, and the number is unique per account.
        'liwan_mobile': mobile,
    }
    if user:
        user.write(values)
    else:
        user = environment['res.users'].create({**values, 'login': login})
    role = roles[role_key]
    assignment = environment['liwan.access.assignment'].search([('user_id', '=', user.id)])
    (assignment - assignment.filtered(lambda row: row.role_id in role and row.company_id == company)).unlink()
    if not assignment.filtered(lambda row: row.role_id == role and row.company_id == company):
        environment['liwan.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': company.id,
        })
    user._liwan_sync_capability_groups()
    return user


def seed(environment, output):
    if environment.cr.dbname != 'liwan_scratch_e2e':
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

    Permission = environment['liwan.access.permission']
    roles = {key: ensure_role(environment, company, Permission, key) for key in (set(EXTRA_ROLES) | {spec[3] for spec in EXTRA_ACCOUNTS.values()})}
    accounts, devices, access_employees = {}, {}, {}
    for key, (login, password) in SEEDED_ACCOUNTS.items():
        user = environment['res.users'].search([('login', '=', login)], limit=1)
        if not user:
            message = f'run tools/e2e_seed.py before the UI fixture: {login} is missing'
            raise RuntimeError(message)
        password_var = f'E2E_USER_{login.removeprefix("e2e_").upper()}_PASSWORD'
        accounts[key] = {'login': login, 'password': os.environ.get(password_var) or password}
        if key in ('it_admin', 'hr_manager'):
            access_employees[key] = environment['hr.employee'].search([('user_id', '=', user.id)], limit=1).id
        devices[key] = environment['liwan.login.device']._liwan_issue(user, 'acceptance')[1]
    for key in EXTRA_ACCOUNTS:
        user = ensure_account(environment, company, roles, key, f'+9665111{len(accounts):05d}')
        accounts[key] = {'login': EXTRA_ACCOUNTS[key][0], 'password': EXTRA_ACCOUNTS[key][2]}
        devices[key] = environment['liwan.login.device']._liwan_issue(user, 'acceptance')[1]

    member = environment['res.users'].search([('login', '=', accounts['access_member']['login'])], limit=1)
    member_employee = environment['hr.employee'].search([('user_id', '=', member.id)], limit=1)
    if not member_employee:
        member_employee = environment['hr.employee'].create({
            'name': member.name, 'user_id': member.id, 'work_email': member.email,
            'department_id': department.id, 'company_id': company.id,
        })
    access_employees['access_member'] = member_employee.id

    # The leave journeys request, approve and cancel against one employee of their own with a known annual balance,
    # so the balance never depends on what another journey left behind. The type they request is a dedicated one
    # whose policy is a single manager decision, which is the policy these journeys drive.
    leave_user = environment['res.users'].search([('login', '=', accounts['leave_staff']['login'])], limit=1)
    leave_employee = environment['hr.employee'].with_context(active_test=False).search(
        [('user_id', '=', leave_user.id), ('company_id', '=', company.id)], limit=1,
    ) or environment['hr.employee'].create({
        'name': 'سالم الموظف', 'work_email': LEAVE_EMPLOYEE_EMAIL, 'user_id': leave_user.id,
        'department_id': department.id, 'company_id': company.id,
    })
    leave_employee.write({'user_id': leave_user.id, 'name': 'سالم الموظف', 'active': True})
    annual = environment['hr.leave.type'].search([('name', '=', 'إجازة اعتماد الاختبار')], limit=1) \
        or environment['hr.leave.type'].create({
            'name': 'إجازة اعتماد الاختبار', 'company_id': company.id, 'requires_allocation': True,
            'leave_validation_type': 'manager', 'request_unit': 'day',
        })
    Allocation = environment['hr.leave.allocation']
    if not Allocation.search([('employee_id', '=', leave_employee.id), ('holiday_status_id', '=', annual.id)]):
        # A manager decision on the allocation is what an administrator performs when onboarding: create, then approve.
        allocation = Allocation.create({
            'name': 'رصيد اعتماد 2026', 'holiday_status_id': annual.id, 'employee_id': leave_employee.id,
            'number_of_days': 21, 'date_from': '2026-01-01',
        })
        allocation._action_validate()

    output.write_text(json.dumps({
        'company': company.id, 'admin': admin.id, 'reader': reader.id,
        'department': department.id, 'employee': employee.id,
        'reader_employee': reader_employee.id, 'admin_employee': admin_employee.id,
        'grant_employee': grant_employee.id, 'grant_email': grant_employee.work_email,
        'leave_employee': leave_employee.id, 'leave_type': annual.id if annual else None,
        'device': devices, 'accounts': accounts, 'access_employees': access_employees,
    }))
    environment.cr.commit()


seed(env, Path(os.environ['E2E_REAL_FIXTURE_OUTPUT']))  # noqa: F821 (Odoo shell)
