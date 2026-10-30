# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestTenantAccountingBaseline(TransactionCase):
    """The root company a fresh tenant is installed with: Saudi chart, VAT, currency and rounding, with no setup step.

    The database under test is installed in one run, like a provisioned tenant, so this is the install order's proof:
    ``liwan_platform`` makes the root company Saudi before ``product``, ``account`` and ``l10n_sa`` install.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.ref('liwan_platform.tenant_profile').root_company_id
        cls.sar = cls.env.ref('base.SAR')

    def test_the_root_company_has_the_saudi_chart_and_global_rounding(self):
        company = self.company
        self.assertEqual(company.chart_template, 'sa')
        self.assertEqual((company.country_id.code, company.account_fiscal_country_id.code), ('SA', 'SA'))
        self.assertEqual(company.currency_id, self.sar)
        self.assertEqual(company.tax_calculation_rounding_method, 'round_globally')

    def test_the_default_sale_and_purchase_taxes_are_vat_15(self):
        for tax in (self.company.account_sale_tax_id, self.company.account_purchase_tax_id):
            with self.subTest(tax=tax.type_tax_use):
                self.assertEqual((tax.amount_type, tax.amount, tax.company_id), ('percent', 15, self.company))

    def test_the_default_pricelist_stock_creates_is_in_saudi_riyal(self):
        # Stock creates a company's default pricelist when pricelists are turned on, in the company currency.
        self.env.user.group_ids = [Command.link(self.env.ref('product.group_product_pricelist').id)]
        self.company._activate_or_create_pricelists()
        Pricelist = self.env['product.pricelist'].with_context(active_test=False)
        pricelists = Pricelist.search([('company_id', '=', self.company.id)])
        self.assertTrue(pricelists)
        self.assertEqual(pricelists.currency_id, self.sar)
        self.assertEqual(Pricelist.with_company(self.company).create({'name': 'Walk-in'}).currency_id, self.sar)
