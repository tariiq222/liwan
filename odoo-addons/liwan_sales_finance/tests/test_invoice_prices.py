# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The invoice carries the order's product, taxes, discount, currency and customer, as finance's own product lines do."""
from odoo import Command
from odoo.tests import tagged

from .common import INVOICES, SalesFinanceCase


@tagged('post_install', '-at_install', 'liwan')
class TestInvoicePrices(SalesFinanceCase):

    def invoice_of(self, order, body=None):
        block = self.invoice_order(self.biller, order, body)['invoicing']
        return self.env['account.move'].browse(block['invoices'][0]['id'])

    def test_an_establishment_not_registered_for_vat_invoices_without_tax_and_finance_can_edit_it(self):
        self.fin.liwan_vat_registered = False
        order = self.confirmed(lines=[self.line(self.item, 2), self.line(self.item2, 1)])
        self.assertFalse(order.order_line.tax_ids)
        invoice = self.invoice_of(order)
        self.assertFalse(invoice.invoice_line_ids.tax_ids)
        self.assertEqual((invoice.amount_tax, invoice.amount_total), (0.0, 240.0))
        seen = self.api_as(self.finance_manager, 'GET', f'{INVOICES}/{invoice.id}')
        self.assertEqual(seen.status_code, 200, seen.text)
        lines = seen.json()['lines']
        self.assertEqual([line['taxes'] for line in lines], [[], []])
        self.assertTrue(all(line['product'] for line in lines))
        edited = self.api_as(self.finance_manager, 'PATCH', f'{INVOICES}/{invoice.id}', {
            'lines': [{'product_id': self.item.id, 'quantity': 3}, {'product_id': self.item2.id, 'quantity': 1, 'discount': 50}],
        })
        self.assertEqual(edited.status_code, 200, edited.text)
        self.assertEqual((edited.json()['amount_tax'], edited.json()['amount_total']), (0.0, 320.0))
        typed = self.api_as(self.finance_manager, 'PATCH', f'{INVOICES}/{invoice.id}', {
            'lines': [{'product_id': self.item.id, 'quantity': 1, 'tax_ids': [self.vat.id]}],
        })
        self.assertEqual((typed.status_code, typed.json()['field']), (422, 'lines[0].tax_ids'), typed.text)

    def test_a_registered_establishment_invoices_with_the_product_tax_included_in_the_price(self):
        order = self.confirmed(lines=[self.line(self.item, 2, discount=10)])
        invoice = self.invoice_of(order)
        self.assertEqual(invoice.invoice_line_ids.tax_ids, self.vat)
        self.assertEqual((invoice.amount_total, invoice.amount_untaxed, invoice.amount_tax), (180.0, 156.52, 23.48))
        seen = self.api_as(self.finance_manager, 'GET', f'{INVOICES}/{invoice.id}').json()
        self.assertEqual((seen['lines'][0]['product']['id'], seen['lines'][0]['discount'], seen['lines'][0]['taxes'][0]['id']), (self.item.id, 10.0, self.vat.id))

    def test_a_price_that_adds_the_tax_invoices_the_taxed_total(self):
        order = self.confirmed(lines=[self.line(self.taxed, 2)])
        self.assertEqual(order.amount_total, 230.0)
        invoice = self.invoice_of(order)
        self.assertEqual((invoice.amount_untaxed, invoice.amount_tax, invoice.amount_total), (200.0, 30.0, 230.0))
        half = self.confirmed(lines=[self.line(self.taxed, 2)])
        down = self.invoice_order(self.biller, half, {'method': 'percent', 'percent': 50})['invoicing']
        self.assertEqual((down['invoices'][0]['amount_total'], down['amount_to_invoice']), (115.0, 115.0))

    def test_a_foreign_currency_order_invoices_in_its_currency_and_follows_a_repriced_draft(self):
        usd = self.env.ref('base.USD')
        usd.active = True
        self.env['res.currency.rate'].create({'currency_id': usd.id, 'name': '2026-01-01', 'rate': 0.25, 'company_id': self.fin.id})
        pricelist = self.env['product.pricelist'].create({'name': 'USD list', 'currency_id': usd.id})
        order = self.confirmed(lines=[self.line(self.item, 2)], pricelist_id=pricelist.id)
        self.assertEqual(order.currency_id, usd)
        block = self.invoice_order(self.biller, order)['invoicing']
        invoice = self.env['account.move'].browse(block['invoices'][0]['id'])
        self.assertEqual((invoice.currency_id, block['invoices'][0]['currency'], block['amount_drafted']), (usd, 'USD', 200.0))
        patched = self.api_as(self.finance_manager, 'PATCH', f'{INVOICES}/{invoice.id}', {'currency': 'SAR'})
        self.assertEqual(patched.status_code, 200, patched.text)
        after = self.shape(self.biller, order)['invoicing']
        # The draft is now 200 SAR, which is 50 USD at this rate; the order is in USD.
        self.assertEqual((after['invoices'][0]['currency'], after['amount_drafted'], after['amount_to_invoice']), ('SAR', 50.0, 150.0))

    def test_the_customer_of_the_invoice_is_the_invoice_address_of_the_order(self):
        order = self.confirmed()
        address = self.env['res.partner'].create({'name': 'Head office', 'parent_id': order.partner_id.id, 'type': 'invoice'})
        invoice = self.invoice_of(order)
        self.assertEqual(invoice.partner_id, address if order.partner_invoice_id == address else order.partner_invoice_id)

    def test_every_order_line_kind_a_quotation_holds_makes_a_clean_invoice(self):
        order = self.confirmed(lines=[
            Command.create({'display_type': 'line_section', 'name': 'Phase one'}),
            self.line(self.item, 1),
            Command.create({'display_type': 'line_note', 'name': 'A note'}),
        ])
        invoice = self.invoice_of(order)
        self.assertEqual(invoice.amount_total, 100.0)
        self.assertEqual(len(invoice.invoice_line_ids.filtered(lambda line: line.display_type == 'product')), 1)
