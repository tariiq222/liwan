# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_inbox_payments.models.access_service import PERMISSIONS


@tagged('post_install', '-at_install', 'liwan')
class TestVendorSupportGrants(TransactionCase):
    """INB-18: vendor support does not hold the customers' orders and catalog either."""

    def test_the_role_and_the_effective_capabilities_exclude_orders_and_catalog(self):
        role = self.env.ref('liwan_core.role_vendor_support')
        self.assertFalse(set(role.permission_ids.mapped('key')) & PERMISSIONS)
        vendor = new_test_user(self.env, login='inbox_pay_vendor', groups='liwan_core.group_vendor_support')
        self.assertFalse(self.env['liwan.access.service']._liwan_capability_keys(vendor) & PERMISSIONS)
