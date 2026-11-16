# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The section and the line stock adds to an order for a down payment are bookkeeping: Sales shows and edits what was sold."""
from odoo.tests import tagged

from .common import ORDERS, SalesFinanceCase
from odoo.addons.liwan_sales.serializers.public import dump_public_quotation


@tagged('post_install', '-at_install', 'liwan')
class TestDownPaymentLines(SalesFinanceCase):

    def down_paid(self, **values):
        order = self.confirmed(lines=[self.line(quantity=2)], **values)
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})
        return order

    def stock_lines(self, order):
        return self.env['sale.order'].browse(order.id).order_line

    def test_stock_adds_a_section_and_a_line_and_the_order_shape_shows_neither(self):
        order = self.down_paid()
        stock = self.stock_lines(order)
        self.assertEqual(len(stock.filtered('is_downpayment')), 2, stock.mapped('name'))
        shape = self.shape(self.biller, order)
        self.assertEqual([line['kind'] for line in shape['lines']], ['product'])
        self.assertEqual(shape['lines'][0]['id'], stock.filtered(lambda line: not line.is_downpayment).id)

    def test_a_down_payment_leaves_the_order_total_alone(self):
        order = self.confirmed(lines=[self.line(quantity=2, discount=10)])
        before = self.shape(self.biller, order)
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})
        self.invoice_order(self.biller, order, {'method': 'amount', 'amount': 20.0})
        after = self.shape(self.biller, order)
        for key in ('amount_untaxed', 'amount_tax', 'amount_total'):
            self.assertEqual(after[key], before[key], key)
        self.assertEqual(self.env['sale.order'].browse(order.id).amount_total, order.amount_total)

    def test_the_lines_route_cannot_name_or_remove_a_down_payment_line(self):
        order = self.confirmed(user=self.biller, lines=[self.line(quantity=2)])
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})
        down = self.stock_lines(order).filtered('is_downpayment')
        self.act(self.biller, order.id, 'cancel')
        self.act(self.biller, order.id, 'reopen')
        product = self.stock_lines(order).filtered(lambda line: not line.is_downpayment)
        body = {'lines': [{'id': down[0].id, 'kind': 'product', 'product_id': self.item.id, 'quantity': 1, 'discount_percent': 0}]}
        response = self.api_as(self.biller, 'PATCH', f'{ORDERS}/{order.id}', body)
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), response.text)
        self.assertEqual(self.stock_lines(order).filtered('is_downpayment'), down)
        kept = {'lines': [{'id': product.id, 'kind': 'product', 'product_id': self.item.id, 'quantity': 3, 'discount_percent': 0}]}
        saved = self.api_as(self.biller, 'PATCH', f'{ORDERS}/{order.id}', kept)
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual([line['quantity'] for line in saved.json()['lines']], [3.0])
        self.assertEqual(self.stock_lines(order).filtered('is_downpayment'), down)

    def test_a_reopened_order_still_shows_only_what_was_sold(self):
        order = self.confirmed(user=self.biller, lines=[self.line(quantity=2)])
        total = self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})['amount_total']
        self.act(self.biller, order.id, 'cancel')
        reopened = self.act(self.biller, order.id, 'reopen')
        self.assertEqual(reopened['state'], 'draft')
        self.assertEqual([line['kind'] for line in reopened['lines']], ['product'])
        self.assertEqual(reopened['amount_total'], total)

    def test_a_duplicate_carries_no_down_payment_line(self):
        copy = self.act(self.biller, self.down_paid().id, 'duplicate')
        self.assertEqual([line['kind'] for line in copy['lines']], ['product'])
        stock = self.stock_lines(self.env['sale.order'].browse(copy['id']))
        self.assertFalse(stock.filtered('is_downpayment'))

    def test_the_pdf_and_the_public_page_list_no_down_payment_line(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        invoice_id = self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})['invoicing']['invoices'][0]['id']
        self.post_invoice(invoice_id)
        order = self.env['sale.order'].browse(order.id)
        shown = order._get_order_lines_to_report()
        self.assertTrue(shown and not shown.filtered('is_downpayment'), shown.mapped('name'))
        self.assertEqual([line['kind'] for line in dump_public_quotation(order)['lines']], ['product'])
