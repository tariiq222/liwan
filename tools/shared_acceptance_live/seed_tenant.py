# Acceptance seed: one admin user + Nasq capability roles + one HR employee.
# Injected via NASQ_ACCEPT_SEED env var; passwords stay in env, never in argv.
import os

login = os.environ['NASQ_ACCEPT_ADMIN_LOGIN']
pw = os.environ['NASQ_ACCEPT_ADMIN_PASSWORD']
proj = os.environ['NASQ_ACCEPT_PROJECT_NAME']
emp = os.environ['NASQ_ACCEPT_EMPLOYEE']
company = env['res.company'].search([], limit=1)
assert company, 'no company found'

# Arabic is the product default. A fresh database ships res.lang rows but no active
# Arabic, and assigning an inactive lang to a user makes Odoo raise
# "Invalid language code: ar_001" (e.g. project's personal-stage onboarding hook).
# Activate it first, exactly as the nasq test fixture does.
env['res.lang']._activate_lang('ar_001')
assert env['res.lang'].search([('code', '=', 'ar_001'), ('active', '=', True)], limit=1), \
    'ar_001 could not be activated'

# The seeded admin owns a system role plus the built-in roles that actually grant
# PMO and HR capability. base.group_system alone does NOT grant them: nasq_core
# authorizes through the capability service, roles and company-scoped assignments.
role_keys = ['system_admin', 'pmo_manager', 'hr_manager']
roles = []
for key in role_keys:
    role = env.ref('nasq_core.role_%s' % key, raise_if_not_found=False)
    assert role, 'missing built-in role: %s' % key
    assert role.assignable, 'role not assignable: %s' % key
    roles.append(role)
sys_group = env.ref('base.group_system')

user = env['res.users'].create({
    'login': login,
    'password': pw,
    'name': proj.replace('-ONLY', '') + ' Admin',
    'lang': 'ar_001',
    'company_id': company.id,
    'company_ids': [(6, 0, [company.id])],
    'group_ids': [(4, sys_group.id)],
})

for role in roles:
    env['nasq.access.assignment'].create({
        'user_id': user.id,
        'role_id': role.id,
        'company_id': company.id,
    })

project = env['project.project'].create({
    'name': proj,
    'company_id': company.id,
})

employee = env['hr.employee'].create({
    'name': emp,
    'company_id': company.id,
    'user_id': user.id,
})

# The tenant feature policy is NOT granted by installing the addons on a fresh
# database: nasq.tenant.profile is created with policy_revision=0 and no features,
# so /api/v1/projects answers feature_not_included ("pmo.enabled"). The product
# grants the initial policy through its own model, exactly as the shared HTTP test
# fixture (nasq_api/tests/common.py) and the 19.0.1.1.0 migration do:
#   profile._nasq_initialize_legacy_policy(
#       env['nasq.feature.registry']._nasq_installed_module_ids())
profile = env.ref('nasq_platform.tenant_profile', raise_if_not_found=False)
assert profile, 'nasq_platform.tenant_profile is missing; nasq_platform is not installed'
profile._nasq_initialize_legacy_policy(
    env['nasq.feature.registry']._nasq_installed_module_ids(),
)
assert profile.policy_revision >= 1, 'tenant policy was not initialized'
for feature in ('pmo.enabled', 'hr.enabled'):
    assert profile.features.get(feature) is True, 'missing tenant feature: %s' % feature

# Commit explicitly AFTER EACH STEP. The odoo shell rolls the transaction back on
# exit unless a commit has already been reached: a script that only relies on a
# single trailing commit prints its result and then persists nothing. Verified by
# bisection against the live acceptance database.
env.cr.commit()

identity = env['nasq.access.service']._nasq_identity(user)
caps = sorted(identity['capabilities'])
assert 'pmo.projects.read' in caps, 'admin lacks pmo.projects.read: %s' % caps
assert 'hr.employees.read' in caps, 'admin lacks hr.employees.read: %s' % caps
print('SEEDED user=%s project=%s employee=%s roles=%s caps=%d' % (
    login, project.name, employee.name, ','.join(role_keys), len(caps)))
env.cr.commit()
