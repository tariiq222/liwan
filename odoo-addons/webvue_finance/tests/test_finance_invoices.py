# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, WebVueFinanceCase

INVOICES = '/api/v1/finance/invoices'
INVOICE_KEYS = {
    'id', 'name', 'move_type', 'state', 'payment_state', 'partner', 'journal', 'invoice_date',
    'invoice_date_due', 'currency', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual',
}
LINE_KEYS = {
    'id', 'name', 'account', 'quantity', 'price_unit', 'discount', 'taxes', 'price_subtotal', 'price_total',
}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceInvoices(WebVueFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.bill = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'in_invoice',
            'partner_id': cls.env['res.partner'].create({'name': 'Gulf Supplies'}).id,
            'invoice_date': '2026-09-01',
            'invoice_line_ids': [(0, 0, {'name': 'Paper', 'quantity': 2, 'price_unit': 50})],
        })

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _ids(self, query=''):
        result = self.api('GET', f'{INVOICES}{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return {row['id'] for row in result.json()['items']}

    def test_a_1000_sar_invoice_with_15_percent_vat_serializes_untaxed_tax_and_total(self):
        body = self.api('GET', INVOICES).json()
        item = next(row for row in body['items'] if row['id'] == self.invoice.id)
        self.assertEqual(set(item), INVOICE_KEYS)
        self.assertEqual(
            (item['currency'], item['amount_untaxed'], item['amount_tax'], item['amount_total']),
            ('SAR', 1000, 150, 1150),
        )
        self.assertEqual((item['state'], item['move_type']), ('posted', 'out_invoice'))
        self.assertEqual(item['partner'], {'id': self.partner.id, 'name': 'Al Noor Trading'})

    def test_the_list_is_an_items_total_envelope_of_the_current_company_only(self):
        body = self.api('GET', INVOICES).json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual(body['total'], len(body['items']))
        self.assertIn(self.invoice.id, self._ids())
        self.assertIn(self.bill.id, self._ids())
        self.assertNotIn(self.other_invoice.id, self._ids())

    def test_the_detail_carries_the_lines_with_their_taxes(self):
        body = self.api('GET', f'{INVOICES}/{self.invoice.id}').json()
        self.assertEqual(set(body), INVOICE_KEYS | {'ref', 'lines'})
        (line,) = body['lines']
        self.assertEqual(set(line), LINE_KEYS)
        self.assertEqual((line['price_subtotal'], line['price_total']), (1000, 1150))
        self.assertEqual(len(line['taxes']), 1)

    def test_a_foreign_company_invoice_is_a_404_not_found(self):
        result = self.api('GET', f'{INVOICES}/{self.other_invoice.id}')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))

    def test_an_unknown_invoice_is_a_404_not_found(self):
        result = self.api('GET', f'{INVOICES}/999999999')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))

    def test_a_journal_entry_is_not_an_invoice(self):
        entry = self.env['account.move'].with_company(self.company).create({'move_type': 'entry'})
        self.assertNotIn(entry.id, self._ids())
        self.assertEqual(self.api('GET', f'{INVOICES}/{entry.id}').status_code, 404)

    def test_filters_by_move_type_state_and_partner(self):
        self.assertEqual(self._ids('?move_type=in_invoice'), {self.bill.id})
        self.assertEqual(self._ids('?move_type=out_invoice'), {self.invoice.id})
        self.assertEqual(self._ids('?state=draft'), {self.bill.id})
        self.assertEqual(self._ids('?state=posted'), {self.invoice.id})
        self.assertEqual(self._ids(f'?partner_id={self.partner.id}'), {self.invoice.id})

    def test_filters_by_date_range_and_text(self):
        self.assertEqual(self._ids('?date_from=2026-10-01&date_to=2026-10-31'), {self.invoice.id})
        self.assertEqual(self._ids('?date_to=2026-09-30'), {self.bill.id})
        self.assertEqual(self._ids('?q=gulf'), {self.bill.id})
        self.assertEqual(self._ids(f'?q={self.invoice.name}'), {self.invoice.id})

    def test_pages_with_limit_and_offset_and_keeps_the_total(self):
        body = self.api('GET', f'{INVOICES}?limit=1&offset=1').json()
        self.assertEqual(len(body['items']), 1)
        self.assertEqual(body['total'], 2)

    def test_bad_filters_are_a_422_invalid(self):
        for query in (
            '?move_type=entry', '?state=open', '?partner_id=abc', '?date_from=18-10-2026',
            '?date_from=2026-10-31&date_to=2026-10-01', '?limit=-1', '?offset=x',
        ):
            with self.subTest(query=query):
                result = self.api('GET', f'{INVOICES}{query}')
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))
