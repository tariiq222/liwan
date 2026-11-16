# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A down payment is invoicing bookkeeping: the Sales reports count what was sold, not the lines stock adds for it."""
from odoo.tests import tagged

from .common import SalesFinanceCase

SUMMARY = '/api/v1/sales/reports/summary'
BREAKDOWN = '/api/v1/sales/reports/breakdown'
EXPORT = '/api/v1/sales/reports/export'


@tagged('post_install', '-at_install', 'liwan')
class TestReportDownPayments(SalesFinanceCase):

    def report(self, path):
        response = self.api_as(self.sales_boss, 'GET', path)
        self.assertEqual(response.status_code, 200, response.text)
        return response

    def confirmed_figures(self):
        group = self.report(SUMMARY).json()['confirmed']
        return group['orders'], group['amount_untaxed'], group['amount_total']

    def test_a_down_payment_leaves_every_figure_of_the_reports_alone(self):
        order = self.confirmed(lines=[self.line(quantity=2, discount=10)])
        self.env.flush_all()
        before = self.confirmed_figures()
        self.assertEqual(before[0], 1)
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})
        self.invoice_order(self.biller, order, {'method': 'amount', 'amount': 20.0})
        self.env.flush_all()
        stock = self.env['sale.order'].browse(order.id).order_line
        self.assertTrue(stock.filtered('is_downpayment'), 'stock added its down payment lines')
        self.assertEqual(self.confirmed_figures(), before)

    def test_the_product_breakdown_and_the_export_show_what_was_sold_only(self):
        order = self.confirmed(lines=[self.line(quantity=2)])
        self.invoice_order(self.biller, order, {'method': 'percent', 'percent': 30})
        self.env.flush_all()
        products = self.report(f'{BREAKDOWN}?by=product').json()
        self.assertEqual([(item['label'], item['quantity']) for item in products['items']], [(self.item.name, 2.0)])
        self.assertNotIn(None, [item['key'] for item in products['items']])
        lines = self.report(EXPORT).content.decode('utf-8-sig').strip().splitlines()
        self.assertEqual(len(lines) - 1, 1, lines)
