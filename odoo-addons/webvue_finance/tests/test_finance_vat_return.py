# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PASSWORD, WebVueFinanceWriteCase

RETURN = '/api/v1/finance/reports/vat-return'
OCTOBER = 'date_from=2026-10-01&date_to=2026-10-31'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceVatReturn(WebVueFinanceWriteCase):
    """The fixture posts a 1000 SAR sale at 15% VAT on 2026-10-18 in each company; this adds a purchase and a credit note."""

    def box(self, report, code):
        return next(box for box in report['boxes'] if box['code'] == code)

    def get(self, query=OCTOBER):
        result = self.api('GET', f'{RETURN}?{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_sales_fill_the_standard_rated_box_and_the_totals(self):
        report = self.get()
        self.assertEqual((report['status'], report['filed']), ('draft_for_review', False))
        self.assertEqual([box['number'] for box in report['boxes']], list(range(1, 17)))
        standard = self.box(report, 'sa_1')
        self.assertEqual((standard['base'], standard['tax']), (1000, 150))
        self.assertEqual((self.box(report, 'sa_6')['base'], self.box(report, 'sa_6')['tax']), (1000, 150))
        self.assertEqual(self.box(report, 'sa_13')['tax'], 150)
        self.assertEqual(self.box(report, 'sa_16')['tax'], 150)
        self.assertIsNone(self.box(report, 'sa_13')['base'])

    def test_a_purchase_is_deducted_and_a_credit_note_reduces_sales(self):
        bill = self.posted_invoice(self.bill_body())
        self.assertEqual(bill['amount_total'], 1150)
        note = self.posted_invoice(self.invoice_body(move_type='out_refund', lines=[
            {'name': 'Return', 'quantity': 1, 'price_unit': 200, 'tax_ids': [self.sale_vat.id]},
        ]))
        self.assertEqual(note['state'], 'posted')
        report = self.get()
        self.assertEqual((self.box(report, 'sa_7')['base'], self.box(report, 'sa_7')['tax']), (1000, 150))
        self.assertEqual((self.box(report, 'sa_1')['base'], self.box(report, 'sa_1')['tax']), (800, 120))
        self.assertEqual(self.box(report, 'sa_12')['tax'], 150)
        self.assertEqual(self.box(report, 'sa_13')['tax'], -30)
        self.assertEqual(self.box(report, 'sa_16')['tax'], -30)

    def test_a_zero_rated_sale_goes_to_box_3_and_other_periods_and_companies_are_apart(self):
        zero = self.env['account.tax'].search([
            ('company_id', '=', self.company.id), ('type_tax_use', '=', 'sale'), ('amount', '=', 0),
            ('amount_type', '=', 'percent'), ('active', '=', True),
        ], limit=1)
        if zero:
            self.posted_invoice(self.invoice_body(lines=[{'name': 'Export', 'quantity': 1, 'price_unit': 500, 'tax_ids': [zero.id]}]))
            report = self.get()
            boxes = [self.box(report, code)['base'] for code in ('sa_3', 'sa_4', 'sa_5')]
            self.assertEqual(sum(boxes), 500)
        november = self.get('date_from=2026-11-01&date_to=2026-11-30')
        self.assertEqual([box['base'] or 0 for box in november['boxes']] + [box['tax'] or 0 for box in november['boxes']], [0] * 32)

    def test_the_items_behind_a_box_open_down_to_the_documents(self):
        listing = self.api('GET', f'{RETURN}/items?code=sa_1&column=tax&{OCTOBER}')
        self.assertEqual(listing.status_code, 200, listing.text)
        body = listing.json()
        self.assertEqual(body['total'], 1)
        item = body['items'][0]
        self.assertEqual((item['amount'], item['entry_type'], item['entry']['id']), (150, 'out_invoice', self.invoice.id))
        base = self.api('GET', f'{RETURN}/items?code=sa_1&column=base&{OCTOBER}').json()
        self.assertEqual(sum(row['amount'] for row in base['items']), 1000)
        self.assertEqual(self.api('GET', f'{RETURN}/items?code=sa_6&column=base&{OCTOBER}').json(), {'items': [], 'total': 0})

    def test_the_total_of_the_items_equals_the_box(self):
        self.posted_invoice(self.bill_body())
        report = self.get()
        for code, column in (('sa_1', 'base'), ('sa_1', 'tax'), ('sa_7', 'base'), ('sa_7', 'tax')):
            items = self.api('GET', f'{RETURN}/items?code={code}&column={column}&{OCTOBER}').json()['items']
            self.assertAlmostEqual(sum(row['amount'] for row in items), self.box(report, code)[column], places=2)

    def test_bad_queries_and_capability(self):
        for query, field in (
            ('', 'date_from'), ('date_from=2026-10-01', 'date_to'),
            (f'code=sa_99&column=base&{OCTOBER}', 'code'), (f'code=sa_1&column=vat&{OCTOBER}', 'column'),
            (f'column=base&{OCTOBER}', 'code'), (f'code=sa_1&{OCTOBER}', 'column'),
        ):
            with self.subTest(query=query):
                route = f'{RETURN}/items' if 'code' in query or 'column' in query else RETURN
                self.assertRefused(self.api('GET', f'{route}?{query}'), 422, 'invalid', field)
        self.user_with('no_reports', ['finance.invoices.read'])
        self.authenticate('no_reports', PASSWORD)
        self.assertRefused(self.api('GET', f'{RETURN}?{OCTOBER}'), 403, 'forbidden')
        self.assertRefused(self.api('GET', f'{RETURN}/items?code=sa_1&column=base&{OCTOBER}'), 403, 'forbidden')
