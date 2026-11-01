# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from odoo.tests import TransactionCase, new_test_user, tagged

SYSTEM = frozenset({
    'access.users.read', 'access.users.grant', 'access.users.assign_roles',
    'access.users.disable', 'access.users.reset_password', 'access.roles.read',
    'access.roles.manage', 'access.audit.read', 'settings.branding.manage',
    'settings.company.read', 'settings.company.manage',
})
HR = frozenset({
    'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive',
    'hr.employees.access_status.read', 'hr.departments.read',
    'hr.departments.manage',
    'hr.leave.read', 'hr.leave.request', 'hr.leave.approve', 'hr.leave.manage', 'hr.leave.config',
    'hr.recruitment.read', 'hr.recruitment.manage',
    'hr.shifts.read', 'hr.shifts.manage',
    'hr.onboarding.read', 'hr.onboarding.manage',
    'hr.offboarding.read', 'hr.offboarding.manage',
    'hr.assets.read', 'hr.assets.manage',
    'hr.warnings.read', 'hr.warnings.manage',
    'hr.insurance.read', 'hr.insurance.manage',
})
# Payroll is a section of liwan_hr behind its own keys: no HR role or group grants them.
PAYROLL = frozenset({
    'hr.payroll.read', 'hr.payroll.manage', 'hr.payroll.approve', 'hr.payroll.config',
    'hr.payroll.audit.read', 'hr.payroll.finance.manage',
})
PMO = frozenset({
    'pmo.projects.read', 'pmo.projects.create', 'pmo.projects.manage',
    'pmo.settings.manage', 'pmo.tasks.read', 'pmo.tasks.create',
    'pmo.tasks.write', 'pmo.tasks.approve',
})
MEETINGS = frozenset({'meetings.read', 'meetings.create', 'meetings.manage', 'meetings.settings.manage'})
EMPLOYEE = frozenset({
    'hr.employees.read', 'hr.departments.read',
    'hr.leave.read', 'hr.leave.request',
    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.tasks.write',
    'meetings.read',
})
CATALOG = SYSTEM | HR | PAYROLL | PMO | MEETINGS
# These tests pin today's applications. An application added later extends the
# composition with its own keys, roles and groups; those are checked only for
# what every application must satisfy (an installed owner, one domain per key).
RELEASE_OWNERS = frozenset({'liwan_core', 'liwan_hr', 'liwan_pmo', 'liwan_meetings'})
BUILT_IN_ROLES = frozenset({'employee', 'hr_manager', 'payroll_manager', 'pmo_manager', 'system_admin', 'vendor_support'})
DEPENDENCIES = {
    'access.users.read': {'access.roles.read'},
    'access.users.grant': {'access.users.read', 'access.roles.read'},
    'access.users.assign_roles': {'access.users.read', 'access.roles.read'},
    'access.users.disable': {'access.users.read'},
    'access.users.reset_password': {'access.users.read'},
    'access.roles.manage': {'access.roles.read'},
    'settings.company.manage': {'settings.company.read'},
    'hr.employees.manage': {'hr.employees.read'},
    'hr.employees.archive': {'hr.employees.read'},
    'hr.employees.access_status.read': {'hr.employees.read'},
    'hr.departments.manage': {'hr.departments.read'},
    'hr.leave.read': {'hr.employees.read'},
    'hr.leave.request': {'hr.leave.read'},
    'hr.leave.approve': {'hr.leave.read'},
    'hr.leave.manage': {'hr.leave.read'},
    'hr.recruitment.manage': {'hr.recruitment.read'},
    'hr.shifts.read': {'hr.employees.read'},
    'hr.shifts.manage': {'hr.shifts.read', 'hr.employees.manage'},
    'hr.onboarding.read': {'hr.employees.read'},
    'hr.onboarding.manage': {'hr.onboarding.read', 'hr.employees.manage'},
    'hr.offboarding.read': {'hr.employees.read'},
    'hr.offboarding.manage': {'hr.offboarding.read', 'hr.employees.manage'},
    'hr.assets.read': {'hr.employees.read'},
    'hr.assets.manage': {'hr.assets.read'},
    'hr.warnings.read': {'hr.employees.read'},
    'hr.warnings.manage': {'hr.warnings.read'},
    'hr.insurance.read': {'hr.employees.read'},
    'hr.insurance.manage': {'hr.insurance.read'},
    'hr.payroll.read': {'hr.employees.read'},
    'hr.payroll.manage': {'hr.payroll.read'},
    'hr.payroll.approve': {'hr.payroll.read'},
    'hr.payroll.config': {'hr.payroll.read'},
    'hr.payroll.audit.read': {'hr.payroll.read'},
    'hr.payroll.finance.manage': {'hr.payroll.read'},
    'pmo.projects.create': {'pmo.projects.read'},
    'pmo.projects.manage': {'pmo.projects.read'},
    'pmo.settings.manage': {'pmo.projects.read'},
    'pmo.tasks.create': {'pmo.tasks.read', 'pmo.projects.read'},
    'pmo.tasks.write': {'pmo.tasks.read'},
    'pmo.tasks.approve': {'pmo.tasks.read'},
    'meetings.create': {'meetings.read'},
    'meetings.manage': {'meetings.read'},
    'meetings.settings.manage': {'meetings.read'},
}


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestAccessComposition(TransactionCase):
    """With every application installed, the composed catalog, built-in roles and
    groups equal the pre-split liwan_core seed (spec 3.2, acceptance 3)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        installed = {
            module.name
            for module in cls.env['ir.module.module'].search([('name', 'in', ['liwan_hr', 'liwan_pmo', 'liwan_meetings']), ('state', '=', 'installed')])
        }
        if installed != {'liwan_hr', 'liwan_pmo', 'liwan_meetings'}:
            reason = 'needs liwan_hr, liwan_pmo and liwan_meetings installed'
            raise unittest.SkipTest(reason)
        cls.service = cls.env['liwan.access.service']
        cls.Permission = cls.env['liwan.access.permission']

    def _release(self, keys):
        """The keys of today's applications among `keys`."""
        catalog = self.service._liwan_capability_map()
        return {key for key in keys if catalog[key]['owner'] in RELEASE_OWNERS}

    def _role_keys(self, key):
        role = self.env['liwan.access.role'].search([('key', '=', key), ('type', '=', 'built_in')])
        self.assertEqual(len(role), 1, key)
        return self._release(role.permission_ids.mapped('key'))

    def _group(self, key):
        return self.env.ref(self.Permission.search([('key', '=', key)]).group_xmlid)

    def test_catalog_has_the_approved_54_keys_each_owned_by_one_addon(self):
        catalog = self.service._liwan_capability_map()
        self.assertEqual(self._release(catalog), CATALOG)
        self.assertEqual(len(self._release(catalog)), 54)
        permissions = self.Permission.search([])
        self.assertEqual(sorted(permissions.mapped('key')), sorted(catalog))
        installed = set(self.env['ir.module.module'].search([('state', '=', 'installed')]).mapped('name'))
        for key, definition in catalog.items():
            self.assertIn(definition['owner'], installed, key)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            owner = catalog[permission.key]['owner']
            self.assertEqual(xmlids[permission.id].split('.')[0], owner, permission.key)
            self.assertEqual(permission.group_xmlid.split('.')[0], owner, permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.group_xmlid)

    def test_builtin_roles_hold_the_approved_grants(self):
        self.assertEqual(self._role_keys('employee'), EMPLOYEE)
        self.assertEqual(self._role_keys('hr_manager'), HR)
        self.assertEqual(self._role_keys('pmo_manager'), PMO)
        self.assertEqual(self._role_keys('system_admin'), SYSTEM | MEETINGS)
        self.assertEqual(self._role_keys('vendor_support'), CATALOG - PAYROLL)
        self.assertEqual(self._role_keys('payroll_manager'), PAYROLL)
        self.assertLessEqual(
            BUILT_IN_ROLES,
            set(self.env['liwan.access.role'].search([('type', '=', 'built_in')]).mapped('key')),
        )
        grants = self.service._liwan_builtin_role_grants()
        self.assertLessEqual(BUILT_IN_ROLES, {self.env.ref(role_xmlid).key for role_xmlid in grants})

    def test_permission_dependencies_are_unchanged(self):
        actual = {
            permission.key: set(permission.dependency_ids.mapped('key'))
            for permission in self.Permission.search([]) if permission.dependency_ids
        }
        release = self._release(actual)
        self.assertEqual({key: actual[key] for key in release}, DEPENDENCIES)
        composed = self.service._liwan_permission_dependencies()
        self.assertEqual({key: composed[key] for key in self._release(composed)}, DEPENDENCIES)

    def test_groups_keep_their_odoo_and_capability_implications(self):
        employee = self.env.ref('liwan_core.group_employee')
        self.assertIn(self.env.ref('project.group_project_user'), employee.all_implied_ids)
        vendor = self.env.ref('liwan_core.group_vendor_support')
        self.assertIn(self.env.ref('base.group_system'), vendor.all_implied_ids)
        implied_keys = {
            permission.key for permission in self.Permission.search([])
            if self.env.ref(permission.group_xmlid) in vendor.all_implied_ids
        }
        self.assertEqual(self._release(implied_keys), CATALOG - PAYROLL - {'meetings.read', 'meetings.create'})
        access_admin = self.env.ref('liwan_core.group_access_admin')
        self.assertIn(self._group('meetings.manage'), access_admin.all_implied_ids)
        legacy_admin = self.env.ref('liwan_core.group_customer_admin')
        self.assertIn(self._group('access.users.assign_roles'), legacy_admin.all_implied_ids)
        for xmlid in (
            'liwan_core.group_employee', 'project.group_project_manager', 'hr.group_hr_manager',
            'base.group_erp_manager', 'base.group_system',
        ):
            self.assertNotIn(self.env.ref(xmlid), legacy_admin.all_implied_ids, xmlid)
        rule = self.env.ref('liwan_core.rule_access_users_company')
        self.assertEqual(rule.groups, self._group('access.users.read') | self._group('hr.employees.archive'))
        admin = self.env.ref('base.user_admin')
        self.assertTrue(admin.has_group('liwan_core.group_vendor_support'))
        self.assertTrue(admin.has_group('liwan_core.group_employee'))

    def test_system_admin_has_meetings_but_no_hr_or_pmo_management(self):
        admin = new_test_user(self.env, login='composition_system_admin', groups='base.group_user')
        self.service._liwan_replace_assignments(admin, [{
            'role_id': self.env.ref('liwan_core.role_system_admin').id,
            'company_id': self.env.company.id,
        }])
        self.assertEqual(self._release(self.service._liwan_capability_keys(admin)), SYSTEM | MEETINGS)
        self.assertIn(self._group('meetings.manage'), admin.all_group_ids)
        self.assertFalse(admin.has_group('hr.group_hr_manager'))
        self.assertFalse(admin.has_group('project.group_project_manager'))

    def test_legacy_groups_still_map_to_the_same_keys(self):
        cases = (
            ('base.group_user,liwan_core.group_access_admin', SYSTEM | MEETINGS),
            ('base.group_user,hr.group_hr_manager', HR - {'hr.leave.config'}),
            ('base.group_user,project.group_project_manager', PMO),
            ('liwan_core.group_employee', EMPLOYEE),
        )
        for index, (groups, expected) in enumerate(cases):
            user = new_test_user(self.env, login=f'composition_legacy_{index}', groups=groups)
            self.assertEqual(self._release(self.service._liwan_capability_keys(user)), expected, groups)

    def test_actor_keys_and_legacy_admin_roles_are_composed(self):
        self.assertEqual(self._release(self.service._liwan_customer_actor_keys()), {
            'access.users.grant', 'access.users.assign_roles', 'access.users.disable',
            'access.users.reset_password', 'hr.employees.archive',
        })
        self.assertLessEqual(
            {'system_admin', 'hr_manager', 'pmo_manager'}, set(self.service._liwan_legacy_admin_roles()),
        )

    def test_permission_domains_are_unchanged_on_the_wire(self):
        self.assertEqual(
            {permission.key: permission.domain for permission in self.Permission.search([])},
            {key: key.split('.')[0] for key in self.service._liwan_capability_map()},
        )
        self.assertLessEqual(CATALOG, set(self.service._liwan_capability_map()))
