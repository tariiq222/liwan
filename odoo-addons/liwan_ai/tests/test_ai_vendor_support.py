# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestAiVendorSupport(TransactionCase):

    def test_vendor_support_holds_no_ai_permission(self):
        service = self.env['liwan.access.service']
        owned = {key for key, item in service._liwan_capability_map().items() if item['owner'] == 'liwan_ai'}
        self.assertTrue(owned)
        support = new_test_user(self.env, login='ai_support_live', groups='liwan_core.group_vendor_support')
        self.assertFalse(service.with_user(support)._liwan_capability_keys(support) & owned)
