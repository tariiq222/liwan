# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_sales.models.access_service import (
    AGENT_PERMISSIONS,
    PERMISSION_DEPENDENCIES,
    PERMISSIONS,
)

SIX = {
    'sales.read',
    'sales.quotations.manage',
    'sales.orders.confirm',
    'sales.discounts.approve',
    'sales.documents.assign',
    'sales.settings.manage',
}


@tagged('liwan', 'liwan_access')
class TestSalesAccessComposition(TransactionCase):
    """liwan_sales owns its capabilities, groups and roles (spec R2) and runs at install."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.Permission = cls.env['liwan.access.permission']

    def _keys(self, role_xmlid):
        return set(self.env.ref(role_xmlid).permission_ids.mapped('key'))

    def test_owns_exactly_six_capabilities_and_their_groups(self):
        self.assertEqual(set(PERMISSIONS), SIX)
        catalog = self.service._liwan_capability_map()
        self.assertEqual({key for key, item in catalog.items() if item['owner'] == 'liwan_sales'}, SIX)
        permissions = self.Permission.search([('key', 'in', sorted(SIX))])
        self.assertEqual(len(permissions), len(SIX))
        for permission in permissions:
            self.assertTrue(permission.group_xmlid.startswith('liwan_sales.group_cap_sales_'), permission.key)
            self.assertTrue(self.env.ref(permission.group_xmlid, raise_if_not_found=False), permission.key)

    def test_the_two_roles_hold_exactly_their_capabilities(self):
        for xmlid, key, expected in (
            ('liwan_sales.role_sales_agent', 'sales_agent', {'sales.read', 'sales.quotations.manage', 'sales.orders.confirm'}),
            ('liwan_sales.role_sales_manager', 'sales_manager', SIX),
        ):
            role = self.env.ref(xmlid)
            self.assertEqual((role.key, role.type, role.protected), (key, 'built_in', True))
            self.assertEqual(self.env['liwan.access.role'].search_count([('key', '=', key)]), 1)
            self.assertEqual(self._keys(xmlid), expected)
        self.assertEqual(set(AGENT_PERMISSIONS), self._keys('liwan_sales.role_sales_agent'))

    def test_no_sales_capability_reaches_the_employee_or_support_role(self):
        self.assertFalse(self._keys('liwan_core.role_employee') & SIX)
        self.assertFalse(self._keys('liwan_core.role_vendor_support') & SIX)

    def test_four_capabilities_require_read_and_settings_require_nothing(self):
        for key in ('sales.quotations.manage', 'sales.orders.confirm', 'sales.discounts.approve', 'sales.documents.assign'):
            permission = self.Permission.search([('key', '=', key)])
            self.assertEqual(permission.dependency_ids.mapped('key'), ['sales.read'], key)
        for key in ('sales.read', 'sales.settings.manage'):
            self.assertFalse(self.Permission.search([('key', '=', key)]).dependency_ids, key)
        self.assertEqual(set(PERMISSION_DEPENDENCIES), SIX - {'sales.read', 'sales.settings.manage'})

    def test_only_two_capability_groups_imply_a_stock_group(self):
        implied = {}
        for key in SIX:
            group = self.env.ref(self.Permission.search([('key', '=', key)]).group_xmlid)
            implied[key] = set(group.implied_ids.get_external_id().values())
        self.assertEqual(implied['sales.read'], {'sales_team.group_sale_salesman'})
        self.assertEqual(implied['sales.documents.assign'], {'sales_team.group_sale_salesman_all_leads'})
        for key in SIX - {'sales.read', 'sales.documents.assign'}:
            self.assertFalse(implied[key], key)

    def test_vendor_support_holds_no_sales_capability(self):
        support = new_test_user(self.env, login='sales_support', groups='liwan_core.group_vendor_support')
        self.assertFalse(self.service._liwan_capability_keys(support) & SIX)
