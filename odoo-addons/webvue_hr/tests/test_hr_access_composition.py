# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_hr.models.access_service import (
    EMPLOYEE_HR_PERMISSIONS,
    HR_PERMISSION_DEPENDENCIES,
    HR_PERMISSIONS,
)

# The five HR areas added over ready-made engines: capability -> (group xmlid suffix
# under ``webvue_hr.``, the stock group that group implies or None).
HR_AREA_GROUPS = {
    'hr.recruitment.read': ('group_cap_hr_recruitment_read', None),
    'hr.recruitment.manage': (
        'group_cap_hr_recruitment_manage', 'hr_recruitment.group_hr_recruitment_user',
    ),
    'hr.shifts.read': ('group_cap_hr_shifts_read', None),
    'hr.shifts.manage': ('group_cap_hr_shifts_manage', None),
    'hr.onboarding.read': ('group_cap_hr_onboarding_read', None),
    'hr.onboarding.manage': ('group_cap_hr_onboarding_manage', None),
    'hr.offboarding.read': ('group_cap_hr_offboarding_read', None),
    'hr.offboarding.manage': ('group_cap_hr_offboarding_manage', None),
    'hr.assets.read': ('group_cap_hr_assets_read', None),
    'hr.assets.manage': ('group_cap_hr_assets_manage', 'maintenance.group_equipment_manager'),
}
HR_AREA_PERMISSIONS = frozenset(HR_AREA_GROUPS)
HR_AREA_DEPENDENCIES = {
    'hr.recruitment.read': frozenset(),
    'hr.recruitment.manage': frozenset({'hr.recruitment.read'}),
    'hr.shifts.read': frozenset({'hr.employees.read'}),
    'hr.shifts.manage': frozenset({'hr.shifts.read', 'hr.employees.manage'}),
    'hr.onboarding.read': frozenset({'hr.employees.read'}),
    'hr.onboarding.manage': frozenset({'hr.onboarding.read', 'hr.employees.manage'}),
    'hr.offboarding.read': frozenset({'hr.employees.read'}),
    'hr.offboarding.manage': frozenset({'hr.offboarding.read', 'hr.employees.manage'}),
    'hr.assets.read': frozenset({'hr.employees.read'}),
    'hr.assets.manage': frozenset({'hr.assets.read'}),
}
# The three area capabilities whose engine writes hr.version or the employee record (a shift
# assignment, the plan launch follower write, the departure wizard). They require
# hr.employees.manage, whose group already implies hr.group_hr_user, so their own groups
# must imply nothing at all.
EMPLOYEES_MANAGE_AREAS = frozenset({'hr.shifts.manage', 'hr.onboarding.manage', 'hr.offboarding.manage'})
HR_AREA_FEATURES = (
    'hr.recruitment', 'hr.shifts', 'hr.onboarding', 'hr.offboarding', 'hr.assets',
)
# No capability group may open these, in this version or through a future engine link.
FORBIDDEN_IMPLICATIONS = (
    'hr.group_hr_user',
    'hr.group_hr_manager',
    'hr_holidays.group_hr_holidays_user',
)
EMPLOYEE_HR_KEYS = frozenset({
    'hr.employees.read', 'hr.departments.read', 'hr.leave.read', 'hr.leave.request',
})


@tagged('webvue', 'webvue_access')
class TestHrAccessComposition(TransactionCase):
    """webvue_hr owns its capabilities, groups and role (spec R2); it runs at install,
    so it also proves webvue_hr needs no other application."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']
        cls.Permission = cls.env['webvue.access.permission']

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def _group(self, key):
        return self.env.ref(f'webvue_hr.{HR_AREA_GROUPS[key][0]}')

    def test_hr_owns_its_twenty_capabilities_and_their_groups(self):
        catalog = self.service._webvue_capability_map()
        self.assertEqual(len(HR_PERMISSIONS), 20)
        self.assertLessEqual(HR_AREA_PERMISSIONS, HR_PERMISSIONS)
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'webvue_hr'}, set(HR_PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(HR_PERMISSIONS))])
        self.assertEqual(len(permissions), 20)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('webvue_hr.permission_hr_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('webvue_hr.group_cap_hr_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_hr_manager_role_is_unique_and_owned_by_webvue_hr(self):
        role = self.env.ref('webvue_hr.role_hr_manager')
        self.assertEqual((role.key, role.type, role.protected), ('hr_manager', 'built_in', True))
        self.assertEqual(self.env['webvue.access.role'].search_count([('key', '=', 'hr_manager')]), 1)
        self.assertFalse(self.env.ref('webvue_core.role_hr_manager', raise_if_not_found=False))
        self.assertFalse(self.env.ref('webvue_core.group_hr_manager', raise_if_not_found=False))
        self.assertEqual(self._keys('webvue_hr.role_hr_manager') & set(HR_PERMISSIONS), set(HR_PERMISSIONS))
        self.assertTrue(self._keys('webvue_core.role_employee') >= EMPLOYEE_HR_PERMISSIONS)
        self.assertTrue(self._keys('webvue_core.role_vendor_support') >= HR_PERMISSIONS)

    def test_hr_area_capabilities_reach_only_the_hr_manager_and_vendor_support(self):
        self.assertEqual(self._keys('webvue_hr.role_hr_manager') & HR_AREA_PERMISSIONS, HR_AREA_PERMISSIONS)
        self.assertEqual(self._keys('webvue_core.role_vendor_support') & HR_AREA_PERMISSIONS, HR_AREA_PERMISSIONS)
        self.assertFalse(self._keys('webvue_core.role_employee') & HR_AREA_PERMISSIONS)

    def test_employee_role_keeps_its_four_hr_capabilities(self):
        self.assertEqual(EMPLOYEE_HR_PERMISSIONS, EMPLOYEE_HR_KEYS)
        self.assertLessEqual(EMPLOYEE_HR_PERMISSIONS, HR_PERMISSIONS)
        self.assertFalse(EMPLOYEE_HR_PERMISSIONS & HR_AREA_PERMISSIONS)
        self.assertEqual(self._keys('webvue_core.role_employee') & set(HR_PERMISSIONS), set(EMPLOYEE_HR_PERMISSIONS))

    def test_hr_area_groups_imply_only_their_stated_engine_group(self):
        forbidden = [self.env.ref(xmlid) for xmlid in FORBIDDEN_IMPLICATIONS]
        for key, (_, stock_xmlid) in sorted(HR_AREA_GROUPS.items()):
            group = self._group(key)
            implied = group.all_implied_ids
            for blocked in forbidden:
                self.assertNotIn(blocked, implied, f'{key} implies {blocked.name}')
            self.assertFalse(implied.filtered(lambda item: 'payroll' in item.name.lower()), key)
            if stock_xmlid:
                self.assertEqual(group.implied_ids, self.env.ref(stock_xmlid), key)
            else:
                self.assertFalse(group.implied_ids, key)

    def test_hr_user_is_reached_only_through_employee_management(self):
        for key in sorted(EMPLOYEES_MANAGE_AREAS):
            self.assertIn('hr.employees.manage', HR_AREA_DEPENDENCIES[key], key)
        area_manager = new_test_user(
            self.env, login='hr_comp_area_manager',
            groups='webvue_hr.group_cap_hr_shifts_manage,webvue_hr.group_cap_hr_offboarding_manage',
        )
        self.assertFalse(area_manager.has_group('hr.group_hr_user'))
        employees_manager = new_test_user(
            self.env, login='hr_comp_employees_manager',
            groups='webvue_hr.group_cap_hr_employees_manage',
        )
        self.assertTrue(employees_manager.has_group('hr.group_hr_user'))

    def test_hr_area_capability_dependencies(self):
        for key, required in sorted(HR_AREA_DEPENDENCIES.items()):
            self.assertEqual(HR_PERMISSION_DEPENDENCIES[key], set(required), key)
            permission = self.Permission.search([('key', '=', key)])
            self.assertEqual(set(permission.dependency_ids.mapped('key')), set(required), key)
        self.assertEqual(set(HR_AREA_DEPENDENCIES), HR_AREA_PERMISSIONS)

    def test_hr_area_sub_features_are_registered_by_webvue_hr(self):
        features = self.env['webvue.feature.registry']._webvue_feature_map()
        self.assertEqual(features['hr.enabled']['owner'], 'webvue_hr')
        for key in HR_AREA_FEATURES:
            self.assertIn(key, features)
            self.assertEqual(features[key]['type'], 'boolean')
            self.assertEqual(features[key]['owner'], 'webvue_hr')
            self.assertEqual(features[key]['module'], 'webvue_hr')

    def test_hr_links_reach_core_groups_and_rules(self):
        vendor = self.env.ref('webvue_core.group_vendor_support')
        self.assertIn(self.env.ref('webvue_hr.group_hr_manager'), vendor.all_implied_ids)
        rule = self.env.ref('webvue_core.rule_access_users_company')
        self.assertIn(self.env.ref('webvue_hr.group_cap_hr_employees_archive'), rule.groups)
        self.assertIn(
            self.env.ref('hr.group_hr_user'),
            self.env.ref('webvue_hr.group_cap_hr_employees_manage').all_implied_ids,
        )
        self.assertNotIn(
            self.env.ref('hr.group_hr_manager'),
            self.env.ref('webvue_hr.group_cap_hr_employees_manage').all_implied_ids,
        )

    def test_dependencies_actor_keys_and_legacy_roles_include_hr(self):
        manage = self.Permission.search([('key', '=', 'hr.employees.manage')])
        self.assertEqual(manage.dependency_ids.mapped('key'), ['hr.employees.read'])
        with self.assertRaisesRegex(ValidationError, 'missing_dependency'):
            self.env['webvue.access.role'].create({
                'name_ar': 'ناقص', 'type': 'custom',
                'permission_ids': [Command.set(manage.ids)],
            })
        self.assertIn('hr.employees.archive', self.service._webvue_customer_actor_keys())
        self.assertIn('hr_manager', self.service._webvue_legacy_admin_roles())

    def test_legacy_hr_groups_still_grant_hr_capabilities(self):
        webvue_group = new_test_user(self.env, login='hr_comp_webvue_group', groups='webvue_hr.group_hr_manager')
        odoo_group = new_test_user(self.env, login='hr_comp_odoo_group', groups='base.group_user,hr.group_hr_manager')
        employee = new_test_user(self.env, login='hr_comp_employee', groups='webvue_core.group_employee')
        self.assertTrue(self.service._webvue_capability_keys(webvue_group) >= HR_PERMISSIONS)
        self.assertTrue(self.service._webvue_capability_keys(odoo_group) >= HR_PERMISSIONS)
        self.assertTrue(self.service._webvue_capability_keys(employee) >= EMPLOYEE_HR_PERMISSIONS)

    def test_repair_relinks_a_missing_hr_grant(self):
        role = self.env.ref('webvue_hr.role_hr_manager')
        archive = self.Permission.search([('key', '=', 'hr.employees.archive')])
        role.write({'permission_ids': [Command.unlink(archive.id)]})
        self.assertNotIn(archive, role.permission_ids)
        self.assertTrue(self.service._webvue_repair_builtin_role_grants())
        self.assertIn(archive, role.permission_ids)
