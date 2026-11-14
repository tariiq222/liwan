# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""D5 purchase side: a chart's purchase taxes say "tax added" unless the accountant set an override."""
from odoo.tests import tagged

from odoo.addons.liwan_api_account.tests.common import CompanyTaxCase

# The stock Saudi chart ships this customs tax with an explicit `tax_included`; an override is never touched.
STOCK_OVERRIDDEN_PURCHASE_TAX = '15% EX ONLY'


@tagged('post_install', '-at_install', 'liwan')
class TestCompanyTaxPurchase(CompanyTaxCase):

    def chart_purchase_taxes(self, company):
        return self.env['account.tax'].with_context(active_test=False).search([
            ('company_id', '=', company.id), ('type_tax_use', '=', 'purchase'),
            ('name', '!=', STOCK_OVERRIDDEN_PURCHASE_TAX),
        ])

    def test_a_purchase_tax_without_override_is_added_after_the_chart_loads(self):
        company = self.saudi_root('Chart purchase company')
        purchase = self.chart_purchase_taxes(company)
        self.assertTrue(purchase, 'the chart ships purchase taxes')
        self.assertEqual(set(purchase.mapped('price_include_override')), {'tax_excluded'})

    def test_a_stock_written_override_survives_the_chart_hook(self):
        company = self.saudi_root('Chart override company')
        if company.chart_template == 'generic_coa':
            purchase = self.chart_purchase_taxes(company)[:1]
            self.assertTrue(purchase)
            purchase.price_include_override = 'tax_included'
            self.env['account.chart.template'].try_loading(company.chart_template, company)
            self.assertEqual(purchase.price_include_override, 'tax_included')
            return

        # The Saudi chart's CSV sets an explicit override on the customs VAT tax.
        customs = self.env['account.tax'].search([
            ('company_id', '=', company.id), ('type_tax_use', '=', 'purchase'),
            ('name', '=', STOCK_OVERRIDDEN_PURCHASE_TAX),
        ], limit=1)
        self.assertTrue(customs, 'the sa chart imports its customs purchase tax')
        self.assertEqual(customs.price_include_override, 'tax_included')

    def test_a_sale_tax_and_an_overridden_purchase_tax_are_untouched(self):
        company = self.saudi_root('Chart sale company')
        sale = self.env['account.tax'].search([
            ('company_id', '=', company.id), ('type_tax_use', '=', 'sale'),
        ])
        self.assertTrue(sale)
        self.assertFalse(any(sale.mapped('price_include_override')))
        purchase = self.chart_purchase_taxes(company)[:1]
        purchase.price_include_override = 'tax_included'
        self.env['account.tax']._liwan_default_purchase_taxes_to_added(company)
        self.assertEqual(purchase.price_include_override, 'tax_included')
