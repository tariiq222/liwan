# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from .tenant_export_columns import ADDED
from odoo.addons.liwan_api.tests.tenant_export_support import assert_columns_pinned


@tagged('post_install', '-at_install', 'liwan')
class TestInboxPaymentsTenantExport(TransactionCase):

    def test_the_columns_this_addon_adds_to_the_export_are_pinned(self):
        assert_columns_pinned(self, ADDED, added=True)
