# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The stock entry points the bridge calls, pinned so that a stock rename fails here and not in a customer's invoice."""
import inspect

from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestStockEntryPoints(TransactionCase):

    def test_the_advance_payment_wizard_still_makes_invoices_the_way_the_bridge_calls_it(self):
        wizard = self.env['sale.advance.payment.inv']
        for name in ('_create_invoices', '_check_amount_is_positive'):
            self.assertTrue(callable(getattr(wizard, name, None)), name)
        self.assertEqual(list(inspect.signature(type(wizard)._create_invoices).parameters)[1:], ['sale_orders'])
        for name in ('advance_payment_method', 'amount', 'fixed_amount', 'deduct_down_payments', 'consolidated_billing', 'sale_order_ids'):
            self.assertIn(name, wizard._fields, name)
        methods = dict(wizard._fields['advance_payment_method'].selection)
        self.assertTrue({'delivered', 'percentage', 'fixed'} <= set(methods), methods)

    def test_the_order_still_exposes_its_invoice_hooks(self):
        order = self.env['sale.order']
        for name in ('_create_invoices', '_prepare_invoice', '_get_invoiceable_lines', '_action_cancel'):
            self.assertTrue(callable(getattr(order, name, None)), name)
        self.assertEqual(list(inspect.signature(type(order)._create_invoices).parameters)[1:], ['grouped', 'final', 'date'])
        for name in ('invoice_ids', 'invoice_status', 'amount_total', 'currency_id'):
            self.assertIn(name, order._fields, name)
        self.assertTrue(callable(getattr(self.env['sale.order.line'], '_prepare_invoice_line', None)))
        self.assertIn('is_downpayment', self.env['account.move.line']._fields)
        self.assertIn('sale_line_ids', self.env['account.move.line']._fields)
        self.assertIn('reversed_entry_id', self.env['account.move']._fields)

    def test_the_hooks_of_the_two_sides_exist(self):
        self.assertTrue(callable(getattr(self.env['sale.order'], '_liwan_staff_extras', None)))
        self.assertTrue(callable(getattr(self.env['sale.order'], '_liwan_actions', None)))
        self.assertTrue(callable(getattr(self.env['liwan.sales.settings'], '_liwan_patch_parsers', None)))
        self.assertTrue(callable(getattr(self.env['account.move'], '_liwan_detail_extras', None)))
