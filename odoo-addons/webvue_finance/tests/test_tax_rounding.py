# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import WebVueFinanceCase


@tagged('post_install', '-at_install', 'webvue')
class TestTaxRounding(WebVueFinanceCase):
    def test_saudi_company_requires_global_tax_rounding(self):
        with self.assertRaisesRegex(ValidationError, 'Saudi companies must calculate taxes globally'):
            self.company.write({'tax_calculation_rounding_method': 'round_per_line'})

        self.company.write({'tax_calculation_rounding_method': 'round_globally'})
        self.assertEqual(self.company.tax_calculation_rounding_method, 'round_globally')

    def test_non_saudi_company_can_choose_either_tax_rounding_method(self):
        company = self.env['res.company'].create({
            'name': 'Finance US Company',
            'country_id': self.env.ref('base.us').id,
            'currency_id': self.env.ref('base.USD').id,
        })
        for method in ('round_per_line', 'round_globally'):
            with self.subTest(method=method):
                company.write({'tax_calculation_rounding_method': method})
                self.assertEqual(company.tax_calculation_rounding_method, method)

    def test_invoice_tax_is_rounded_after_summing_taxable_lines(self):
        vat = self.env['account.tax'].search([
            ('company_id', '=', self.company.id), ('type_tax_use', '=', 'sale'),
            ('amount_type', '=', 'percent'), ('amount', '=', 15),
        ], limit=1)
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice',
            'partner_id': self.partner.id,
            'invoice_date': '2026-10-18',
            'invoice_date_due': '2026-10-18',
            'invoice_line_ids': [
                Command.create({'name': 'Line 1', 'quantity': 1, 'price_unit': 1.10, 'tax_ids': [Command.set(vat.ids)]}),
                Command.create({'name': 'Line 2', 'quantity': 1, 'price_unit': 2.10, 'tax_ids': [Command.set(vat.ids)]}),
            ],
        })
        invoice.action_post()

        tax_line = invoice.line_ids.filtered(lambda line: line.tax_line_id == vat)
        self.assertEqual(len(tax_line), 1)
        self.assertEqual(tax_line.balance, -0.48)
        self.assertEqual(invoice.amount_tax, 0.48)
        self.assertEqual(invoice.amount_total, 3.68)

    def test_invoice_tax_uses_two_decimal_half_up_rounding(self):
        vat = self.env['account.tax'].create({
            'name': 'Ten percent VAT', 'company_id': self.company.id,
            'type_tax_use': 'sale', 'amount_type': 'percent', 'amount': 10,
        })
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice',
            'partner_id': self.partner.id,
            'invoice_date': '2026-10-18',
            'invoice_date_due': '2026-10-18',
            'invoice_line_ids': [Command.create({
                'name': 'Half-up tie', 'quantity': 1, 'price_unit': 0.05,
                'tax_ids': [Command.set(vat.ids)],
            })],
        })
        invoice.action_post()

        tax_line = invoice.line_ids.filtered(lambda line: line.tax_line_id == vat)
        self.assertEqual(len(tax_line), 1)
        self.assertEqual(
            (tax_line.balance, tax_line.tax_base_amount, invoice.amount_tax),
            (-0.01, -0.05, 0.01),
            f"tax_line={tax_line.balance!r}, tax_base={tax_line.tax_base_amount!r}, "
            f"amount_tax={invoice.amount_tax!r}, currency_round={self.company.currency_id.round(0.005)!r}",
        )
