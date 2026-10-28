# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, fields
from odoo.tests import tagged

from .common import WebVueOrderCase
from .test_payer import CHECKOUT, OPTION_KEYS
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_payments.models.order_service import NoGateway, NotPayable

ORDER_KEYS = {'id', 'merchant', 'number', 'expires_at', 'currency', 'amount_total', 'amount_due', 'status', 'options'}


@tagged('post_install', '-at_install', 'webvue')
class TestOnlineOrders(WebVueOrderCase):
    """An online order is paid on the pay page under the invoice rules, confirmed by stock, or cancelled when it expires."""

    def stub_checkout(self):
        Transaction = type(self.env['payment.transaction'])
        original = Transaction._get_specific_rendering_values

        def rendering(tx, processing_values):
            if tx.provider_code != 'paymob':
                return original(tx, processing_values)
            return {'api_url': CHECKOUT, 'url_params': {'publicKey': 'pk_test', 'clientSecret': 'cs_test'}}
        self.patch(Transaction, '_get_specific_rendering_values', rendering)

    def start(self, order):
        return self.api('POST', self.order_url(order, '/transactions'), json={
            'access_token': order._portal_ensure_token(), 'provider_id': self.paymob.id, 'payment_method_id': self.card.id,
        })

    def summary(self, order, token=None):
        return self.api('GET', self.order_url(order, f'?access_token={token or order._portal_ensure_token()}'))

    def test_the_service_opens_an_order_that_only_a_payment_confirms(self):
        before = fields.Datetime.now()
        # The selling application's user holds no sales rights; the records it gets back are in its own environment.
        self.assertFalse(self.admin.has_group('sales_team.group_sale_salesman'))
        service = self.env['webvue.payments.service'].with_user(self.admin)
        order = service._webvue_new_order(self.env.company, self.customer)
        line = service._webvue_add_line(order, self.service)
        self.assertEqual((order.env.uid, order.env.su, line.env.uid, line.env.su), (self.admin.id, False, self.admin.id, False))
        order = self.env['sale.order'].browse(order.id)
        self.assertEqual(
            (order.state, order.require_payment, order.require_signature, order.prepayment_percent, order.currency_id.name),
            ('draft', True, False, 1.0, 'SAR'),
        )
        self.assertEqual((order.amount_total, order.access_url), (115.0, f'/pay/order/{order.id}'))
        self.assertGreaterEqual(order.webvue_payment_deadline, before + timedelta(minutes=60))
        self.assertTrue(self.env['ir.config_parameter'].sudo().get_param('sale.async_emails'))
        staff_order = self.env['sale.order'].create({'partner_id': self.customer.id})
        self.assertEqual(staff_order.access_url, f'/my/orders/{staff_order.id}')

    def test_the_payer_sees_and_starts_an_online_order_like_an_invoice(self):
        order = self.online_order()
        response = self.summary(order)
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), ORDER_KEYS)
        self.assertNotIn(self.customer.name, response.text)
        self.assertEqual(
            (body['status'], body['number'], body['amount_due'], body['currency']), ('payable', order.name, 115.0, 'SAR'),
        )
        self.assertEqual(body['expires_at'], order.webvue_payment_deadline.isoformat() + 'Z')
        self.assertEqual(set(body['options'][0]), OPTION_KEYS)
        self.stub_checkout()
        self.assertEqual(self.start(order).status_code, 200)
        tx = order.transaction_ids
        self.assertEqual((tx.amount, tx.sale_order_ids, tx.partner_id), (115.0, order, self.customer))
        again = self.start(order)
        self.assertEqual((again.status_code, again.json()['code']), (409, 'payment_in_progress'))

    def test_a_link_names_only_an_order_paid_online(self):
        staff_order = self.env['sale.order'].create({'partner_id': self.customer.id})
        order = self.online_order()
        for response in (self.summary(staff_order), self.summary(order, token='wrong-token')):
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))

    def test_a_paid_order_is_confirmed_and_invoiced_once(self):
        order = self.online_order()
        tx = self.pay(order, 115.0)
        self.assertEqual((tx.state, order.state), ('done', 'sale'))
        invoice = order.invoice_ids
        self.assertEqual((len(invoice), invoice.state), (1, 'posted'))
        self.assertIn(invoice.payment_state, ('in_payment', 'paid'))
        self.assertEqual(self.summary(order).json()['status'], 'paid')
        tx._process('paymob', self.paymob_notification(tx, 11500))
        tx._post_process()
        self.assertEqual(len(order.invoice_ids), 1)

    def test_a_deposit_order_asks_for_the_deposit_and_is_confirmed_by_it(self):
        order = self.online_order(prepayment_percent=0.3)
        self.assertEqual(self.summary(order).json()['amount_due'], 34.5)
        self.pay(order, 34.5)
        self.assertEqual(order.state, 'sale')
        body = self.summary(order).json()
        self.assertEqual((body['status'], body['amount_due']), ('paid', 0.0))

    def test_an_order_past_its_deadline_is_not_payable_and_the_cron_cancels_it(self):
        order = self.online_order()
        order.webvue_payment_deadline = fields.Datetime.now() - timedelta(minutes=1)
        body = self.summary(order).json()
        self.assertEqual((body['status'], body['options']), ('not_payable', []))
        refused = self.start(order)
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'not_payable'))
        fresh = self.online_order()
        staff_order = self.env['sale.order'].create({'partner_id': self.customer.id})
        self.env['sale.order']._webvue_cron_expire_unpaid()
        self.assertEqual((order.state, fresh.state, staff_order.state), ('cancel', 'draft', 'draft'))

    def test_the_cron_spares_an_order_whose_payment_is_on_its_way(self):
        open_checkout = self.online_order()
        waiting = self.online_order()
        self.paymob_transaction(115.0, sale_order_ids=[Command.set(open_checkout.ids)])
        self.paymob_transaction(115.0, sale_order_ids=[Command.set(waiting.ids)])._set_pending()
        (open_checkout | waiting).webvue_payment_deadline = fields.Datetime.now() - timedelta(minutes=1)
        self.env['sale.order']._webvue_cron_expire_unpaid()
        self.assertEqual((open_checkout.state, waiting.state), ('draft', 'draft'))
        # Once the open checkout is older than the open window, the order is cancelled after all.
        self.env.cr.execute(
            "UPDATE payment_transaction SET create_date = (now() at time zone 'UTC') - interval '16 minutes' WHERE id = %s",
            [open_checkout.transaction_ids.id],
        )
        self.env.invalidate_all()
        self.env['sale.order']._webvue_cron_expire_unpaid()
        self.assertEqual((open_checkout.state, waiting.state), ('cancel', 'draft'))

    def test_a_payment_after_cancellation_is_recorded_and_the_refund_is_due(self):
        order = self.online_order()
        service = self.env['webvue.payments.service']
        self.assertEqual(service._webvue_summary(order)['status'], 'payable')
        service._webvue_request_cancel(order)
        tx = self.pay(order, 115.0)
        self.assertEqual((tx.state, order.state), ('done', 'cancel'))
        self.assertTrue(tx.payment_id)
        summary = service._webvue_summary(order)
        self.assertEqual((summary['status'], summary['refund_due'], summary['amount_due']), ('cancelled', True, 0.0))
        self.assertFalse(service._webvue_summary(self.online_order())['refund_due'])

    def test_the_pay_link_of_an_order_is_its_pay_page_until_it_is_paid(self):
        order = self.online_order()
        service = self.env['webvue.payments.service']
        self.assertEqual(service._webvue_payment_path(order), f'/pay/order/{order.id}?access_token={order.access_token}')
        self.pay(order, 115.0)
        with self.assertRaises(NotPayable):
            service._webvue_payment_path(order)
        self.paymob.sudo().write({'state': 'test', 'is_published': False})
        with self.assertRaises(NoGateway):
            service._webvue_payment_path(self.online_order())

    def test_a_closed_feature_refuses_the_order_routes(self):
        order = self.online_order()
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.assertEqual(self.summary(order).status_code, 403)
        self.assertEqual(self.start(order).status_code, 403)
