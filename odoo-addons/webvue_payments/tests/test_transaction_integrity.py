# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import WebVuePayerCase


@tagged('post_install', '-at_install', 'webvue')
class TestTransactionIntegrity(WebVuePayerCase):
    """Spike finding F5: a repeated notification must not turn a rejected amount into a payment."""

    def paymob_transaction(self, amount):
        Transaction = self.env['payment.transaction']
        return Transaction.create({
            'provider_id': self.paymob.id,
            'payment_method_id': self.card.id,
            'reference': Transaction._compute_reference('paymob', invoice_ids=[Command.set(self.invoice.ids)]),
            'amount': amount,
            'currency_id': self.env.ref('base.SAR').id,
            'partner_id': self.customer.id,
            'operation': 'online_redirect',
            'invoice_ids': [Command.set(self.invoice.ids)],
            'provider_reference': '987654',
        })

    def notification(self, tx, amount_cents, success=True):
        """A Paymob notification after the stock controller's normalization."""
        return {
            'merchant_order_id': tx.reference, 'order': '987654', 'amount_cents': str(amount_cents),
            'currency': 'SAR', 'success': 'true' if success else 'false', 'pending': 'false',
            'data.message': 'Approved' if success else 'Declined',
        }

    def test_a_repeated_notification_with_a_wrong_amount_stays_in_error(self):
        tx = self.paymob_transaction(500.0)
        short = self.notification(tx, 30000)
        tx._process('paymob', short)
        self.assertEqual(tx.state, 'error')
        tx._process('paymob', short)
        self.assertEqual(tx.state, 'error')
        self.env['payment.transaction']._process('paymob', short)
        self.assertEqual(tx.state, 'error')

    def test_a_declined_card_followed_by_a_valid_payment_still_completes(self):
        tx = self.paymob_transaction(115.0)
        tx._process('paymob', self.notification(tx, 11500, success=False))
        self.assertEqual(tx.state, 'error')
        tx._process('paymob', self.notification(tx, 11500))
        self.assertEqual(tx.state, 'done')

    def test_a_matching_notification_completes_once(self):
        tx = self.paymob_transaction(115.0)
        valid = self.notification(tx, 11500)
        tx._process('paymob', valid)
        tx._process('paymob', valid)
        self.assertEqual(tx.state, 'done')
