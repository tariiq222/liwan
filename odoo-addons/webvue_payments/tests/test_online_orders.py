# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, fields
from odoo.exceptions import LockError, UserError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import WebVueOrderCase
from .test_payer import CHECKOUT, OPTION_KEYS
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_payments.models.order_service import (
    NoGateway,
    NotInvoiceable,
    NotPayable,
)

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
        self.expire()
        self.assertEqual((order.state, fresh.state, staff_order.state), ('cancel', 'draft', 'draft'))

    def test_the_cron_spares_an_order_whose_payment_is_on_its_way(self):
        open_checkout = self.online_order()
        waiting = self.online_order()
        self.paymob_transaction(115.0, sale_order_ids=[Command.set(open_checkout.ids)])
        self.paymob_transaction(115.0, sale_order_ids=[Command.set(waiting.ids)])._set_pending()
        (open_checkout | waiting).webvue_payment_deadline = fields.Datetime.now() - timedelta(minutes=1)
        self.expire()
        self.assertEqual((open_checkout.state, waiting.state), ('draft', 'draft'))
        # Once the open checkout is older than the open window, the order is cancelled after all.
        self.env.cr.execute(
            "UPDATE payment_transaction SET create_date = (now() at time zone 'UTC') - interval '16 minutes' WHERE id = %s",
            [open_checkout.transaction_ids.id],
        )
        self.env.invalidate_all()
        self.expire()
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
        self.assertEqual((summary['status'], summary['amount_to_refund'], summary['amount_due']), ('cancelled', 115.0, 0.0))
        self.assertEqual(service._webvue_summary(self.online_order())['amount_to_refund'], 0.0)

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


@tagged('post_install', '-at_install', 'webvue')
class TestOnlineOrderMoney(WebVueOrderCase):
    """Money is never left in limbo: a payment that is not recorded, a stale pending one, refunds and overpayments."""

    def past_deadline(self, order):
        order.webvue_payment_deadline = fields.Datetime.now() - timedelta(minutes=1)
        return order

    def test_a_received_payment_that_is_not_recorded_holds_the_order_then_needs_a_person(self):
        order = self.past_deadline(self.online_order())
        tx = self.paymob_transaction(115.0, sale_order_ids=[Command.set(order.ids)])
        tx._process('paymob', self.paymob_notification(tx, 11500))
        self.assertEqual((tx.state, tx.is_post_processed), ('done', False))
        service = self.env['webvue.payments.service']
        self.expire()
        self.assertEqual(order.state, 'draft')
        self.assertFalse(service._webvue_summary(order)['needs_attention'])
        self.age(tx, hours=2)
        self.assertTrue(service._webvue_summary(order)['needs_attention'])
        # Once stock stops retrying the post-processing, the order is released and the money is due back.
        self.age(tx, days=4)
        self.expire()
        summary = service._webvue_summary(order)
        self.assertEqual((order.state, summary['status'], summary['amount_to_refund']), ('cancel', 'cancelled', 115.0))

    def test_a_payment_left_pending_releases_the_order_after_a_day(self):
        order = self.past_deadline(self.online_order())
        tx = self.paymob_transaction(115.0, sale_order_ids=[Command.set(order.ids)])
        tx._set_pending()
        self.expire()
        self.assertEqual(order.state, 'draft')
        self.age(tx, days=1, minutes=1)
        self.expire()
        self.assertEqual(order.state, 'cancel')

    def test_one_failing_order_does_not_hold_the_others_back(self):
        failing, other = self.past_deadline(self.online_order()), self.past_deadline(self.online_order())
        SaleOrder = type(self.env['sale.order'])
        cancel = SaleOrder._action_cancel

        def action_cancel(orders):
            if failing in orders:
                msg = 'cancel failed'
                raise ValueError(msg)
            return cancel(orders)
        self.patch(SaleOrder, '_action_cancel', action_cancel)
        with mute_logger('odoo.addons.webvue_payments.models.sale_order'):
            self.expire()
        self.assertEqual((failing.state, other.state), ('draft', 'cancel'))

    def test_an_order_whose_checkout_is_being_started_is_left_to_the_next_run(self):
        order = self.past_deadline(self.online_order())

        def locked(records, allow_referencing=False):
            msg = 'locked'
            raise LockError(msg)
        self.patch(type(order), 'lock_for_update', locked)
        self.expire()
        self.assertEqual(order.state, 'draft')

    def test_a_refund_settles_what_a_cancelled_order_kept_and_an_overpayment_is_due_back(self):
        service = self.env['webvue.payments.service']
        cancelled = self.online_order()
        service._webvue_request_cancel(cancelled)
        tx = self.pay(cancelled, 115.0)
        self.assertEqual(service._webvue_summary(cancelled)['amount_to_refund'], 115.0)
        tx._create_child_transaction(115.0, is_refund=True)._set_done()
        self.assertEqual(service._webvue_summary(cancelled)['amount_to_refund'], 0.0)
        paid_twice = self.online_order()
        self.pay(paid_twice, 115.0)
        self.assertEqual(service._webvue_summary(paid_twice)['amount_to_refund'], 0.0)
        self.pay(paid_twice, 115.0)
        self.assertEqual(service._webvue_summary(paid_twice)['amount_to_refund'], 115.0)

    def test_without_a_sales_journal_no_pay_link_is_offered(self):
        self.env['account.journal'].search([('company_id', '=', self.env.company.id), ('type', '=', 'sale')]).active = False
        order = self.online_order()
        with self.assertRaises(NotInvoiceable):
            self.env['webvue.payments.service']._webvue_payment_path(order)
        self.assertEqual(self.env['webvue.payments.payer']._webvue_status(order), 'not_payable')
        self.env['ir.config_parameter'].sudo().set_param('sale.automatic_invoice', 'False')
        self.assertEqual(self.env['webvue.payments.payer']._webvue_status(order), 'payable')

    def test_without_invoice_when_paid_a_paid_order_is_confirmed_without_an_invoice(self):
        self.env['ir.config_parameter'].sudo().set_param('sale.automatic_invoice', 'False')
        order = self.online_order()
        tx = self.pay(order, 115.0)
        self.assertEqual((order.state, order.invoice_ids, bool(tx.payment_id)), ('sale', self.env['account.move'], True))

    def test_a_line_is_added_only_to_an_open_online_order(self):
        service = self.env['webvue.payments.service']
        staff_order = self.env['sale.order'].create({'partner_id': self.customer.id})
        paid = self.online_order()
        self.pay(paid, 115.0)
        for order in (staff_order, paid):
            with self.subTest(order=order.name), self.assertRaises(UserError):
                service._webvue_add_line(order, self.service)
