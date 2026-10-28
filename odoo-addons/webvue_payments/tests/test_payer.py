# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVuePayerCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

INVOICE_KEYS = {'id', 'merchant', 'number', 'due_date', 'currency', 'amount_total', 'amount_due', 'status', 'options'}
OPTION_KEYS = {'provider_id', 'provider', 'method_id', 'method', 'method_name'}
CHECKOUT = 'https://ksa.paymob.com/unifiedcheckout/'


@tagged('post_install', '-at_install', 'webvue')
class TestPayer(WebVuePayerCase):
    """The anonymous payer: no session, one token per invoice, every value from the server."""

    def stub_checkout(self, fail=False):
        """Replace the Paymob intention call (network) with a checkout page, or with a refusal."""
        Transaction = type(self.env['payment.transaction'])
        original = Transaction._get_specific_rendering_values

        def rendering(tx, processing_values):
            if tx.provider_code != 'paymob':
                return original(tx, processing_values)
            if fail:
                tx._set_error('Paymob refused the intention')
                return {}
            tx.provider_reference = '987654'
            return {'api_url': CHECKOUT, 'url_params': {'publicKey': 'pk_test', 'clientSecret': 'cs_test'}}
        self.patch(Transaction, '_get_specific_rendering_values', rendering)

    def start(self, invoice=None, **overrides):
        invoice = invoice or self.invoice
        body = {'access_token': invoice.access_token, 'provider_id': self.paymob.id, 'payment_method_id': self.card.id}
        return self.api('POST', self.start_url(invoice), json={**body, **overrides})

    def test_the_summary_shows_the_invoice_and_its_payment_options_only(self):
        response = self.api('GET', self.summary_url())
        self.assertEqual(response.status_code, 200)
        self.assertNotIn('set-cookie', {key.lower() for key in response.headers})
        body = response.json()
        self.assertEqual(set(body), INVOICE_KEYS)
        self.assertEqual(
            (body['status'], body['currency'], body['amount_due'], body['number']),
            ('payable', 'SAR', 115.0, self.invoice.name),
        )
        self.assertNotIn(self.customer.name, response.text)
        option = next(row for row in body['options'] if row['provider_id'] == self.paymob.id)
        self.assertEqual(set(option), OPTION_KEYS)
        self.assertEqual(option['method_id'], self.card.id)

    def test_every_token_failure_is_the_same_404(self):
        bill = self.customer_invoice(move_type='out_refund')
        bill._portal_ensure_token()
        responses = [
            self.api('GET', self.summary_url(token='wrong-token')),
            self.api('GET', f'/api/v1/public/payments/invoices/{self.invoice.id}'),
            self.api('GET', f'/api/v1/public/payments/invoices/{self.invoice.id + 100000}?access_token=x'),
            self.api('GET', self.summary_url(bill)),
            self.api('GET', self.summary_url(token='x' * 200)),
            self.start(access_token='wrong-token'),
        ]
        for response in responses:
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'))
        self.assertEqual(len({response.json()['message'] for response in responses}), 1)

    def test_starting_a_payment_builds_the_transaction_from_the_invoice(self):
        self.stub_checkout()
        response = self.start()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'redirect': {
            'method': 'get', 'url': CHECKOUT, 'fields': {'publicKey': 'pk_test', 'clientSecret': 'cs_test'},
        }})
        self.assertNotIn('set-cookie', {key.lower() for key in response.headers})
        tx = self.invoice.transaction_ids
        self.assertEqual(len(tx), 1)
        self.assertEqual(
            (tx.amount, tx.currency_id.name, tx.partner_id, tx.provider_id, tx.payment_method_id),
            (115.0, 'SAR', self.customer, self.paymob, self.card),
        )

    def test_the_payer_cannot_choose_the_amount_or_an_unoffered_method(self):
        self.stub_checkout()
        for field in ('amount', 'partner_id', 'currency_id', 'flow', 'landing_route'):
            with self.subTest(field=field):
                response = self.start(**{field: 1})
                self.assertEqual((response.status_code, response.json()['code']), (422, 'unknown_field'))
        other_method = self.env['payment.method'].with_context(active_test=False).search(
            [('id', '!=', self.card.id)], limit=1,
        )
        refused = self.start(payment_method_id=other_method.id)
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'payment_unavailable'))
        self.assertFalse(self.invoice.transaction_ids)

    def test_a_gateway_that_refuses_to_start_answers_payment_unavailable(self):
        self.stub_checkout(fail=True)
        response = self.start()
        self.assertEqual((response.status_code, response.json()['code']), (422, 'payment_unavailable'))

    def test_a_paid_invoice_is_not_payable_again(self):
        self.invoice.payment_state = 'paid'
        summary = self.api('GET', self.summary_url()).json()
        self.assertEqual((summary['status'], summary['options']), ('paid', []))
        refused = self.start()
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'not_payable'))

    def test_a_closed_feature_refuses_the_payer_routes(self):
        set_probe_feature(self, key='payments.enabled', enabled=False)
        self.assertEqual(self.api('GET', self.summary_url()).status_code, 403)
        self.assertEqual(self.start().status_code, 403)
