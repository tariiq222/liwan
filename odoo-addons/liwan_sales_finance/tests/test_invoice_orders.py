# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The whole-order invoice: stock makes a draft customer invoice of a confirmed staff order, and finance posts it."""
from odoo import Command
from odoo.tests import tagged

from .common import INVOICE_BLOCK_KEYS, INVOICE_ITEM_KEYS, INVOICES, SalesFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestInvoiceWholeOrder(SalesFinanceCase):

    def figures(self, body):
        return {key: value for key, value in body['invoicing'].items() if key != 'invoices'}

    def test_a_confirmed_order_makes_a_draft_invoice_in_each_mode_and_session(self):
        sessions = (('root', self.biller, self.fin), ('branch', self.branch_biller, self.fin_branch))
        for mode in ('saas', 'non_saas'):
            self.set_mode(mode)
            for name, user, company in sessions:
                with self.subTest(mode=mode, session=name):
                    order = self.confirmed(user=user, company=company, lines=[self.line(quantity=2, discount=10)])
                    before = self.shape(user, order)['invoicing']
                    self.assertEqual(set(before), INVOICE_BLOCK_KEYS)
                    self.assertEqual((before['status'], before['amount_to_invoice'], before['invoices']), ('to_invoice', order.amount_total, []))
                    self.assertTrue(before['can_invoice'] and before['can_down_payment'])
                    block = self.invoice_order(user, order)['invoicing']
                    self.assertEqual(set(block['invoices'][0]), INVOICE_ITEM_KEYS)
                    self.assertEqual(
                        (block['status'], block['amount_drafted'], block['amount_to_invoice'], block['amount_invoiced'], block['amount_paid']),
                        ('invoiced', order.amount_total, 0.0, 0.0, 0.0),
                    )
                    self.assertFalse(block['can_invoice'] or block['can_down_payment'])
                    invoice = self.env['account.move'].browse(block['invoices'][0]['id'])
                    self.assertEqual(
                        (invoice.state, invoice.move_type, invoice.partner_id, invoice.company_id, invoice.currency_id, invoice.invoice_origin),
                        ('draft', 'out_invoice', order.partner_id, company, order.currency_id, order.name),
                    )
                    self.assertEqual((invoice.amount_untaxed, invoice.amount_total), (order.amount_untaxed, order.amount_total))
                    self.assertEqual(invoice.invoice_line_ids.sale_line_ids, order.order_line)
                    self.assertEqual(invoice.journal_id.company_id, company)

    def test_nothing_is_posted_and_a_second_whole_order_invoice_is_refused(self):
        order = self.confirmed()
        block = self.invoice_order(self.biller, order)['invoicing']
        self.assertEqual([invoice['state'] for invoice in block['invoices']], ['draft'])
        self.assertEqual(self.env['account.move'].browse(block['invoices'][0]['id']).state, 'draft')
        refused = self.invoice_order(self.biller, order, expect=422)
        self.assertEqual(refused['code'], 'nothing_to_invoice')
        self.assertEqual(len(self.env['sale.order'].browse(order.id).invoice_ids), 1)

    def test_finance_posts_the_invoice_with_its_own_rules_and_the_order_follows(self):
        order = self.confirmed()
        invoice_id = self.invoice_order(self.biller, order)['invoicing']['invoices'][0]['id']
        # An accountant drafts but never posts: posting is finance's own capability.
        refused = self.api_as(self.accountant, 'POST', f'{INVOICES}/{invoice_id}/post')
        self.assertEqual(refused.status_code, 403, refused.text)
        posted = self.post_invoice(invoice_id)
        self.assertEqual(posted['state'], 'posted')
        block = self.shape(self.biller, order)['invoicing']
        self.assertEqual(
            (block['status'], block['amount_invoiced'], block['amount_drafted'], block['amount_to_invoice'], block['amount_paid']),
            ('invoiced', order.amount_total, 0.0, 0.0, 0.0),
        )
        self.assertEqual((block['invoices'][0]['state'], block['invoices'][0]['number'] is not None), ('posted', True))

    def test_the_customer_the_terms_and_the_lines_come_from_the_order(self):
        term = self.env['account.payment.term'].create({'name': '30 days', 'line_ids': [Command.create({'value': 'percent', 'value_amount': 100, 'nb_days': 30})]})
        order = self.confirmed(lines=[self.line(self.item, 2), self.line(self.item2, 3)], payment_term_id=term.id)
        invoice = self.env['account.move'].browse(self.invoice_order(self.biller, order)['invoicing']['invoices'][0]['id'])
        self.assertEqual(invoice.invoice_payment_term_id, term)
        self.assertEqual(
            sorted((line.product_id, line.quantity, line.price_unit, line.discount, line.tax_ids) for line in invoice.invoice_line_ids),
            sorted((line.product_id, line.product_uom_qty, line.price_unit, line.discount, line.tax_ids) for line in order.order_line),
        )

    def test_the_finance_invoice_names_its_order_to_a_reader_of_sales_only(self):
        order = self.confirmed()
        invoice_id = self.invoice_order(self.biller, order)['invoicing']['invoices'][0]['id']
        seen = self.api_as(self.biller, 'GET', f'{INVOICES}/{invoice_id}')
        self.assertEqual(seen.json()['source_order'], {'id': order.id, 'number': order.name})
        # Finance only (no Sales right): the order never leaves the server.
        seen = self.api_as(self.accountant, 'GET', f'{INVOICES}/{invoice_id}')
        self.assertEqual((seen.status_code, seen.json()['source_order']), (200, None), seen.text)
        # Another salesperson under `own` visibility does not read the order either.
        seen = self.api_as(self.biller2, 'GET', f'{INVOICES}/{invoice_id}')
        self.assertEqual((seen.status_code, seen.json()['source_order']), (200, None), seen.text)
        # An invoice that no order made carries null.
        plain = self.env['account.move'].with_company(self.fin).create({
            'move_type': 'out_invoice', 'partner_id': order.partner_id.id,
            'invoice_line_ids': [Command.create({'name': 'Own', 'quantity': 1, 'price_unit': 10})],
        })
        self.assertIsNone(self.api_as(self.biller, 'GET', f'{INVOICES}/{plain.id}').json()['source_order'])

    def test_a_credit_note_of_an_order_invoice_names_the_same_order(self):
        order = self.confirmed()
        invoice_id = self.invoice_order(self.biller, order)['invoicing']['invoices'][0]['id']
        self.post_invoice(invoice_id)
        created = self.api_as(self.finance_manager, 'POST', f'{INVOICES}/{invoice_id}/credit-note', {})
        self.assertIn(created.status_code, (200, 201), created.text)
        seen = self.api_as(self.biller, 'GET', f'{INVOICES}/{created.json()["id"]}')
        self.assertEqual((seen.status_code, seen.json()['source_order']), (200, {'id': order.id, 'number': order.name}), seen.text)
