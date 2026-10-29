# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo import fields
from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, WebVueFinanceCase

INVOICES = '/api/v1/finance/invoices'
INVOICE_KEYS = {
    'id', 'name', 'move_type', 'state', 'payment_state', 'partner', 'journal', 'invoice_date',
    'invoice_date_due', 'currency', 'amount_untaxed', 'amount_tax', 'amount_total', 'amount_residual',
}
LINE_KEYS = {
    'id', 'name', 'account', 'quantity', 'price_unit', 'discount', 'taxes', 'price_subtotal', 'price_total',
    'analytic_distribution',
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

    def test_a_draft_invoice_has_a_null_name_until_it_is_posted(self):
        by_id = {row['id']: row for row in self.api('GET', INVOICES).json()['items']}
        self.assertIsNone(by_id[self.bill.id]['name'])
        self.assertTrue(by_id[self.invoice.id]['name'])

    def test_the_list_is_an_items_total_envelope_of_the_current_company_only(self):
        body = self.api('GET', INVOICES).json()
        self.assertEqual(set(body), {'items', 'total'})
        self.assertEqual(body['total'], len(body['items']))
        self.assertIn(self.invoice.id, self._ids())
        self.assertIn(self.bill.id, self._ids())
        self.assertNotIn(self.other_invoice.id, self._ids())

    def test_the_detail_carries_the_lines_with_their_taxes(self):
        body = self.api('GET', f'{INVOICES}/{self.invoice.id}').json()
        self.assertEqual(set(body), INVOICE_KEYS | {'ref', 'debit_origin', 'credit_origin', 'zatca', 'lines', 'allowed_actions', 'blocked_actions'})
        (line,) = body['lines']
        self.assertEqual(set(line), LINE_KEYS)
        self.assertEqual((line['price_subtotal'], line['price_total']), (1000, 1150))
        self.assertEqual(len(line['taxes']), 1)

    def test_a_saudi_sale_invoice_carries_the_zatca_qr_payload_and_issue_time(self):
        self.company.vat = '300000000000003'
        body = self.api('GET', f'{INVOICES}/{self.invoice.id}').json()
        self.assertEqual(set(body['zatca']), {'qr_code', 'confirmation_datetime', 'submission'})
        self.assertEqual(body['zatca']['qr_code'], self.invoice.l10n_sa_qr_code_str)
        # The payload is base64 TLV: tag 2 holds the seller VAT number, tags 4 and 5 the total and the VAT.
        payload = base64.b64decode(body['zatca']['qr_code'])
        for value in (b'300000000000003', b'1150.00', b'150.00'):
            self.assertIn(value, payload)
        issued = fields.Datetime.to_string(self.invoice.l10n_sa_confirmation_datetime).replace(' ', 'T') + 'Z'
        self.assertEqual(body['zatca']['confirmation_datetime'], issued)

    def test_the_zatca_qr_is_null_until_the_company_has_a_vat_number(self):
        self.assertFalse(self.company.vat)
        zatca = self.api('GET', f'{INVOICES}/{self.invoice.id}').json()['zatca']
        self.assertIsNone(zatca['qr_code'])
        self.assertIsNotNone(zatca['confirmation_datetime'])

    def test_a_draft_sale_invoice_has_no_qr_or_issue_time_yet(self):
        draft = self._draft_sale_invoice(self.company, self.partner)
        zatca = self.api('GET', f'{INVOICES}/{draft.id}').json()['zatca']
        self.assertEqual((zatca['qr_code'], zatca['confirmation_datetime']), (None, None))
        self.assertEqual(zatca['submission']['state'], 'not_applicable')

    def test_a_vendor_bill_has_no_zatca_block(self):
        self.assertIsNone(self.api('GET', f'{INVOICES}/{self.bill.id}').json()['zatca'])

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

    def test_missing_foreign_rate_rejects_create_and_patch_without_mutation(self):
        usd = self.env.ref('base.USD')
        self.env['res.currency.rate'].search([('currency_id', '=', usd.id)]).unlink()
        before = self.env['account.move'].search_count([('company_id', '=', self.company.id)])
        audit_before = self.env['webvue.finance.audit.event'].search_count([('company_id', '=', self.company.id)])
        body = {
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'currency': 'USD',
            'invoice_date': '2026-10-18', 'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': 100}],
        }
        created = self.api('POST', INVOICES, json=body)
        self.assertEqual((created.status_code, created.json()['code']), (422, 'missing_exchange_rate'))
        self.assertIn('message', created.json())
        self.assertEqual(created.json()['field'], 'currency')
        self.assertEqual(self.env['account.move'].search_count([('company_id', '=', self.company.id)]), before)
        self.assertEqual(
            self.env['webvue.finance.audit.event'].search_count([('company_id', '=', self.company.id)]), audit_before,
        )

        old = (self.bill.currency_id, self.bill.invoice_date, [(line.quantity, line.price_unit) for line in self.bill.invoice_line_ids])
        patched = self.api('PATCH', f'{INVOICES}/{self.bill.id}', json={'currency': 'USD'})
        self.assertEqual((patched.status_code, patched.json()['code']), (422, 'missing_exchange_rate'))
        self.assertEqual(
            (self.bill.currency_id, self.bill.invoice_date, [(line.quantity, line.price_unit) for line in self.bill.invoice_line_ids]),
            old,
        )
        self.assertEqual(
            self.env['webvue.finance.audit.event'].search_count([('company_id', '=', self.company.id)]), audit_before,
        )

    def test_clearing_foreign_invoice_date_without_rate_rejects_without_mutation(self):
        usd = self.env.ref('base.USD')
        invoice = self.env['account.move'].with_company(self.company).create({
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'currency_id': usd.id,
            'invoice_date': '2026-10-18',
            'invoice_line_ids': [(0, 0, {'name': 'Consulting', 'quantity': 1, 'price_unit': 100})],
        })
        self.env['res.currency.rate'].search([('currency_id', '=', usd.id)]).unlink()
        before = (invoice.invoice_date, invoice.date, invoice.currency_id, [
            (line.name, line.quantity, line.price_unit, line.discount) for line in invoice.invoice_line_ids
        ])

        result = self.api('PATCH', f'{INVOICES}/{invoice.id}', json={'invoice_date': None})

        self.assertEqual((result.status_code, result.json()['code']), (422, 'missing_exchange_rate'))
        self.assertEqual((invoice.invoice_date, invoice.date, invoice.currency_id, [
            (line.name, line.quantity, line.price_unit, line.discount) for line in invoice.invoice_line_ids
        ]), before)

    def test_currency_and_date_change_without_rate_rejects_without_mutation(self):
        usd = self.env.ref('base.USD')
        self.env['res.currency.rate'].search([('currency_id', '=', usd.id)]).unlink()
        before = (self.bill.invoice_date, self.bill.date, self.bill.currency_id, [
            (line.name, line.quantity, line.price_unit, line.discount) for line in self.bill.invoice_line_ids
        ])

        result = self.api('PATCH', f'{INVOICES}/{self.bill.id}', json={
            'currency': 'USD', 'invoice_date': '2026-10-18',
        })

        self.assertEqual((result.status_code, result.json()['code']), (422, 'missing_exchange_rate'))
        self.assertEqual((self.bill.invoice_date, self.bill.date, self.bill.currency_id, [
            (line.name, line.quantity, line.price_unit, line.discount) for line in self.bill.invoice_line_ids
        ]), before)

    def test_rate_in_another_company_is_not_used_or_disclosed(self):
        usd = self.env.ref('base.USD')
        self.env['res.currency.rate'].search([('currency_id', '=', usd.id)]).unlink()
        secret_rate = 0.123456
        self.env['res.currency.rate'].with_company(self.other_company).create({
            'currency_id': usd.id, 'company_id': self.other_company.id,
            'name': '2026-01-01', 'rate': secret_rate,
        })
        result = self.api('POST', INVOICES, json={
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'currency': 'USD',
            'invoice_date': '2026-10-18', 'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': 100}],
        })
        self.assertEqual((result.status_code, result.json()['code']), (422, 'missing_exchange_rate'))
        self.assertNotIn(str(secret_rate), result.text)
        self.assertNotIn(str(self.other_company.id), result.text)

    def test_explicit_exchange_rate_one_and_non_one_allow_foreign_invoice(self):
        usd = self.env.ref('base.USD')
        rate_model = self.env['res.currency.rate'].with_company(self.company)
        rate_model.create({'currency_id': usd.id, 'company_id': self.company.id, 'name': '2026-01-01', 'rate': 1.0})
        body = {
            'move_type': 'out_invoice', 'partner_id': self.partner.id, 'currency': 'USD',
            'invoice_date': '2026-10-18', 'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': 100}],
        }
        created = self.api('POST', INVOICES, json=body)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['currency'], 'USD')
        one_rate_invoice = self.env['account.move'].browse(created.json()['id'])
        self.assertEqual(one_rate_invoice.currency_id, usd)
        receivable = one_rate_invoice.line_ids.filtered(lambda line: line.account_id.account_type == 'asset_receivable')
        self.assertEqual(receivable.mapped('amount_currency'), [100])
        self.assertEqual(receivable.mapped('balance'), [100])

        rate_model.search([('currency_id', '=', usd.id)]).write({'rate': 0.5})
        another = self.api('POST', INVOICES, json=body)
        self.assertEqual(another.status_code, 201, another.text)
        self.assertEqual(another.json()['amount_untaxed'], 100)
        non_one_rate_invoice = self.env['account.move'].browse(another.json()['id'])
        receivable = non_one_rate_invoice.line_ids.filtered(lambda line: line.account_id.account_type == 'asset_receivable')
        self.assertEqual(receivable.mapped('amount_currency'), [100])
        self.assertEqual(receivable.mapped('balance'), [200])

    def test_same_currency_and_zero_line_do_not_require_rate(self):
        usd = self.env.ref('base.USD')
        self.env['res.currency.rate'].search([('currency_id', '=', usd.id)]).unlink()
        for currency, price in (('SAR', 100), ('USD', 0)):
            with self.subTest(currency=currency, price=price):
                body = {
                    'move_type': 'out_invoice', 'partner_id': self.partner.id, 'currency': currency,
                    'invoice_date': '2026-10-18',
                    'lines': [{'name': 'Consulting', 'quantity': 1, 'price_unit': price}],
                }
                result = self.api('POST', INVOICES, json=body)
                self.assertEqual(result.status_code, 201, result.text)

    def test_bad_filters_are_a_422_invalid(self):
        for query in (
            '?move_type=entry', '?state=open', '?partner_id=abc', '?date_from=18-10-2026', '?date_from=20261018',
            '?date_from=2026-10-31&date_to=2026-10-01', '?limit=-1', '?offset=x',
        ):
            with self.subTest(query=query):
                result = self.api('GET', f'{INVOICES}{query}')
                self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))
