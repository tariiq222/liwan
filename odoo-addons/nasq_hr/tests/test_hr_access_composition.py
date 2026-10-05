# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_hr.models.access_service import (
    EMPLOYEE_HR_PERMISSIONS,
    HR_PERMISSIONS,
)


@tagged('nasq', 'nasq_access')
class TestHrAccessComposition(TransactionCase):
    """nasq_hr owns its capabilities, groups and role (spec R2); it runs at install,
    so it also proves nasq_hr needs no other application."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['nasq.access.service']
        cls.Permission = cls.env['nasq.access.permission']

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_hr_owns_its_eight_capabilities_and_their_groups(self):
        catalog = self.service._nasq_capability_map()
        self.assertEqual(len(HR_PERMISSIONS), 8)
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'nasq_hr'}, set(HR_PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(HR_PERMISSIONS))])
        self.assertEqual(len(permissions), 8)
        xmlids = permissions.get_external_id()
        for permission in permissions:
            self.assertTrue(xmlids[permission.id].startswith('nasq_hr.permission_hr_'), permission.key)
            self.assertTrue(permission.group_xmlid.startswith('nasq_hr.group_cap_hr_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_hr_manager_role_is_unique_and_owned_by_nasq_hr(self):
        role = self.env.ref('nasq_hr.role_hr_manager')
        self.assertEqual((role.key, role.type, role.protected), ('hr_manager', 'built_in', True))
        self.assertEqual(self.env['nasq.access.role'].search_count([('key', '=', 'hr_manager')]), 1)
        self.assertFalse(self.env.ref('nasq_core.role_hr_manager', raise_if_not_found=False))
        self.assertFalse(self.env.ref('nasq_core.group_hr_manager', raise_if_not_found=False))
        self.assertEqual(self._keys('nasq_hr.role_hr_manager'), set(HR_PERMISSIONS))
        self.assertTrue(self._keys('nasq_core.role_employee') >= EMPLOYEE_HR_PERMISSIONS)
        self.assertTrue(self._keys('nasq_core.role_vendor_support') >= HR_PERMISSIONS)

    def test_hr_links_reach_core_groups_and_rules(self):
        vendor = self.env.ref('nasq_core.group_vendor_support')
        self.assertIn(self.env.ref('nasq_hr.group_hr_manager'), vendor.all_implied_ids)
        rule = self.env.ref('nasq_core.rule_access_users_company')
        self.assertIn(self.env.ref('nasq_hr.group_cap_hr_employees_archive'), rule.groups)
        self.assertIn(
            self.env.ref('hr.group_hr_user'),
            self.env.ref('nasq_hr.group_cap_hr_employees_manage').all_implied_ids,
        )

    def test_dependencies_actor_keys_and_legacy_roles_include_hr(self):
        manage = self.Permission.search([('key', '=', 'hr.employees.manage')])
        self.assertEqual(manage.dependency_ids.mapped('key'), ['hr.employees.read'])
        with self.assertRaisesRegex(ValidationError, 'missing_dependency'):
            self.env['nasq.access.role'].create({
                'name_ar': 'ناقص', 'type': 'custom',
                'permission_ids': [Command.set(manage.ids)],
            })
        self.assertIn('hr.employees.archive', self.service._nasq_customer_actor_keys())
        self.assertIn('hr_manager', self.service._nasq_legacy_admin_roles())

    def test_legacy_hr_groups_still_grant_hr_capabilities(self):
        nasq_group = new_test_user(self.env, login='hr_comp_nasq_group', groups='nasq_hr.group_hr_manager')
        odoo_group = new_test_user(self.env, login='hr_comp_odoo_group', groups='base.group_user,hr.group_hr_manager')
        employee = new_test_user(self.env, login='hr_comp_employee', groups='nasq_core.group_employee')
        self.assertTrue(self.service._nasq_capability_keys(nasq_group) >= HR_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(odoo_group) >= HR_PERMISSIONS)
        self.assertTrue(self.service._nasq_capability_keys(employee) >= EMPLOYEE_HR_PERMISSIONS)

    def test_repair_relinks_a_missing_hr_grant(self):
        role = self.env.ref('nasq_hr.role_hr_manager')
        archive = self.Permission.search([('key', '=', 'hr.employees.archive')])
        role.write({'permission_ids': [Command.unlink(archive.id)]})
        self.assertNotIn(archive, role.permission_ids)
        self.assertTrue(self.service._nasq_repair_builtin_role_grants())
        self.assertIn(archive, role.permission_ids)
