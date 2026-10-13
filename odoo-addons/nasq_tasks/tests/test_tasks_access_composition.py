# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_tasks.models.access_service import (
    EMPLOYEE_PERMISSIONS,
    PERMISSIONS,
)


@tagged('nasq', 'nasq_access', 'nasq_tasks')
class TestTasksAccessComposition(TransactionCase):
    """nasq_tasks owns its capabilities, groups and role (spec R2) and runs at install."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['nasq.access.service']
        cls.Permission = cls.env['nasq.access.permission']

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_owns_its_capabilities_and_their_groups(self):
        catalog = self.service._nasq_capability_map()
        self.assertEqual(
            {key for key, item in catalog.items() if item['owner'] == 'nasq_tasks'},
            set(PERMISSIONS),
        )
        permissions = self.Permission.search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS))
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('nasq_tasks.group_cap_tasks_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_employee_role_holds_all_capabilities_and_no_task_role_exists(self):
        self.assertEqual(self._keys('nasq_core.role_employee') & set(PERMISSIONS), set(PERMISSIONS))
        for role in ('nasq_core.role_system_admin', 'nasq_core.role_vendor_support'):
            self.assertFalse(self._keys(role) & set(PERMISSIONS), role)
        self.assertFalse(self.env['nasq.access.role'].search([('key', '=', 'tasks_manager')]))

    def test_write_and_create_depend_on_read(self):
        for key in ('tasks.tasks.create', 'tasks.tasks.write'):
            permission = self.Permission.search([('key', '=', key)])
            self.assertEqual(permission.dependency_ids.mapped('key'), ['tasks.tasks.read'], key)

    def test_legacy_employee_group_grants_the_capabilities(self):
        employee = new_test_user(self.env, login='tasks_comp_employee', groups='nasq_core.group_employee')
        self.assertTrue(self.service._nasq_capability_keys(employee) >= EMPLOYEE_PERMISSIONS)
