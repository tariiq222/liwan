# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seed the e2e scratch database through Odoo (never through the Nuxt UI).

Run by tools/e2e_isolated.mjs after the first install of ``webvue_scratch_e2e``:

    odoo-bin shell -c <scratch conf> -d webvue_scratch_e2e --no-http < tools/e2e_seed.py

Idempotent: it opens the legacy full-product policy once, creates or resets the
two technical test accounts, and builds the demo company used by the persona
journeys: departments, two branches, custom roles, persona users with WebVue
roles, and one linked employee per persona with its manager chain. Business records (projects, leave, invoices,
requests) are left to the tests, which create them through the UI.

Every password below is a test-only credential for the disposable scratch
database; the defaults are mirrored in e2e.config.ts and can be overridden with E2E_USER_<KEY>_PASSWORD.
"""
import os

DB_GUARD = 'webvue_scratch_e2e'
COMPANY_NAME = 'شركة نخبة الأعمال للتقنية'
EMAIL_DOMAIN = 'nukhba.example.test'
ACCOUNTS = (
    # login, display name, groups, password env var, default password
    ('e2e_admin', 'E2E Admin', ('base.group_user', 'base.group_system', 'webvue_core.group_employee', 'webvue_pmo.group_pmo_manager',
      'webvue_hr.group_hr_manager', 'webvue_core.group_access_admin'),
     'E2E_USER_ADMIN_PASSWORD', 'webvue-e2e-admin-2026'),
    ('e2e_employee', 'E2E Employee', ('base.group_user', 'webvue_core.group_employee'),
     'E2E_USER_EMPLOYEE_PASSWORD', 'webvue-e2e-employee-2026'),
)
# department -> persona key of its head
DEPARTMENT_HEADS = {
    'الإدارة العامة': 'ceo', 'الموارد البشرية': 'hr_manager', 'المالية': 'cfo',
    'تقنية المعلومات': 'it_admin', 'المشاريع': 'pm', 'العمليات': 'ops_manager', 'المبيعات': 'crm_manager',
}
PERSONAS = (
    # key, display name, job title, department, manager key, role keys
    ('ceo', 'خالد العتيبي', 'المدير العام', 'الإدارة العامة', None, ('employee', 'pmo_manager', 'operations_reviewer')),
    ('it_admin', 'فهد الشمري', 'مسؤول النظام', 'تقنية المعلومات', 'ceo', ('employee', 'system_admin')),
    ('hr_manager', 'نورة القحطاني', 'مديرة الموارد البشرية', 'الموارد البشرية', 'ceo',
     ('employee', 'hr_manager', 'documents_manager', 'operations_reviewer')),
    ('payroll', 'ريم الدوسري', 'أخصائية الرواتب', 'الموارد البشرية', 'hr_manager', ('employee', 'payroll_manager')),
    ('cfo', 'عبدالله الحربي', 'المدير المالي', 'المالية', 'ceo', ('employee', 'finance_manager')),
    ('accountant', 'سلمان الزهراني', 'محاسب', 'المالية', 'cfo', ('employee', 'finance_accountant')),
    ('auditor', 'هند المطيري', 'مدققة مالية', 'المالية', 'cfo', ('employee', 'finance_auditor')),
    ('pm', 'ماجد الغامدي', 'مدير مشاريع', 'المشاريع', 'ceo', ('employee', 'operations_reviewer')),
    ('ops_manager', 'لمى السبيعي', 'مديرة العمليات', 'العمليات', 'ceo', ('employee', 'operations_manager')),
    ('staff1', 'يوسف المالكي', 'مطور برمجيات', 'تقنية المعلومات', 'pm', ('employee',)),
    ('staff2', 'سارة العمري', 'منسقة عمليات', 'العمليات', 'ops_manager', ('employee',)),
    ('crm_manager', 'أحمد السهلي', 'مدير المبيعات', 'المبيعات', 'ceo', ('employee', 'crm_manager')),
    ('crm_agent', 'مها الثبيتي', 'موظفة مبيعات', 'المبيعات', 'crm_manager', ('employee', 'crm_agent')),
    ('crm_agent2', 'نايف العسيري', 'موظف مبيعات', 'المبيعات', 'crm_manager', ('employee', 'crm_agent')),
)
# Personas whose only purpose is a custom role or a role combination no business persona holds.
ROLE_PERSONAS = (
    ('users_reader', 'رامي القرني', 'منسق الحسابات', 'تقنية المعلومات', 'it_admin', ('employee', 'e2e_users_reader')),
    ('ops_monitor', 'دانة الزهراني', 'مراقبة الطلبات', 'العمليات', 'ops_manager', ('employee', 'e2e_ops_monitor')),
    ('docs_editor', 'تركي البقمي', 'محرر مستندات', 'الموارد البشرية', 'hr_manager', ('employee', 'e2e_docs_editor')),
    ('fin_reader', 'أمل الجهني', 'متابعة المدفوعات', 'المالية', 'cfo', ('employee', 'e2e_payments_reader')),
    ('no_ai', 'بدر الرشيدي', 'موظف', 'العمليات', 'ops_manager', ('e2e_employee_no_ai',)),
    ('payroll_finance', 'جواهر العنزي', 'محاسبة رواتب', 'المالية', 'cfo', ('employee', 'payroll_manager', 'finance_manager')),
    ('no_roles', 'سعد الحربي', 'متدرب', 'تقنية المعلومات', 'it_admin', ()),
)
# Custom roles of the root company: key -> (Arabic name, capability keys; dependencies are added).
# `e2e_employee_no_ai` copies the built-in employee role without `ai.use`.
CUSTOM_ROLES = {
    'e2e_users_reader': ('قراءة المستخدمين فقط', ('access.users.read',)),
    'e2e_ops_monitor': ('متابعة العمليات فقط', ('operations.monitoring.read',)),
    'e2e_docs_editor': ('تحرير المستندات بلا إدارة الوصول', ('documents.items.manage',)),
    'e2e_payments_reader': ('قراءة المدفوعات فقط', ('finance.payments.read',)),
    'e2e_employee_no_ai': ('موظف بلا مساعد ذكي', None),
}
# Branches (child companies of the root) and the people who work only there.
BRANCHES = ('فرع جدة', 'فرع الدمام')
BRANCH_PERSONAS = (
    # key, display name, job title, branch, role keys
    ('jeddah_staff', 'وليد الحارثي', 'موظف مبيعات', 'فرع جدة', ('employee',)),
    ('dammam_manager', 'منيرة الشهري', 'مديرة فرع الدمام', 'فرع الدمام',
     ('employee', 'hr_manager', 'documents_manager', 'operations_manager', 'finance_manager')),
)

if env.cr.dbname != DB_GUARD:  # noqa: F821
    raise SystemExit(f'e2e_seed refuses database {env.cr.dbname!r}; only {DB_GUARD} is allowed')  # noqa: F821

# Every application of the release is installed; open the full legacy policy
# (pmo.enabled and the rest) once. A configured tenant is never rewritten.
registry = env['webvue.feature.registry']  # noqa: F821
env['webvue.tenant.profile']._webvue_initialize_legacy_policy(registry._webvue_installed_module_ids())  # noqa: F821

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

company = env['webvue.tenant.profile'].search([], limit=1).root_company_id  # noqa: F821
company.write({'name': COMPANY_NAME})
Role = env['webvue.access.role']  # noqa: F821
Permission = env['webvue.access.permission']  # noqa: F821


def with_dependencies(permissions):
    closure = permissions
    while missing := closure.dependency_ids - closure:
        closure |= missing
    return closure


for key, (name_ar, capability_keys) in CUSTOM_ROLES.items():
    if capability_keys is None:
        permissions = Role.search([('key', '=', 'employee')]).permission_ids.filtered(lambda p: p.key != 'ai.use')
    else:
        permissions = with_dependencies(Permission.search([('key', 'in', capability_keys)]))
    values = {'name_ar': name_ar, 'permission_ids': [(6, 0, permissions.ids)]}
    role = Role.with_context(active_test=False).search([('key', '=', key)], limit=1)
    if role:
        role.write(values)
    else:
        Role.create({**values, 'key': key, 'type': 'custom', 'company_id': company.id})

branches = {}
for name in BRANCHES:
    branch = env['res.company'].search([('name', '=', name), ('parent_id', '=', company.id)], limit=1)  # noqa: F821
    branches[name] = branch or env['res.company'].create({'name': name, 'parent_id': company.id})  # noqa: F821

departments = {}
for name in DEPARTMENT_HEADS:
    department = env['hr.department'].search([('name', '=', name), ('company_id', '=', company.id)], limit=1)  # noqa: F821
    departments[name] = department or env['hr.department'].create({'name': name, 'company_id': company.id})  # noqa: F821

roles = {role.key: role for role in Role.search([('company_id', 'in', (False, company.id))])}
employees = {}


def ensure_persona(key, name, job_title, home, role_keys, department=False, manager=False):
    """The login e2e_<key> working in HOME only, holding ROLE_KEYS there, with one linked employee."""
    login = f'e2e_{key}'
    password = os.environ.get(f'E2E_USER_{key.upper()}_PASSWORD') or f'webvue-e2e-{key}-2026'
    values = {
        'name': name, 'email': f'{key}@{EMAIL_DOMAIN}', 'password': password,
        'company_id': home.id, 'company_ids': [(6, 0, home.ids)],
        'group_ids': [(6, 0, env.ref('base.group_user').ids)],  # noqa: F821
    }
    user = users.search([('login', '=', login)], limit=1)
    if user:
        user.write(values)
    else:
        user = users.create({**values, 'login': login})
    wanted = Role.browse([roles[role_key].id for role_key in role_keys])
    assignments = env['webvue.access.assignment'].search([('user_id', '=', user.id)])  # noqa: F821
    (assignments - assignments.filtered(lambda a: a.role_id in wanted and a.company_id == home)).unlink()
    for role in wanted - assignments.filtered(lambda a: a.company_id == home).role_id:
        env['webvue.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': home.id})  # noqa: F821
    user._webvue_sync_capability_groups()

    employee = env['hr.employee'].with_context(active_test=False).search([('user_id', '=', user.id)], limit=1)  # noqa: F821
    employee_values = {
        'name': name, 'job_title': job_title, 'work_email': f'{key}@{EMAIL_DOMAIN}',
        'department_id': department.id if department else False, 'company_id': home.id, 'active': True,
        'parent_id': manager.id if manager else False,
    }
    if employee:
        employee.write(employee_values)
    else:
        employee = env['hr.employee'].create({**employee_values, 'user_id': user.id})  # noqa: F821
    employees[key] = employee


for key, name, job_title, department_name, manager_key, role_keys in PERSONAS + ROLE_PERSONAS:
    ensure_persona(key, name, job_title, company, role_keys, departments[department_name], employees.get(manager_key, False))
for key, name, job_title, branch_name, role_keys in BRANCH_PERSONAS:
    ensure_persona(key, name, job_title, branches[branch_name], role_keys)

for department_name, head_key in DEPARTMENT_HEADS.items():
    departments[department_name].manager_id = employees[head_key]

# The self-service journeys sign in as `e2e_employee`, which needs an employee file of its own.
self_service_user = env['res.users'].search([('login', '=', 'e2e_employee')])  # noqa: F821
if not env['hr.employee'].with_context(active_test=False).search_count([('user_id', '=', self_service_user.id)]):  # noqa: F821
    env['hr.employee'].create({'name': self_service_user.name, 'user_id': self_service_user.id, 'company_id': company.id})  # noqa: F821

env.cr.commit()  # noqa: F821
print('e2e seed done:', [account[0] for account in ACCOUNTS], [f'e2e_{key}' for key in employees])  # noqa: T201
