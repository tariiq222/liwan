# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Sales staff who may also refund payments give back the money a staff quotation holds, from the quotation itself."""
from odoo import Command
from odoo.tests import tagged

from .payment_common import ORDERS, TOTAL, SalesPaymentsCase

REFUNDER_KEYS = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm', 'payments.orders.read', 'payments.refund']


@tagged('post_install', '-at_install', 'liwan')
class TestQuotationRefunds(SalesPaymentsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.give_custom_role(cls.agent, REFUNDER_KEYS)
        cls.give_custom_role(cls.agent2, REFUNDER_KEYS)

    def refund(self, order, amount, user=None, reference='RF-1'):
        return self.api_as(user or self.agent, 'POST', f'{ORDERS}/{order.id}/refunds', {'amount': amount, 'reference': reference})

    def held_money(self):
        """A quotation of 90 SAR paid in full, then cancelled: all of it is due back."""
        order = self.payable('full')
        self.act(self.agent, order.id, 'cancel')
        self.pay(order, TOTAL)
        return order

    def test_the_salesperson_refunds_what_a_cancelled_quotation_holds(self):
        order = self.held_money()
        before = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['payment']
        self.assertEqual((before['amount_refundable'], before['amount_to_refund'], before['can_refund']), (TOTAL, TOTAL, True))
        response = self.refund(order, TOTAL)
        self.assertEqual(response.status_code, 200, response.text)
        payment = response.json()['payment']
        self.assertEqual(
            (payment['amount_received'], payment['amount_refundable'], payment['amount_to_refund'], payment['can_refund'], payment['held']),
            (0.0, 0.0, 0.0, False, None),
        )

    def test_a_refund_beyond_what_is_held_is_refused(self):
        order = self.held_money()
        self.refused(self.refund(order, TOTAL + 1), 422, 'invalid', 'amount')
        self.refused(self.refund(order, 0), 422, 'invalid', 'amount')

    def test_money_held_on_an_expired_quotation_may_go_back_and_then_nothing_confirms_it(self):
        order = self.payable('full')
        self.lapse(order)
        self.pay(order, TOTAL)
        self.assertEqual(self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['payment']['amount_to_refund'], TOTAL)
        self.assertEqual(self.refund(order, TOTAL).status_code, 200)
        order.invalidate_recordset()
        self.assertFalse(order._liwan_reached())
        self.assertEqual(self.public(order).json()['payment']['state'], 'unavailable')

    def test_a_deposit_on_an_open_quotation_may_go_back_but_is_not_due(self):
        order = self.payable('percent', 50)
        self.pay(order, 20.0)
        payment = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['payment']
        self.assertEqual((payment['amount_refundable'], payment['amount_to_refund'], payment['amount_due']), (20.0, 0.0, 25.0))

    def test_a_salesperson_without_the_refund_capability_is_refused(self):
        order = self.held_money()
        self.give_custom_role(self.agent, ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm'])
        self.refused(self.refund(order, TOTAL), 403, 'forbidden')
        self.assertFalse(self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['payment']['can_refund'])

    def test_another_salesperson_does_not_reach_the_quotation(self):
        order = self.held_money()
        self.assertEqual(self.refund(order, TOTAL, user=self.agent2).status_code, 404)
        self.set_visibility('all')
        self.refused(self.refund(order, TOTAL, user=self.agent2), 403, 'forbidden')
        self.assertFalse(self.api_as(self.agent2, 'GET', f'{ORDERS}/{order.id}').json()['payment']['can_refund'])

    def test_an_online_order_is_refunded_by_payments_not_by_sales(self):
        online = self.online_order()
        self.pay(online, online.amount_total)
        # The agent's visibility does not reach an unassigned online order under `own`... (404)
        self.refused(self.refund(online, 1.0), 404, 'not_found')
        # ...and one that reads every order may still not change it in Sales (403).
        self.set_visibility('all')
        self.refused(self.refund(online, 1.0), 403, 'forbidden')
        self.assertEqual(online._liwan_net_received(), online.amount_total)

    def test_the_route_is_closed_without_online_payments(self):
        order = self.held_money()
        self.payments(False)
        self.refused(self.refund(order, TOTAL), 403, 'feature_not_included')

    def test_an_exact_replay_of_one_gateway_refund_is_a_conflict(self):
        order = self.held_money()
        self.assertEqual(self.refund(order, TOTAL).status_code, 200)
        self.refused(self.refund(order, TOTAL), 409, 'conflict')

    def test_a_partial_refund_then_the_rest(self):
        self.product.product_tmpl_id.liwan_refund_amounts = 'any'
        order = self.held_money()
        self.assertEqual(self.refund(order, 40.0, reference='RF-1').json()['payment']['amount_refundable'], 50.0)
        payment = self.refund(order, 50.0, reference='RF-2').json()['payment']
        self.assertEqual((payment['amount_refundable'], payment['amount_received']), (0.0, 0.0))

    def test_the_refund_capability_held_in_a_branch_only_is_refused(self):
        order = self.held_money()
        sales = ['sales.read', 'sales.quotations.manage', 'sales.orders.confirm']
        self.give_custom_role(self.agent, sales)
        branch_refunder = self.custom_user('branch_refunder', ['payments.orders.read', 'payments.refund'], company=self.branch)
        branch_role = self.env['liwan.access.assignment'].search([('user_id', '=', branch_refunder.id)]).role_id
        self.agent.company_ids = [Command.link(self.branch.id)]
        self.env['liwan.access.assignment'].create({'user_id': self.agent.id, 'role_id': branch_role.id, 'company_id': self.branch.id})
        self.refused(self.refund(order, TOTAL), 403, 'forbidden')

    def test_authorized_money_is_received_but_not_refundable(self):
        order = self.payable('percent', 50)
        self.paymob.sudo().support_manual_capture = 'full_only'
        tx = self.paymob_transaction(20.0, sale_order_ids=[Command.set(order.ids)])
        tx._set_authorized()
        payment = self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['payment']
        self.assertEqual((payment['amount_received'], payment['amount_refundable'], payment['can_refund']), (20.0, 0.0, False))
        self.refused(self.refund(order, 20.0), 422, 'invalid', 'amount')
