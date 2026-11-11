# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import Command, fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import LiwanOrderCase
from odoo.addons.liwan_payments.models.payer_service import (
    AWAIT_GATEWAY,
    RECONCILE_AFTER,
    RECONCILE_BATCH,
    SETTLE_WINDOW,
)

LOGGER = 'odoo.addons.liwan_payments.models.payment_transaction'
INQUIRY = '/api/ecommerce/orders/transaction_inquiry'
PROVIDER_SECRET = 'paymob_answer_detail_never_logged'


@tagged('post_install', '-at_install', 'liwan')
class TestPaymobReconciliation(LiwanOrderCase):
    """A checkout whose notification was lost is settled from Paymob's own record, never guessed."""

    def setUp(self):
        super().setUp()
        self.queries = []
        self.answer = None
        self.patch(type(self.env['payment.provider']), '_send_api_request', self.fake_send_api_request())
        self.patch(type(self.env['ir.cron']), '_commit_progress', lambda cron, processed=0, **_: float('inf'))

    def fake_send_api_request(self):
        def send_api_request(provider, method, endpoint, **kwargs):
            self.queries.append((method, endpoint, kwargs.get('json')))
            if isinstance(self.answer, Exception):
                raise self.answer
            return self.answer
        return send_api_request

    def checkout(self, amount=115.0, aged=RECONCILE_AFTER + timedelta(minutes=1)):
        tx = self.paymob_transaction(amount, invoice_ids=[Command.set(self.customer_invoice(amount).ids)])
        self.set_age(tx, aged)
        return tx

    def set_age(self, tx, aged):
        self.env.flush_all()
        self.env.cr.execute("UPDATE payment_transaction SET create_date = %s WHERE id = %s", [fields.Datetime.now() - aged, tx.id])
        self.env.invalidate_all()

    @staticmethod
    def paymob_answer(tx, amount_cents=11500, order='987654', reference=None, success=True):
        return {
            'id': 555001, 'amount_cents': amount_cents, 'created_at': '2026-10-28T10:00:00', 'currency': 'SAR',
            'error_occured': False, 'has_parent_transaction': False, 'integration_id': 1, 'is_3d_secure': True,
            'is_auth': False, 'is_capture': False, 'is_refunded': False, 'is_standalone_payment': True,
            'is_voided': False, 'owner': 1, 'pending': False, 'success': success,
            'order': {'id': int(order), 'merchant_order_id': reference or tx.reference},
            'source_data': {'pan': '2346', 'sub_type': 'MasterCard', 'type': 'card'},
            'data': {'message': 'Approved'},
        }

    def reconcile(self):
        self.env['payment.transaction']._liwan_cron_reconcile_paymob()
        self.env.invalidate_all()

    def test_a_checkout_without_an_answer_is_settled_from_paymob(self):
        tx = self.checkout()
        self.answer = self.paymob_answer(tx)
        self.reconcile()
        self.assertEqual(self.queries, [('POST', INQUIRY, {'order_id': 987654})])
        self.assertEqual(tx.state, 'done')

    def test_a_reconciled_payment_is_recorded_on_its_invoice_at_once(self):
        tx = self.checkout()
        self.answer = self.paymob_answer(tx)
        self.reconcile()
        self.assertEqual((tx.state, tx.is_post_processed), ('done', True))
        self.assertIn(tx.invoice_ids.payment_state, ('in_payment', 'paid'))

    @mute_logger(LOGGER)
    def test_a_reconciled_payment_keeps_a_retry_after_the_last_gateway_is_off(self):
        tx = self.checkout()
        cron = self.env.ref('payment.cron_post_process_payment_tx')
        tx.provider_id.write({'state': 'disabled', 'is_published': False})
        self.env.invalidate_all()
        self.assertFalse(cron.active)
        self.answer = self.paymob_answer(tx)
        self.reconcile()
        self.assertEqual((tx.state, tx.is_post_processed), ('done', False))
        self.assertTrue(cron.active, 'the cron must stay on while a transaction waits for it')
        self.assertTrue(self.env['ir.cron.trigger'].search_count([('cron_id', '=', cron.id)]))

    def test_a_failed_query_leaves_the_checkout_and_logs_no_provider_data(self):
        tx = self.checkout()
        self.answer = ValidationError(PROVIDER_SECRET)
        with self.assertLogs(LOGGER, 'INFO') as logs:
            self.reconcile()
        self.assertEqual(tx.state, 'draft')
        self.assertEqual(len(logs.output), 1)
        self.assertIn(tx.reference, logs.output[0])
        self.assertNotIn(PROVIDER_SECRET, logs.output[0])

    def test_unanswered_checkouts_rotate_so_a_full_batch_never_starves_the_rest(self):
        checkouts = [self.checkout() for _ in range(RECONCILE_BATCH + 1)]
        self.answer = {}
        self.reconcile()
        self.assertEqual(len(self.queries), RECONCILE_BATCH)
        unasked = [tx for tx in checkouts if not tx.liwan_gateway_checked_at]
        self.assertEqual(len(unasked), 1)
        self.queries.clear()
        self.answer = self.paymob_answer(unasked[0])
        self.reconcile()
        self.assertEqual(self.queries[0], ('POST', INQUIRY, {'order_id': int(unasked[0].provider_reference)}))
        self.assertEqual(unasked[0].state, 'done')

    def test_a_declined_answer_is_left_to_the_webhook(self):
        tx = self.checkout()
        self.answer = self.paymob_answer(tx, success=False)
        self.reconcile()
        self.assertEqual((len(self.queries), tx.state), (1, 'draft'))

    def test_no_payment_at_paymob_yet_changes_nothing(self):
        tx = self.checkout()
        self.answer = {}
        self.reconcile()
        self.assertEqual((len(self.queries), tx.state), (1, 'draft'))

    def test_only_checkouts_between_the_reconcile_age_and_the_settle_window_are_queried(self):
        young = self.checkout(aged=RECONCILE_AFTER - timedelta(minutes=1))
        old = self.checkout(aged=SETTLE_WINDOW + timedelta(minutes=1))
        self.answer = self.paymob_answer(young)
        self.reconcile()
        self.assertEqual(self.queries, [])
        self.assertEqual((young.state, old.state), ('draft', 'draft'))

    def test_a_checkout_the_webhook_already_settled_is_not_queried_and_a_replay_is_harmless(self):
        tx = self.checkout()
        tx._process('paymob', self.paymob_notification(tx, 11500))
        self.assertEqual(tx.state, 'done')
        self.answer = self.paymob_answer(tx)
        self.reconcile()
        self.assertEqual(self.queries, [])
        tx._liwan_reconcile_paymob()
        self.assertEqual(tx.state, 'done')

    def test_an_answer_for_another_order_is_not_processed(self):
        tx = self.checkout()
        for answer in (self.paymob_answer(tx, order='111'), self.paymob_answer(tx, reference='another-reference')):
            self.answer = answer
            with mute_logger(LOGGER):
                self.reconcile()
            self.assertEqual(tx.state, 'draft')

    def test_an_answer_with_another_amount_does_not_settle_the_checkout(self):
        tx = self.checkout()
        self.answer = self.paymob_answer(tx, amount_cents=100)
        with mute_logger('odoo.addons.payment.models.payment_transaction'):
            self.reconcile()
        self.assertNotEqual(tx.state, 'done')

    def test_an_unanswered_gateway_checkout_holds_its_order_for_two_hours(self):
        order = self.online_order()
        order.liwan_payment_deadline = fields.Datetime.now() - timedelta(minutes=1)
        tx = self.paymob_transaction(115.0, sale_order_ids=[Command.set(order.ids)])
        self.set_age(tx, AWAIT_GATEWAY - timedelta(minutes=1))
        self.expire()
        self.assertEqual(order.state, 'draft')
        self.set_age(tx, AWAIT_GATEWAY + timedelta(minutes=1))
        self.expire()
        self.assertEqual(order.state, 'cancel')
