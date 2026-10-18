# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, WebVueFinanceCase

REPORT = '/api/v1/finance/reports/vat'
PERIOD = '?date_from=2026-10-01&date_to=2026-10-31'
SECTION_KEYS = {'taxes', 'base', 'tax_amount'}
ROW_KEYS = {'tax', 'rate', 'base', 'tax_amount'}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceVatReport(WebVueFinanceCase):
    """The fixture posts a 1000 SAR sale at 15% VAT in each company; this adds a 400 SAR purchase."""

    @classmethod
    def _purchase_bill(cls, company, amount, state='posted'):
        vat = cls.env['account.tax'].search([
            ('company_id', '=', company.id), ('type_tax_use', '=', 'purchase'),
            ('amount_type', '=', 'percent'), ('amount', '=', 15),
        ], limit=1)
        bill = cls.env['account.move'].with_company(company).create({
            'move_type': 'in_invoice',
            'partner_id': cls.partner.id,
            'invoice_date': '2026-10-20',
            'date': '2026-10-20',
            'invoice_line_ids': [Command.create({
                'name': 'Office supplies', 'quantity': 1, 'price_unit': amount, 'tax_ids': [Command.set(vat.ids)],
            })],
        })
        if state == 'posted':
            bill.action_post()
        return bill

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.bill = cls._purchase_bill(cls.company, 400)

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _report(self, query=PERIOD):
        result = self.api('GET', REPORT + query)
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_the_summary_nets_output_vat_against_input_vat(self):
        body = self._report()
        self.assertEqual(set(body), {'date_from', 'date_to', 'currency', 'sales', 'purchases', 'net_payable'})
        self.assertEqual((body['date_from'], body['date_to'], body['currency']), ('2026-10-01', '2026-10-31', 'SAR'))
        for section in ('sales', 'purchases'):
            self.assertEqual(set(body[section]), SECTION_KEYS)
        sales, purchases = body['sales'], body['purchases']
        self.assertEqual((sales['base'], sales['tax_amount']), (1000, 150))
        self.assertEqual((purchases['base'], purchases['tax_amount']), (400, 60))
        self.assertEqual(body['net_payable'], 90)

    def test_each_row_names_its_tax_and_rate(self):
        sales_row = self._report()['sales']['taxes'][0]
        self.assertEqual(set(sales_row), ROW_KEYS)
        self.assertEqual((sales_row['rate'], sales_row['base'], sales_row['tax_amount']), (15, 1000, 150))
        self.assertEqual(sales_row['tax']['id'], self.env['account.tax'].search([
            ('company_id', '=', self.company.id), ('type_tax_use', '=', 'sale'),
            ('amount_type', '=', 'percent'), ('amount', '=', 15),
        ], limit=1).id)
        self.assertEqual(len(self._report()['purchases']['taxes']), 1)

    def test_a_period_without_entries_is_all_zero(self):
        body = self._report('?date_from=2026-01-01&date_to=2026-01-31')
        self.assertEqual((body['sales']['taxes'], body['purchases']['taxes']), ([], []))
        self.assertEqual((body['sales']['base'], body['net_payable']), (0, 0))

    def test_only_posted_entries_of_the_current_company_count(self):
        self._purchase_bill(self.company, 1000, state='draft')
        self._purchase_bill(self.other_company, 5000)
        body = self._report()
        self.assertEqual((body['purchases']['base'], body['purchases']['tax_amount'], body['net_payable']), (400, 60, 90))
        self.assertEqual(body['sales']['base'], 1000)

    def test_a_credit_note_reduces_the_period(self):
        self.invoice.with_company(self.company)._reverse_moves(
            [{'date': '2026-10-18', 'invoice_date': '2026-10-18'}], cancel=True,
        )
        body = self._report()
        self.assertEqual((body['sales']['base'], body['sales']['tax_amount']), (0, 0))
        self.assertEqual(body['net_payable'], -60)

    def test_the_period_is_required_and_valid(self):
        for query in (
            '', '?date_from=2026-10-01', '?date_to=2026-10-31', '?date_from=x&date_to=2026-10-31',
            '?date_from=2026-11-01&date_to=2026-10-01',
        ):
            with self.subTest(query=query):
                result = self.api('GET', REPORT + query)
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))
