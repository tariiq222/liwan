# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What the order says about its invoices as they are posted, paid, credited, cancelled, and what that does to the order."""
from odoo.tests import tagged

from .common import INVOICES, ORDERS, SalesFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestInvoiceFigures(SalesFinanceCase):

    def block(self, order, user=None):
        shape = self.shape(user or self.biller, order)
        return shape['invoicing']

    def posted_order(self, **values):
        order = self.confirmed(**values)
        invoice_id = self.invoice_order(self.biller, order)['invoicing']['invoices'][0]['id']
        self.post_invoice(invoice_id)
        return order, invoice_id

    def test_a_payment_registered_in_finance_is_the_paid_amount_of_the_order(self):
        order, invoice_id = self.posted_order()
        self.assertEqual(self.block(order)['amount_paid'], 0.0)
        self.pay_invoice(invoice_id, 80.0)
        block = self.block(order)
        self.assertEqual((block['amount_paid'], block['amount_invoiced'], block['invoices'][0]['amount_residual']), (80.0, 200.0, 120.0))
        self.assertEqual(block['invoices'][0]['payment_state'], 'partial')
        self.pay_invoice(invoice_id)
        block = self.block(order)
        self.assertEqual((block['amount_paid'], block['invoices'][0]['amount_residual']), (200.0, 0.0))
        self.assertIn(block['invoices'][0]['payment_state'], ('paid', 'in_payment'))

    def test_a_draft_invoice_claims_its_amount_and_a_paid_amount_needs_a_posted_one(self):
        order = self.confirmed()
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 50})
        block = self.block(order)
        self.assertEqual((block['amount_drafted'], block['amount_invoiced'], block['amount_paid'], block['amount_to_invoice']), (100.0, 0.0, 0.0, 100.0))

    def credit(self, invoice_id):
        created = self.api_as(self.finance_manager, 'POST', f'{INVOICES}/{invoice_id}/credit-note', {})
        self.assertIn(created.status_code, (200, 201), created.text)
        return created.json()['id']

    def test_a_credit_note_is_listed_and_credited_but_does_not_open_the_amount_again(self):
        order, invoice_id = self.posted_order()
        credit_id = self.credit(invoice_id)
        draft = self.block(order)
        self.assertEqual([(item['kind'], item['state']) for item in draft['invoices']], [('credit_note', 'draft'), ('invoice', 'posted')])
        self.assertEqual((draft['amount_credited'], draft['amount_drafted']), (0.0, 0.0))
        self.post_invoice(credit_id)
        block = self.block(order)
        self.assertEqual((block['amount_invoiced'], block['amount_credited'], block['amount_to_invoice'], block['status']), (200.0, 200.0, 0.0, 'invoiced'))
        self.assertEqual(block['amount_paid'], 0.0)
        self.assertEqual([item['kind'] for item in block['invoices']], ['credit_note', 'invoice'])
        self.assertEqual(block['invoices'][1]['amount_residual'], 0.0)

    def test_money_paid_before_a_credit_note_stays_paid_until_it_is_given_back(self):
        order, invoice_id = self.posted_order()
        self.pay_invoice(invoice_id)
        self.post_invoice(self.credit(invoice_id))
        block = self.block(order)
        self.assertEqual((block['amount_paid'], block['amount_credited']), (200.0, 200.0))
        self.assertEqual((block['invoices'][0]['kind'], block['invoices'][0]['amount_residual']), ('credit_note', 200.0))

    def test_a_posted_invoice_that_finance_cancels_gives_the_amount_back(self):
        order, invoice_id = self.posted_order()
        cancelled = self.api_as(self.finance_manager, 'POST', f'{INVOICES}/{invoice_id}/cancel')
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        block = self.block(order)
        self.assertEqual((block['status'], block['amount_invoiced'], block['amount_to_invoice'], block['can_invoice']), ('to_invoice', 0.0, 200.0, True))
        self.assertEqual(self.invoice_order(self.biller, order)['invoicing']['status'], 'invoiced')

    def test_an_order_that_is_not_confirmed_has_nothing_to_invoice(self):
        draft = self.make_order(self.biller, self.fin, lines=[self.line(quantity=2)])
        block = self.block(draft)
        self.assertEqual((block['status'], block['amount_to_invoice'], block['can_invoice'], block['can_down_payment']), ('none', 0.0, False, False))
        order = self.confirmed()
        self.assertEqual(self.block(order)['status'], 'to_invoice')

    def test_cancelling_an_order_cancels_its_draft_invoices_but_never_a_posted_one(self):
        order = self.confirmed()
        invoice_id = self.invoice_order(self.biller, order)['invoicing']['invoices'][0]['id']
        self.assertTrue(self.shape(self.biller, order)['actions']['cancel'])
        cancelled = self.act(self.biller, order.id, 'cancel')
        self.assertEqual((cancelled['state'], cancelled['invoicing']['invoices'][0]['state']), ('cancelled', 'cancel'))
        self.assertEqual((cancelled['invoicing']['status'], cancelled['invoicing']['amount_to_invoice'], cancelled['invoicing']['amount_drafted']), ('none', 0.0, 0.0))
        self.assertEqual(self.env['account.move'].browse(invoice_id).state, 'cancel')
        posted, _invoice = self.posted_order()
        shape = self.shape(self.biller, posted)
        self.assertFalse(shape['actions']['cancel'])
        refused = self.api_as(self.biller, 'POST', f'{ORDERS}/{posted.id}/cancel')
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'transition_forbidden'), refused.text)
        self.assertEqual(self.env['sale.order'].browse(posted.id).state, 'sale')

    def test_a_draft_invoice_blocks_cancel_while_finance_cannot_be_written(self):
        order = self.confirmed()
        self.invoice_order(self.biller, order)
        self.assertTrue(self.shape(self.biller, order)['actions']['cancel'])
        self.feature('finance.enabled', False, retained=True)
        self.assertFalse(self.shape(self.biller, order)['actions']['cancel'])
        refused = self.api_as(self.biller, 'POST', f'{ORDERS}/{order.id}/cancel')
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'transition_forbidden'), refused.text)
        self.assertEqual(self.env['sale.order'].browse(order.id).state, 'sale')
        self.feature('finance.enabled', True)
        self.assertTrue(self.shape(self.biller, order)['actions']['cancel'])
        plain = self.confirmed()
        self.feature('finance.enabled', False, retained=True)
        self.assertTrue(self.shape(self.biller, plain)['actions']['cancel'])

    def test_a_salesperson_without_finance_cancels_only_an_order_with_no_live_invoice(self):
        plain = self.confirmed(user=self.seller)
        self.assertTrue(self.shape(self.seller, plain)['actions']['cancel'])
        billed = self.confirmed(user=self.seller)
        self.invoice_order(self.boss, billed)
        shape = self.shape(self.seller, billed)
        self.assertNotIn('amount_invoiced', shape['invoicing'] or {})
        self.assertIsNone(shape['invoicing'])
        self.assertFalse(shape['actions']['cancel'])
        cancelled = self.act(self.boss, billed.id, 'cancel')
        self.assertEqual((cancelled['state'], cancelled['invoicing']['invoices'][0]['state']), ('cancelled', 'cancel'))
        self.assertTrue(self.shape(self.seller, plain)['actions']['cancel'])

    def test_a_duplicate_of_an_invoiced_order_carries_no_down_payment_line(self):
        order = self.confirmed()
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})
        copy = self.act(self.biller, order.id, 'duplicate')
        self.assertEqual([line['kind'] for line in copy['lines']], ['product'])
        self.assertEqual(copy['invoicing']['invoices'], [])
