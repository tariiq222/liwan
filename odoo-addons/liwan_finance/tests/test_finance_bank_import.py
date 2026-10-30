# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import BANK, LiwanFinanceOcaCase
from .write_common import PASSWORD

PREVIEW = f'{BANK}/import/preview'
IMPORT = f'{BANK}/import'
FILE = (
    'Date,Description,Debit,Credit,Balance\n'
    '2026-10-25,Transfer from Al Noor,,750.00,750.00\n'
    '2026-10-26,Gulf Supplies bill,460.00,,290.00\n'
    '2026-10-27,"Bank fees, October",10.50,,279.50\n'
)
MAPPING = {'date': 'Date', 'payment_ref': 'Description', 'debit': 'Debit', 'credit': 'Credit'}


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceBankImport(LiwanFinanceOcaCase):

    def body(self, **overrides):
        return {'journal_id': self.bank.id, 'content': FILE, 'mapping': MAPPING, **overrides}

    def importing(self, **overrides):
        return self.api('POST', IMPORT, json=self.body(balance_start=0, balance_end_real=279.5, **overrides))

    def test_the_preview_without_a_mapping_proposes_the_columns(self):
        result = self.api('POST', PREVIEW, json={'journal_id': self.bank.id, 'content': FILE})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['delimiter'], body['columns'], body['row_count']), (',', ['Date', 'Description', 'Debit', 'Credit', 'Balance'], 3))
        self.assertEqual(body['suggested_mapping'], {'date': 'Date', 'payment_ref': 'Description', 'debit': 'Debit', 'credit': 'Credit'})
        self.assertEqual(len(body['sample']), 3)

    def test_a_binary_file_is_refused_as_unreadable(self):
        result = self.api('POST', PREVIEW, json={'journal_id': self.bank.id, 'content': '\x00\x01binary'})
        self.assertEqual((result.status_code, result.json()['code'], result.json()['field']), (422, 'invalid', 'content'))

    def test_the_preview_with_a_mapping_lists_the_lines_and_writes_nothing(self):
        before = self.env['account.bank.statement.line'].search_count([])
        body = self.api('POST', PREVIEW, json=self.body()).json()
        self.assertEqual([(line['row'], line['amount'], line['duplicate']) for line in body['lines']], [(2, 750, False), (3, -460, False), (4, -10.5, False)])
        self.assertEqual(body['lines'][2]['payment_ref'], 'Bank fees, October')
        self.assertEqual((body['errors'], body['summary']['lines'], body['summary']['total']), ([], 3, 279.5))
        self.assertEqual((body['summary']['date_from'], body['summary']['date_to']), ('2026-10-25', '2026-10-27'))
        self.assertEqual(self.env['account.bank.statement.line'].search_count([]), before)

    def test_the_import_creates_one_statement_that_balances(self):
        result = self.importing(name='October file')
        self.assertEqual(result.status_code, 201, result.text)
        statement = result.json()
        self.assertEqual((statement['name'], statement['lines_count'], statement['balance_end'], statement['balance_end_real']), ('October file', 3, 279.5, 279.5))
        self.assertEqual(statement['date'], '2026-10-27')
        self.assertEqual([line['amount'] for line in statement['lines']], [750, -460, -10.5])
        events = self.env['liwan.finance.audit.event'].search([('action', '=', 'bank_statement_imported'), ('res_id', '=', statement['id'])])
        self.assertEqual(len(events), 1)

    def test_a_wrong_closing_balance_is_refused_and_nothing_is_written(self):
        before = self.env['account.bank.statement'].search_count([])
        refused = self.api('POST', IMPORT, json=self.body(balance_start=0, balance_end_real=300))
        self.assertRefused(refused, 422, 'balance_mismatch', 'balance_end_real')
        self.assertEqual(refused.json()['details'], {'expected': 279.5, 'given': 300})
        self.assertEqual(self.env['account.bank.statement'].search_count([]), before)

    def test_the_same_file_twice_is_refused_as_duplicates(self):
        self.assertEqual(self.importing().status_code, 201)
        refused = self.importing()
        self.assertRefused(refused, 422, 'duplicate_lines')
        self.assertEqual(refused.json()['details'], {'rows': [2, 3, 4]})
        preview = self.api('POST', PREVIEW, json=self.body()).json()
        self.assertEqual((preview['summary']['duplicates'], preview['summary']['total']), (3, 0))

    def test_skip_duplicates_imports_only_the_new_lines(self):
        self.importing()
        more = FILE + '2026-10-28,New deposit,,100.00,379.50\n'
        result = self.api('POST', IMPORT, json=self.body(content=more, balance_start=279.5, balance_end_real=379.5, skip_duplicates=True))
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual([line['payment_ref'] for line in result.json()['lines']], ['New deposit'])

    def test_two_identical_lines_in_one_file_are_both_kept(self):
        twin = 'Date,Description,Amount\n2026-10-25,Coffee,-5\n2026-10-25,Coffee,-5\n'
        body = {'journal_id': self.bank.id, 'content': twin, 'mapping': {'date': 'Date', 'payment_ref': 'Description', 'amount': 'Amount'}}
        self.assertEqual(self.api('POST', IMPORT, json={**body, 'balance_start': 0, 'balance_end_real': -10}).json()['lines_count'], 2)
        again = self.api('POST', PREVIEW, json=body).json()
        self.assertEqual([line['duplicate'] for line in again['lines']], [True, True])

    def test_other_layouts_semicolon_decimal_comma_arabic_digits_and_dates(self):
        text = 'التاريخ;البيان;المبلغ\n٢٥/١٠/٢٠٢٦;إيداع;"1.250,75"\n26/10/2026;سحب;(300,25)\n'
        body = {
            'journal_id': self.bank.id, 'content': text, 'date_format': 'DD/MM/YYYY', 'decimal_separator': ',',
            'mapping': {'date': 'التاريخ', 'payment_ref': 'البيان', 'amount': 'المبلغ'},
        }
        preview = self.api('POST', PREVIEW, json=body).json()
        self.assertEqual(preview['delimiter'], ';')
        self.assertEqual([(line['date'], line['amount']) for line in preview['lines']], [('2026-10-25', 1250.75), ('2026-10-26', -300.25)])

    def test_a_file_without_a_header_uses_column_positions(self):
        text = '2026-10-25;Cash in;100\n'
        body = {'journal_id': self.bank.id, 'content': text, 'has_header': False, 'mapping': {'date': 0, 'payment_ref': 1, 'amount': 2}}
        self.assertEqual(self.api('POST', PREVIEW, json=body).json()['lines'][0]['amount'], 100)

    def test_unreadable_rows_are_reported_with_their_row_and_nothing_is_imported(self):
        text = FILE + 'not a date,Broken,5,,\n2026-10-28,Zero,,0,\n2026-10-29,Letters,abc,,\n'
        preview = self.api('POST', PREVIEW, json=self.body(content=text)).json()
        self.assertEqual([(error['row'], error['field']) for error in preview['errors']], [(5, 'date'), (6, 'amount'), (7, 'amount')])
        refused = self.api('POST', IMPORT, json=self.body(content=text, balance_start=0, balance_end_real=279.5))
        self.assertRefused(refused, 422, 'invalid_rows')
        self.assertEqual(len(refused.json()['details']['errors']), 3)

    def test_mapping_and_body_refusals(self):
        for change, field in (
            ({'mapping': {'date': 'Date'}}, 'mapping.payment_ref'),
            ({'mapping': {'date': 'Date', 'payment_ref': 'Description'}}, 'mapping.amount'),
            ({'mapping': {**MAPPING, 'amount': 'Balance'}}, 'mapping.amount'),
            ({'mapping': {**MAPPING, 'debit': 'Nope'}}, 'mapping.debit'),
            ({'mapping': {**MAPPING, 'colour': 'Date'}}, 'mapping.colour'),
            ({'date_format': 'YYYYMMDD'}, 'date_format'),
            ({'decimal_separator': ';'}, 'decimal_separator'),
            ({'delimiter': 'x'}, 'delimiter'),
            ({'content': '   '}, 'content'),
            ({'content': 'x' * (2 * 1024 * 1024 + 1)}, 'content'),
            ({'journal_id': self._journal(self.company, 'sale').id}, 'journal_id'),
            ({'journal_id': self.other_bank.id}, 'journal_id'),
            ({'unknown': 1}, 'unknown'),
        ):
            with self.subTest(change=change):
                self.assertRefused(self.api('POST', PREVIEW, json=self.body(**change)), 422, 'invalid', field)
        self.assertRefused(self.api('POST', IMPORT, json=self.body()), 422, 'invalid', 'balance_start')

    def test_a_cash_journal_takes_statements_and_imports(self):
        cash = self._journal(self.company, 'cash') or self.env['account.journal'].create({
            'name': 'Petty cash', 'code': 'PTY', 'type': 'cash', 'company_id': self.company.id,
        })
        text = 'Date,Description,Amount\n2026-10-25,Petty cash top-up,200\n'
        body = {'journal_id': cash.id, 'content': text, 'mapping': {'date': 'Date', 'payment_ref': 'Description', 'amount': 'Amount'}}
        result = self.api('POST', IMPORT, json={**body, 'balance_start': 0, 'balance_end_real': 200})
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual(result.json()['journal']['id'], cash.id)
        manual = self.api('POST', BANK, json={'journal_id': cash.id, 'date': '2026-10-26', 'lines': [{'date': '2026-10-26', 'payment_ref': 'Count', 'amount': -20}]})
        self.assertEqual(manual.status_code, 201, manual.text)

    def test_capability(self):
        self.user_with('bank_reader', ['finance.bank.read'])
        self.authenticate('bank_reader', PASSWORD)
        self.assertRefused(self.api('POST', PREVIEW, json=self.body()), 403, 'forbidden')
        self.assertRefused(self.importing(), 403, 'forbidden')
