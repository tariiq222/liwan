# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import LiwanOrdersCase

NO_TAX = 0.0
DISCOUNT = 0.1


@tagged('post_install', '-at_install', 'liwan')
class TestOrderCopyTax(LiwanOrdersCase):
    """A copied line of an unregistered establishment carries no tax; a registered one gets stock's copy, taxes included."""

    def test_a_copy_after_a_deregistration_carries_no_tax_and_the_original_keeps_its_tax(self):
        company = self.company('Deregisters then copies', registered=True)
        tax = self.tax(company)
        order = self.order(company, [self.product(tax)])
        self.register(company, False)
        copy = order.with_company(company).copy()
        self.assertEqual((copy.order_line.tax_ids, copy.amount_tax), (self.env['account.tax'], NO_TAX))
        self.assertEqual((order.order_line.tax_ids, order.amount_tax > NO_TAX), (tax, True))

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

    def discounted_order(self, company, registered):
        """An order of ``company`` with a stock global discount of 10% (the discount line copies the order's taxes)."""
        order = self.order(company, [self.product(self.tax(company))])
        wizard = self.env['sale.order.discount'].with_context(active_id=order.id).create({
            'discount_type': 'so_discount', 'discount_percentage': DISCOUNT,
        })
        wizard.action_apply_discount()
        self.assertEqual(len(order.order_line), 2)
        self.assertEqual(bool(order.order_line.tax_ids), registered)
        return order

    def test_a_hand_set_tax_survives_a_copy_in_a_registered_establishment(self):
        company = self.company('Hand set tax', registered=True)
        order = self.order(company, [self.product(self.tax(company))])
        other = self.tax(company, name='VAT 15% other')
        order.order_line.tax_ids = other
        copy = order.with_company(company).copy()
        self.assertEqual(copy.order_line.tax_ids, other)

    def test_a_global_discount_line_is_copied_as_stock_copies_it_in_a_registered_establishment(self):
        company = self.company('Registered discount', registered=True)
        order = self.discounted_order(company, registered=True)
        copy = order.with_company(company).copy()
        self.assertEqual(copy.order_line.mapped('tax_ids'), order.order_line.mapped('tax_ids'))
        self.assertEqual(copy.order_line.filtered(lambda line: line.price_unit < 0).tax_ids,
                         order.order_line.filtered(lambda line: line.price_unit < 0).tax_ids)
        self.assertEqual((copy.amount_untaxed, copy.amount_tax, copy.amount_total),
                         (order.amount_untaxed, order.amount_tax, order.amount_total))

    def test_every_line_of_a_discounted_order_of_an_unregistered_establishment_is_copied_untaxed(self):
        company = self.company('Unregistered discount')
        order = self.discounted_order(company, registered=False)
        copy = order.with_company(company).copy()
        self.assertEqual(len(copy.order_line), 2)
        self.assertEqual((copy.order_line.tax_ids, copy.amount_tax), (self.env['account.tax'], NO_TAX))

    def test_a_discounted_order_copied_after_a_deregistration_carries_no_tax_on_any_line(self):
        company = self.company('Deregisters discount', registered=True)
        order = self.discounted_order(company, registered=True)
        self.register(company, False)
        copy = order.with_company(company).copy()
        self.assertEqual(len(copy.order_line), 2)
        self.assertEqual((copy.order_line.tax_ids, copy.amount_tax), (self.env['account.tax'], NO_TAX))
