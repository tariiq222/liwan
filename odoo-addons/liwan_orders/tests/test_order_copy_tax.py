# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import PRICE, LiwanOrdersCase

NO_TAX = 0.0
HALF = 50.0


@tagged('post_install', '-at_install', 'liwan')
class TestOrderCopyTax(LiwanOrdersCase):
    """A copied order line is a new line: it takes the establishment's answer at the time of the copy."""

    def test_a_copy_after_a_deregistration_carries_no_tax_and_the_original_keeps_its_tax(self):
        company = self.company('Deregisters then copies', registered=True)
        tax = self.tax(company)
        order = self.order(company, [self.product(tax)])
        self.register(company, False)
        copy = order.with_company(company).copy()
        self.assertEqual((copy.order_line.tax_ids, copy.amount_tax), (self.env['account.tax'], NO_TAX))
        self.assertEqual((order.order_line.tax_ids, order.amount_tax > NO_TAX), (tax, True))

    def test_a_copy_after_a_registration_carries_the_stock_tax_and_the_original_stays_untaxed(self):
        company = self.company('Registers then copies')
        tax = self.tax(company)
        order = self.order(company, [self.product(tax)])
        self.register(company, True)
        copy = order.with_company(company).copy()
        self.assertEqual(copy.order_line.tax_ids, tax)
        self.assertEqual((order.order_line.tax_ids, order.amount_tax), (self.env['account.tax'], NO_TAX))

    def test_a_line_copied_inside_its_order_after_a_deregistration_carries_no_tax(self):
        company = self.company('Deregisters then copies a line', registered=True)
        order = self.order(company, [self.product(self.tax(company))])
        self.register(company, False)
        copy = order.order_line.with_company(company).copy({'order_id': order.id})
        self.assertEqual(copy.tax_ids, self.env['account.tax'])

    def test_a_copy_without_a_change_is_taxed_as_the_original(self):
        company = self.company('Registered copies', registered=True)
        order = self.order(company, [self.product(self.tax(company))])
        copy = order.with_company(company).copy()
        self.assertEqual(copy.order_line.tax_ids, order.order_line.tax_ids)
        self.assertEqual((copy.amount_tax, copy.amount_total), (order.amount_tax, order.amount_total))

    def test_an_explicit_tax_in_the_copy_defaults_is_kept(self):
        company = self.company('Explicit tax', registered=True)
        order = self.order(company, [self.product(self.tax(company))])
        other = self.tax(company, name='VAT 15% other')
        copy = order.order_line.with_company(company).copy({
            'order_id': order.id, 'tax_ids': [Command.set(other.ids)],
        })
        self.assertEqual(copy.tax_ids, other)

    def test_the_down_payment_of_an_unregistered_order_carries_no_tax(self):
        company = self.env.company
        self.register(company, False)
        order = self.order(company, [self.product(self.tax(company))])
        order.action_confirm()
        wizard = self.env['sale.advance.payment.inv'].with_context(active_ids=order.ids).create({
            'advance_payment_method': 'percentage', 'amount': HALF,
        })
        wizard.create_invoices()
        down_payment = order.order_line.filtered(lambda line: line.is_downpayment and not line.display_type)
        invoice = order.invoice_ids
        self.assertEqual((down_payment.tax_ids, invoice.amount_tax), (self.env['account.tax'], NO_TAX))
        self.assertEqual(invoice.amount_total, PRICE * HALF / 100)
