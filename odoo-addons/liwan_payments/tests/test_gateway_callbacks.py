# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import Command
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import PAYMOB_CREDENTIALS, LiwanPayerCase
from odoo.addons.payment_paymob.controllers.main import PaymobController

HOOK = '/api/v1/public/payments/hooks/paymob/%s'


@tagged('post_install', '-at_install', 'liwan')
class TestGatewayCallbacks(LiwanPayerCase):
    """Gateway notifications and returns reach the stock Paymob controller unchanged."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.tx = cls.paymob_transaction(115.0, invoice_ids=[Command.set(cls.invoice.ids)])

    def payload(self, amount_cents=11500):
        return {'type': 'TRANSACTION', 'obj': {
            'id': 555001, 'amount_cents': amount_cents, 'created_at': '2026-10-28T10:00:00', 'currency': 'SAR',
            'error_occured': False, 'has_parent_transaction': False, 'integration_id': 1, 'is_3d_secure': True,
            'is_auth': False, 'is_capture': False, 'is_refunded': False, 'is_standalone_payment': True,
            'is_voided': False, 'owner': 1, 'pending': False, 'success': True,
            'order': {'id': 987654, 'merchant_order_id': self.tx.reference},
            'source_data': {'pan': '2346', 'sub_type': 'MasterCard', 'type': 'card'},
            'data': {'message': 'Approved'},
        }}

    def signature(self, payload):
        normalized = PaymobController._normalize_response(payload['obj'], None)
        return PaymobController._compute_signature(normalized, PAYMOB_CREDENTIALS['paymob_hmac_key'])

    def post_webhook(self, payload, signature):
        return self.url_open(
            f'{HOOK % "webhook"}?hmac={signature}', data=json.dumps(payload),
            headers={'Content-Type': 'application/json'},
        )

    def test_a_signed_webhook_pays_the_invoice_in_the_same_request(self):
        payload = self.payload()
        response = self.post_webhook(payload, self.signature(payload))
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('set-cookie', {key.lower() for key in response.headers})
        self.env.invalidate_all()
        self.assertEqual(self.tx.state, 'done')
        self.assertTrue(self.tx.is_post_processed)
        self.assertTrue(self.tx.payment_id)
        self.assertIn(self.invoice.payment_state, ('in_payment', 'paid'))
        self.assertEqual(self.api('GET', self.summary_url()).json()['status'], 'paid')
        again = self.post_webhook(payload, self.signature(payload))
        self.assertEqual(again.status_code, 200)
        self.env.invalidate_all()
        self.assertEqual(len(self.env['account.payment'].search([('payment_transaction_id', '=', self.tx.id)])), 1)

    @mute_logger('odoo.addons.liwan_payments.controllers.hooks')
    def test_a_failed_post_processing_keeps_a_retry_after_the_last_gateway_is_off(self):
        cron = self.env.ref('payment.cron_post_process_payment_tx')
        self.paymob.sudo().write({'state': 'disabled', 'is_published': False})
        self.env.invalidate_all()
        self.assertFalse(cron.active)

        def failing(transactions):
            message = 'post-processing failed'
            raise RuntimeError(message)
        self.patch(type(self.env['payment.transaction']), '_post_process', failing)
        payload = self.payload()
        self.assertEqual(self.post_webhook(payload, self.signature(payload)).status_code, 200)
        self.env.invalidate_all()
        self.assertEqual((self.tx.state, self.tx.is_post_processed), ('done', False))
        self.assertTrue(cron.active, 'the cron must stay on while a transaction waits for it')
        self.assertTrue(self.env['ir.cron.trigger'].search_count([('cron_id', '=', cron.id)]))

    @mute_logger('odoo.addons.payment_paymob.controllers.main', 'odoo.http')
    def test_a_tampered_or_unsigned_webhook_changes_nothing(self):
        payload = self.payload()
        signature = self.signature(payload)
        tampered = self.payload(amount_cents=1)
        self.assertEqual(self.post_webhook(tampered, signature).status_code, 403)
        unsigned = self.url_open(HOOK % 'webhook', data=json.dumps(payload), headers={'Content-Type': 'application/json'})
        self.assertEqual(unsigned.status_code, 403)
        self.env.invalidate_all()
        self.assertEqual(self.tx.state, 'draft')

    def test_a_callback_that_processes_nothing_touches_nothing(self):
        triggers = self.env['ir.cron.trigger'].search_count([])
        response = self.url_open(HOOK % 'return')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.env['ir.cron.trigger'].search_count([]), triggers)
        self.env.invalidate_all()
        self.assertEqual(self.tx.state, 'draft')

    def test_unknown_gateways_and_kinds_are_not_found(self):
        for path in ('/api/v1/public/payments/hooks/stripe/webhook', HOOK % 'refund', HOOK % 'status'):
            with self.subTest(path=path):
                self.assertEqual(self.url_open(path, data='{}', headers={'Content-Type': 'application/json'}).status_code, 404)

    @mute_logger('odoo.addons.payment_paymob.controllers.main')
    def test_the_return_is_processed_and_answers_no_content(self):
        payload = self.payload()
        normalized = PaymobController._normalize_response(payload['obj'], None)
        query = {**normalized, 'hmac': self.signature(payload)}
        response = self.url_open(f'{HOOK % "return"}?' + '&'.join(f'{key}={value}' for key, value in query.items()))
        self.assertEqual(response.status_code, 204)
        self.env.invalidate_all()
        self.assertEqual(self.tx.state, 'done')
