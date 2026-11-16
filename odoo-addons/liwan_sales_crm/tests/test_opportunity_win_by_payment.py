# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A payment that confirms a quotation wins its opportunity too; runs only where the payments bridge is installed."""
from unittest import SkipTest
from unittest.mock import patch

from odoo.exceptions import ValidationError
from odoo.modules.registry import Registry
from odoo.tests import tagged
from odoo.tests.common import get_db_name

from .common import SalesCrmMixin
from odoo.addons.liwan_sales_payments.tests.common import TOTAL, SalesPaymentsCase


@tagged('post_install', '-at_install', 'liwan')
class TestOpportunityWinByPayment(SalesCrmMixin, SalesPaymentsCase):

    @classmethod
    def setUpClass(cls):
        registry = Registry(get_db_name())
        if 'payment_to_confirm' not in registry['liwan.sales.settings']._fields:
            reason = 'liwan_sales_payments is not installed in this database'  # skipped: the bridge needs both of its sides
            raise SkipTest(reason)
        super().setUpClass()
        cls.setup_crm()

    def test_a_payment_that_confirms_the_order_wins_the_opportunity(self):
        lead = self.lead(self.seller)
        order = self.payable('full', liwan_lead_id=lead.id)
        self.assertEqual(lead.won_status, 'pending')
        self.pay(order, TOTAL)
        lead.invalidate_recordset()
        self.assertEqual((order.state, lead.won_status, lead.liwan_final_price), ('sale', 'won', TOTAL))

    def test_a_payment_that_cannot_confirm_the_order_wins_nothing(self):
        lead = self.lead(self.seller)
        order = self.payable('full', liwan_lead_id=lead.id)
        self.lapse(order)
        self.pay(order, TOTAL)
        lead.invalidate_recordset()
        self.assertEqual((order.state, lead.won_status), ('sent', 'pending'))

    def test_a_refusal_of_the_opportunity_leaves_the_payment_confirming_the_order(self):
        lead = self.lead(self.seller)
        order = self.payable('full', liwan_lead_id=lead.id)
        with patch.object(type(self.env['crm.lead']), '_liwan_win_with_amount', side_effect=ValidationError('no won stage')):
            self.pay(order, TOTAL)
        lead.invalidate_recordset()
        self.assertEqual((order.state, lead.won_status), ('sale', 'pending'))
        self.assertTrue(order.message_ids.filtered(lambda message: 'no won stage' in (message.body or '')))

    def test_by_hand_a_payment_confirms_the_order_and_leaves_the_opportunity(self):
        self.env['liwan.sales.settings']._liwan_current().opportunity_win = 'manual'
        lead = self.lead(self.seller)
        order = self.payable('full', liwan_lead_id=lead.id)
        self.pay(order, TOTAL)
        lead.invalidate_recordset()
        self.assertEqual((order.state, lead.won_status), ('sale', 'pending'))
