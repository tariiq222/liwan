# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_payments.models.access_service import (
    ADMIN_PERMISSIONS,
    PERMISSIONS,
    REFUND,
)


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestPaymentsAccessComposition(TransactionCase):
    """liwan_payments owns its capability and group (spec R2), checked once every module is loaded."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.Permission = cls.env['liwan.access.permission']

    def test_owns_its_capability_and_its_group(self):
        catalog = self.service._liwan_capability_map()
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'liwan_payments'}, set(PERMISSIONS))
        permissions = self.Permission.search([('key', 'in', sorted(PERMISSIONS))])
        self.assertEqual(len(permissions), len(PERMISSIONS))
        self.assertEqual(self.service._liwan_permission_dependencies()[REFUND], {'payments.orders.read'})
        for permission in permissions:
            self.assertTrue(permission.sensitive, permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_system_admin_role_holds_it_and_employee_does_not(self):
        admin_keys = set(self.env.ref('liwan_core.role_system_admin').permission_ids.mapped('key'))
        self.assertTrue(admin_keys >= ADMIN_PERMISSIONS)
        # Refunds move the tenant's money: no built-in role holds them (owner decision 2026-10-29).
        self.assertNotIn(REFUND, admin_keys)
        employee_keys = set(self.env.ref('liwan_core.role_employee').permission_ids.mapped('key'))
        self.assertFalse(employee_keys & PERMISSIONS)

    def test_legacy_access_admin_group_still_grants_it(self):
        admin = new_test_user(self.env, login='payments_comp_admin', groups='liwan_core.group_access_admin')
        employee = new_test_user(self.env, login='payments_comp_employee', groups='liwan_core.group_employee')
        self.assertTrue(self.service._liwan_capability_keys(admin) >= ADMIN_PERMISSIONS)
        self.assertNotIn(REFUND, self.service._liwan_capability_keys(admin))
        self.assertFalse(self.service._liwan_capability_keys(employee) & PERMISSIONS)
