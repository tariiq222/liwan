# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_integrations_sa.models.access_service import PERMISSIONS


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestIntegrationsAccessComposition(TransactionCase):
    """liwan_integrations_sa owns its capabilities and groups (spec R2) and is checked once every module is loaded."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.Permission = cls.env['liwan.access.permission']

    def test_owns_its_capabilities_and_their_groups(self):
        catalog = self.service._liwan_capability_map()
        self.assertEqual(
            {key for key, item in catalog.items() if item['owner'] == 'liwan_integrations_sa'},
            set(PERMISSIONS),
        )
        permissions = self.Permission.search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS))
        for permission in permissions:
            self.assertTrue(
                permission.group_xmlid.startswith('liwan_integrations_sa.group_cap_integrations_'), permission.key,
            )
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_system_admin_role_holds_both_and_employee_none(self):
        admin_keys = set(self.env.ref('liwan_core.role_system_admin').permission_ids.mapped('key'))
        self.assertTrue(admin_keys >= PERMISSIONS)
        employee_keys = set(self.env.ref('liwan_core.role_employee').permission_ids.mapped('key'))
        self.assertFalse(employee_keys & PERMISSIONS)

    def test_manage_depends_on_read(self):
        manage = self.Permission.search([('key', '=', 'integrations.manage')])
        self.assertEqual(manage.dependency_ids.mapped('key'), ['integrations.read'])

    def test_legacy_access_admin_group_still_grants_capabilities(self):
        admin = new_test_user(self.env, login='integrations_comp_admin', groups='liwan_core.group_access_admin')
        employee = new_test_user(self.env, login='integrations_comp_employee', groups='liwan_core.group_employee')
        self.assertTrue(self.service._liwan_capability_keys(admin) >= PERMISSIONS)
        self.assertFalse(self.service._liwan_capability_keys(employee) & PERMISSIONS)
