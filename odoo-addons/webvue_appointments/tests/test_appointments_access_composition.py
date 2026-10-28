# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_appointments.models.access_service import (
    EMPLOYEE_PERMISSIONS,
    PERMISSIONS,
)


@tagged('webvue', 'webvue_access')
class TestAppointmentsAccessComposition(TransactionCase):
    """webvue_appointments owns its capabilities, groups and role (spec R2) and runs at install."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['webvue.access.service']
        cls.Permission = cls.env['webvue.access.permission']

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_owns_its_capabilities_and_their_groups(self):
        catalog = self.service._webvue_capability_map()
        self.assertEqual(
            {key for key, item in catalog.items() if item['owner'] == 'webvue_appointments'},
            set(PERMISSIONS),
        )
        permissions = self.Permission.search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS))
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('webvue_appointments.group_cap_appointments_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_manager_role_is_unique_and_owned_by_the_addon(self):
        role = self.env.ref('webvue_appointments.role_appointments_manager')
        self.assertEqual((role.key, role.type, role.protected), ('appointments_manager', 'built_in', True))
        self.assertEqual(self.env['webvue.access.role'].search_count([('key', '=', 'appointments_manager')]), 1)
        self.assertEqual(self._keys('webvue_appointments.role_appointments_manager'), set(PERMISSIONS))
        self.assertTrue(self._keys('webvue_core.role_employee') >= EMPLOYEE_PERMISSIONS)
        self.assertTrue(self._keys('webvue_core.role_vendor_support') >= PERMISSIONS)

    def test_manage_depends_on_book_and_book_on_view(self):
        manage = self.Permission.search([('key', '=', 'appointments.manage')])
        book = self.Permission.search([('key', '=', 'appointments.book')])
        self.assertEqual(manage.dependency_ids.mapped('key'), ['appointments.book'])
        self.assertEqual(book.dependency_ids.mapped('key'), ['appointments.view'])

    def test_the_employee_role_only_views(self):
        self.assertEqual(self._keys('webvue_core.role_employee') & set(PERMISSIONS), {'appointments.view'})

    def test_system_admin_does_not_imply_appointments_manage(self):
        manager_group = self.env.ref('resource_booking.group_manager')
        self.assertNotIn(self.env.ref('base.user_admin'), manager_group.user_ids)
        self.assertIn(self.env.ref('base.user_root'), manager_group.with_context(active_test=False).user_ids)

    def test_legacy_groups_still_grant_capabilities(self):
        manager = new_test_user(self.env, login='appointments_comp_manager', groups='webvue_appointments.group_appointments_manager')
        employee = new_test_user(self.env, login='appointments_comp_employee', groups='webvue_core.group_employee')
        self.assertTrue(self.service._webvue_capability_keys(manager) >= PERMISSIONS)
        self.assertTrue(self.service._webvue_capability_keys(employee) >= EMPLOYEE_PERMISSIONS)
