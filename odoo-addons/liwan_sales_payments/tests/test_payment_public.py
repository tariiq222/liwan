# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the customer's page and the send e-mail say about paying, and what the pay routes still refuse."""
from odoo import Command
from odoo.tests import tagged

from .common import PUBLIC, TOTAL, SalesPaymentsCase

PAYMENT_KEYS = {'percent', 'amount', 'currency', 'pay_url', 'state'}


@tagged('post_install', '-at_install', 'liwan')
class TestPublicPayment(SalesPaymentsCase):

    def payment(self, order):
        response = self.public(order)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['payment']

    def pay_state(self, order):
        return self.anon('GET', f'/api/v1/public/payments/orders/{order.id}?access_token={order.access_token}')

    def test_a_quotation_that_asks_to_be_paid_carries_the_pay_link_and_the_amount(self):
        order = self.payable('percent', 30)
        payment = self.payment(order)
        self.assertEqual(set(payment), PAYMENT_KEYS)
        self.assertEqual(
            payment,
            {
                'percent': 30, 'amount': TOTAL * 0.3, 'currency': 'SAR', 'state': 'payable',
                'pay_url': f'/pay/order/{order.id}?access_token={order.access_token}',
            },
        )
        # The link opens the existing pay page, which authorizes by the same token and shows the amount.
        document = self.pay_state(order)
        self.assertEqual((document.status_code, document.json()['status'], document.json()['amount_due']), (200, 'payable', TOTAL * 0.3), document.text)
        wrong = self.anon('GET', f'/api/v1/public/payments/orders/{order.id}?access_token=wrong')
        self.assertEqual(wrong.status_code, 404)

    def test_a_quotation_that_asks_for_nothing_has_no_payment(self):
        self.assertIsNone(self.payment(self.payable('off')))

    def test_a_tenant_without_online_payments_shows_no_pay_action(self):
        order = self.payable('full')
        self.payments(False)
        self.assertIsNone(self.payment(order))

    def test_an_expired_or_cancelled_quotation_cannot_be_paid(self):
        expired = self.payable('full')
        self.lapse(expired)
        payment = self.payment(expired)
        self.assertEqual((payment['state'], payment['pay_url']), ('unavailable', None))
        self.assertEqual(self.pay_state(expired).json()['status'], 'not_payable')
        declined = self.payable('full')
        self.assertEqual(self.anon('POST', f'{PUBLIC}/{declined.id}/decline', {'access_token': declined.access_token}).status_code, 200)
        self.assertEqual((self.payment(declined)['state'], self.payment(declined)['pay_url']), ('unavailable', None))

    def test_an_accepted_quotation_can_still_be_paid_and_a_reopened_one_cannot(self):
        order = self.payable('full')
        self.assertEqual(self.accept(order).status_code, 200)
        self.assertEqual(self.payment(order)['state'], 'payable')
        self.act(self.agent, order.id, 'reopen')
        # The old token no longer opens the pay routes: the same 404 as the customer's page of Sales.
        self.assertEqual(self.pay_state(order).status_code, 404)
        self.assertEqual(self.public(order).status_code, 404)

    def test_a_quotation_without_an_answer_mode_can_be_paid_without_one(self):
        order = self.payable('full', answer='none')
        body = self.public(order).json()
        self.assertEqual((body['can_accept'], body['payment']['state']), (False, 'payable'))

    def test_a_signature_comes_before_payment(self):
        order = self.payable('full', answer='accept_and_sign')
        payment = self.payment(order)
        self.assertEqual((payment['state'], payment['pay_url']), ('awaiting_signature', None))
        # The pay routes refuse it too, so the link of a mail cannot skip the signature.
        self.assertEqual(self.pay_state(order).json()['status'], 'not_payable')
        self.assertEqual(self.accept(order, self.sign_body()).status_code, 200)
        self.assertEqual(self.payment(order)['state'], 'payable')
        self.assertEqual(self.pay_state(order).json()['status'], 'payable')

    def test_a_signature_rings_the_salesperson_once_with_the_payments_bridge(self):
        order = self.payable('full', answer='accept_and_sign')
        self.assertEqual(self.accept(order, self.sign_body()).status_code, 200)
        rows = self.env['mail.message'].search([
            ('liwan_notification_kind', '=', 'sales.answered'), ('model', '=', 'sale.order'), ('res_id', '=', order.id),
        ])
        self.assertEqual(rows.mapped('liwan_sales_answer'), ['signed'])

    def test_a_paid_quotation_says_so(self):
        order = self.payable('full')
        self.pay(order, TOTAL)
        payment = self.payment(order)
        self.assertEqual((payment['state'], payment['amount'], payment['pay_url']), ('paid', 0.0, None))

    def test_the_mail_tells_the_customer_to_pay_and_where(self):
        order = self.payable('full')
        mail = self.env['mail.mail'].search([('email_to', '=', order.partner_id.email)], order='id desc', limit=1)
        self.assertIn(f'/pay/order/{order.id}?access_token={order.access_token}', mail.body_html)
        self.assertIn('Pay with this link', mail.body_html)
        self.assertIn('ادفع من هذا الرابط', mail.body_html)
        self.assertIn('90.00 SAR', mail.body_html)

    def test_the_mail_of_a_quotation_to_sign_first_has_no_pay_link(self):
        order = self.payable('full', answer='accept_and_sign')
        mail = self.env['mail.mail'].search([('email_to', '=', order.partner_id.email)], order='id desc', limit=1)
        self.assertNotIn('/pay/order/', mail.body_html)
        self.assertIn('Sign it first', mail.body_html)

    def test_the_mail_of_a_quotation_that_asks_for_nothing_says_nothing_of_payment(self):
        order = self.payable('off')
        mail = self.env['mail.mail'].search([('email_to', '=', order.partner_id.email)], order='id desc', limit=1)
        self.assertNotIn('confirmed by payment', mail.body_html)

    def test_the_pay_routes_follow_the_customer_page_of_sales(self):
        draft = self.quotation(pricelist_id=self.sar_pricelist.id, require_payment=True, prepayment_percent=1.0)
        draft._portal_ensure_token()
        self.assertEqual(self.pay_state(draft).status_code, 404)
        paid = self.payable('full')
        self.pay(paid, TOTAL)
        receipt = self.pay_state(paid)
        self.assertEqual((receipt.status_code, receipt.json()['status']), (200, 'paid'), receipt.text)
        cancelled = self.payable('full')
        self.act(self.agent, cancelled.id, 'cancel')
        self.assertEqual((self.pay_state(cancelled).status_code, self.pay_state(cancelled).json()['status']), (200, 'not_payable'))

    def test_without_a_live_gateway_there_is_no_pay_link(self):
        order = self.payable('full')
        self.paymob.sudo().state = 'disabled'
        payment = self.payment(order)
        self.assertEqual((payment['state'], payment['pay_url']), ('unavailable', None))
        staff = self.api_as(self.agent, 'GET', f'/api/v1/sales/orders/{order.id}').json()['payment']
        self.assertEqual(staff['link'], 'no_gateway')

    def test_a_payment_on_its_way_shows_processing_and_a_decline_reopens_the_payment(self):
        order = self.payable('full')
        tx = self.paymob_transaction(TOTAL, sale_order_ids=[Command.set(order.ids)])
        tx._set_pending()
        self.assertEqual(self.payment(order)['state'], 'processing')
        tx._process('paymob', self.paymob_notification(tx, round(TOTAL * 100), success=False))
        tx._post_process()
        self.assertEqual((order.state, self.payment(order)['state']), ('sent', 'payable'))
