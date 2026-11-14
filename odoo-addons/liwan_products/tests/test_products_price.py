# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The price function of plan D6 without the tax bridge, and the products stock modules make."""
from odoo.tests import tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_products.models.products_service import LiwanProductsService
from odoo.addons.liwan_products.tests.common import ProductsCase


@tagged('post_install', '-at_install', 'liwan')
class TestProductsPrice(ProductsCase):

    def setUp(self):
        super().setUp()
        service = self.env['liwan.products.service'].with_user(self.root_staff).with_company(self.root_company)
        self.product = service._liwan_create({'name': 'Priced', 'type': 'service', 'list_price': 115})
        self.service = service

    def test_the_unit_price_is_the_empty_pricelist_price_and_the_list_price(self):
        variant = self.product.product_variant_id
        empty = self.env['product.pricelist'].with_company(self.root_company)
        for quantity in (1.0, 3.0):
            with self.subTest(quantity=quantity):
                expected = empty._get_product_price(variant, quantity, currency=self.root_company.currency_id)
                self.assertEqual(expected, self.product.list_price)
                price = self.service._liwan_price(self.product, quantity=quantity)
                self.assertEqual(price['unit_price'], expected)
                self.assertEqual(price['currency'], self.root_company.currency_id)
                self.assertEqual(self.service._liwan_price(variant, quantity=quantity)['unit_price'], expected)

    def test_the_base_amounts_carry_no_tax(self):
        variant = self.product.product_variant_id
        for quantity, amount in ((1.0, 115.0), (3.0, 345.0)):
            with self.subTest(quantity=quantity):
                untaxed, tax, total = LiwanProductsService._liwan_price_amounts(
                    self.service, variant, 115.0, quantity, self.root_company, None,
                )
                self.assertEqual((untaxed, tax, total), (amount, 0.0, amount))

    def test_the_price_needs_a_pick_holder(self):
        nobody = self.env['liwan.products.service'].with_user(self.nobody).with_company(self.branch_a)
        with self.assertRaisesRegex(LiwanAccessRule, 'forbidden'):
            nobody._liwan_price(self.product)
        picker = self.env['liwan.products.service'].with_user(self.picker).with_company(self.branch_a)
        self.assertEqual(picker._liwan_price(self.product)['unit_price'], 115)

    def test_stock_products_stay_out_of_the_list_and_the_pick_list(self):
        stock = self.env['product.template'].create({'name': 'Priced stock product', 'type': 'service'})
        outside = self.env['product.template'].with_context(active_test=False).search([('liwan_product', '=', False)])
        self.assertIn(stock, outside)
        self.sign_in('pr_root_staff')
        listed = set(self.listed_ids()) | set(self.picked_ids())
        self.assertIn(self.product.id, listed)
        self.assertFalse(listed & set(outside.ids))

    def test_the_price_refuses_a_foreign_company_and_a_bad_quantity(self):
        picker = self.env['liwan.products.service'].with_user(self.picker).with_context(
            allowed_company_ids=self.branch_a.ids,
        )
        with self.assertRaisesRegex(LiwanAccessRule, 'forbidden'):
            picker._liwan_price(self.product, company=self.branch_b)
        for quantity in (0, -1, True, '2'):
            with self.subTest(quantity=quantity), self.assertRaisesRegex(LiwanAccessRule, 'invalid'):
                picker._liwan_price(self.product, quantity=quantity)
        elevated = self.env['liwan.products.service'].sudo()
        self.assertEqual(elevated._liwan_price(self.product, company=self.branch_b)['unit_price'], 115)

    def test_pick_product_returns_an_active_product_to_a_pick_holder(self):
        picker = self.env['liwan.products.service'].with_user(self.picker).with_company(self.branch_a)
        self.assertEqual(picker._liwan_pick_product(self.product.id), self.product)
        self.service._liwan_archive(self.product)
        with self.assertRaisesRegex(LiwanAccessRule, 'not_found'):
            picker._liwan_pick_product(self.product.id)
        nobody = self.env['liwan.products.service'].with_user(self.nobody).with_company(self.branch_a)
        with self.assertRaisesRegex(LiwanAccessRule, 'forbidden'):
            nobody._liwan_pick_product(self.product.id)
