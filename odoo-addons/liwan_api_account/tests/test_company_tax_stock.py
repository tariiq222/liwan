# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Stock behaviour the plan relies on: a tax follows the price mode of the company that OWNS it."""
from odoo.tests import tagged

from odoo.addons.liwan_api_account.tests.common import CompanyTaxCase


@tagged('post_install', '-at_install', 'liwan')
class TestCompanyTaxStock(CompanyTaxCase):

    def test_a_root_owned_sale_tax_is_included_when_the_root_says_included(self):
        root, _branch = self.establishment_with_mode('tax_included')
        tax = self.sale_tax(root)
        self.assertEqual(self.line_totals(root, tax, 115, 1), (115.0, 100.0))
        self.assertEqual(self.line_totals(root, tax, 115, 3), (345.0, 300.0))

    def test_a_root_owned_sale_tax_is_added_when_the_root_says_added(self):
        root, _branch = self.establishment_with_mode('tax_excluded')
        tax = self.sale_tax(root)
        self.assertEqual(self.line_totals(root, tax, 115, 1), (132.25, 115.0))
        self.assertEqual(self.line_totals(root, tax, 115, 3), (396.75, 345.0))

    def test_a_branch_owned_sale_tax_is_included_when_the_branch_says_included(self):
        _root, branch = self.establishment_with_mode('tax_included', branch=True)
        tax = self.sale_tax(branch)
        self.assertEqual(tax.company_id, branch)
        self.assertTrue(tax.price_include)
        self.assertEqual(self.line_totals(branch, tax, 115, 1), (115.0, 100.0))
        self.assertEqual(self.line_totals(branch, tax, 115, 3), (345.0, 300.0))

    def test_a_branch_owned_sale_tax_is_added_when_the_branch_says_added(self):
        _root, branch = self.establishment_with_mode('tax_excluded', branch=True)
        tax = self.sale_tax(branch)
        self.assertEqual(tax.company_id, branch)
        self.assertFalse(tax.price_include)
        self.assertEqual(self.line_totals(branch, tax, 115, 1), (132.25, 115.0))
        self.assertEqual(self.line_totals(branch, tax, 115, 3), (396.75, 345.0))

    def test_a_branch_owned_tax_follows_the_establishment_single_mode(self):
        """The mode is root-delegated: a branch carries its root's value, and its own tax uses it."""
        root, branch = self.establishment_with_mode('tax_excluded', branch=True)
        self.assertEqual(branch.account_price_include, root.account_price_include)
        tax = self.sale_tax(branch)
        self.assertEqual(self.line_totals(branch, tax, 115, 1), (132.25, 115.0))

    def test_a_vendor_bill_line_is_one_hundred_fifteen_before_tax_under_both_modes(self):
        for mode in ('tax_included', 'tax_excluded'):
            with self.subTest(mode=mode):
                root, _branch = self.establishment_with_mode(mode)
                tax = self.purchase_tax(root)
                tax.price_include_override = 'tax_excluded'
                total, subtotal = self.line_totals(root, tax, 115, move_type='in_invoice')
                self.assertEqual(subtotal, 115.0)
                self.assertEqual(total, 132.25)
