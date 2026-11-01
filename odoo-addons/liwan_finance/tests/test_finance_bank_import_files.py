# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from unittest.mock import patch

from odoo.tests import tagged

from .oca_common import BANK, LiwanFinanceOcaCase
from .statement_samples import CAMT, CAMT_ENTRY, OFX_V1, OFX_V2, camt_file
from .write_common import PASSWORD

PREVIEW = f'{BANK}/import/preview'
IMPORT = f'{BANK}/import'
EXTRA_OFX = (
    '<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261028</DTPOSTED><TRNAMT>100.00</TRNAMT><FITID>2026102800004</FITID>'
    '<NAME>New deposit</NAME></STMTTRN></BANKTRANLIST>'
)


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceBankStatementFiles(LiwanFinanceOcaCase):

    def body(self, content, **overrides):
        return {'journal_id': self.bank.id, 'content': content, **overrides}

    def lines_count(self):
        return self.env['account.bank.statement.line'].search_count([])

    def more_ofx(self):
        """The OFX file with one more transaction after the three of the first import and a closing balance to match."""
        return OFX_V2.replace('</BANKTRANLIST>', EXTRA_OFX).replace('<BALAMT>279.50</BALAMT>', '<BALAMT>379.50</BALAMT>')

    def test_the_format_is_detected_from_the_file_or_named(self):
        for content, expected in ((OFX_V1, 'ofx'), (OFX_V2, 'ofx'), (CAMT, 'camt')):
            with self.subTest(expected=expected, size=len(content)):
                self.assertEqual(self.api('POST', PREVIEW, json=self.body(content)).json()['format'], expected)
        named = self.api('POST', PREVIEW, json=self.body(OFX_V2, format='ofx')).json()
        self.assertEqual(named['format'], 'ofx')
        self.assertRefused(self.api('POST', PREVIEW, json=self.body(OFX_V2, format='pdf')), 422, 'invalid', 'format')
        self.assertRefused(self.api('POST', PREVIEW, json=self.body(OFX_V2, format='camt')), 422, 'invalid', 'content')

    def test_the_ofx_preview_lists_the_lines_and_writes_nothing(self):
        before = (self.lines_count(), self.env['account.bank.statement'].search_count([]))
        for content in (OFX_V1, OFX_V2):
            body = self.api('POST', PREVIEW, json=self.body(content)).json()
            self.assertEqual([(line['row'], line['amount'], line['duplicate']) for line in body['lines']], [(1, 750, False), (2, -460, False), (3, -10.5, False)])
            self.assertEqual(body['lines'][1]['payment_ref'], 'Gulf Supplies & Co')
            self.assertEqual((body['errors'], body['summary']['lines'], body['summary']['total']), ([], 3, 279.5))
            self.assertEqual((body['summary']['date_from'], body['summary']['date_to']), ('2026-10-25', '2026-10-27'))
            self.assertEqual((body['delimiter'], body['columns'], body['balance_start'], body['balance_end_real']), (None, [], None, 279.5))
        self.assertEqual((self.lines_count(), self.env['account.bank.statement'].search_count([])), before)

    def test_the_ofx_import_creates_one_statement_keyed_by_the_bank_ids(self):
        result = self.api('POST', IMPORT, json=self.body(OFX_V1, name='October OFX', balance_start=0))
        self.assertEqual(result.status_code, 201, result.text)
        statement = result.json()
        self.assertEqual((statement['name'], statement['lines_count'], statement['balance_end'], statement['balance_end_real']), ('October OFX', 3, 279.5, 279.5))
        lines = self.env['account.bank.statement'].browse(statement['id']).line_ids.sorted('date')
        self.assertEqual(lines.mapped('unique_import_id'), [f'{self.bank.id}-ofx-{fitid}' for fitid in ('2026102500001', '2026102600002', '2026102700003')])
        events = self.env['liwan.finance.audit.event'].search([('action', '=', 'bank_statement_imported'), ('res_id', '=', statement['id'])])
        self.assertEqual(events.mapped('outcome'), ['OFX file, 3 lines, 0 reconciled'])

    def test_an_ofx_file_has_no_opening_balance_so_the_caller_or_the_last_statement_gives_it(self):
        refused = self.api('POST', IMPORT, json=self.body(OFX_V2))
        self.assertRefused(refused, 422, 'invalid', 'balance_start')
        self.assertEqual(self.api('POST', IMPORT, json=self.body(OFX_V2, balance_start=0)).status_code, 201)
        next_preview = self.api('POST', PREVIEW, json=self.body(self.more_ofx())).json()
        self.assertEqual((next_preview['balance_start'], next_preview['balance_end_real']), (279.5, 379.5))
        result = self.api('POST', IMPORT, json=self.body(self.more_ofx(), skip_duplicates=True))
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual([line['payment_ref'] for line in result.json()['lines']], ['New deposit'])
        self.assertEqual((result.json()['balance_start'], result.json()['balance_end_real']), (279.5, 379.5))

    def test_an_ofx_closing_balance_that_does_not_match_is_refused_and_nothing_is_written(self):
        before = self.env['account.bank.statement'].search_count([])
        refused = self.api('POST', IMPORT, json=self.body(OFX_V2, balance_start=100))
        self.assertRefused(refused, 422, 'balance_mismatch', 'balance_end_real')
        self.assertEqual(refused.json()['details'], {'expected': 379.5, 'given': 279.5})
        self.assertEqual(self.env['account.bank.statement'].search_count([]), before)

    def test_the_same_ofx_twice_is_refused_even_when_the_texts_changed(self):
        self.assertEqual(self.api('POST', IMPORT, json=self.body(OFX_V1, balance_start=0)).status_code, 201)
        renamed = OFX_V2.replace('Transfer from Al Noor', 'Al Noor transfer').replace('Gulf Supplies &amp; Co', 'Gulf Supplies').replace('Bank fees', 'Fees')
        for content in (OFX_V2, renamed):
            refused = self.api('POST', IMPORT, json=self.body(content, balance_start=0))
            self.assertRefused(refused, 422, 'duplicate_lines')
            self.assertEqual(refused.json()['details'], {'rows': [1, 2, 3]})
        preview = self.api('POST', PREVIEW, json=self.body(renamed)).json()
        self.assertEqual((preview['summary']['duplicates'], preview['summary']['total']), (3, 0))

    def test_unreadable_ofx_transactions_are_reported_and_nothing_is_imported(self):
        broken = OFX_V2.replace('<DTPOSTED>20261026</DTPOSTED>', '<DTPOSTED>soon</DTPOSTED>').replace('<TRNAMT>-10.50</TRNAMT>', '<TRNAMT>0.00</TRNAMT>')
        preview = self.api('POST', PREVIEW, json=self.body(broken)).json()
        self.assertEqual([(error['row'], error['field']) for error in preview['errors']], [(2, 'date'), (3, 'amount')])
        refused = self.api('POST', IMPORT, json=self.body(broken, balance_start=0))
        self.assertRefused(refused, 422, 'invalid_rows')
        self.assertEqual(len(refused.json()['details']['errors']), 2)

    def test_the_camt_preview_lists_the_lines_with_the_files_balances_and_writes_nothing(self):
        before = (self.lines_count(), self.env['account.bank.statement'].search_count([]))
        body = self.api('POST', PREVIEW, json=self.body(CAMT)).json()
        self.assertEqual([(line['row'], line['date'], line['amount'], line['payment_ref']) for line in body['lines']], [
            (1, '2026-10-25', 750, 'Transfer from Al Noor'), (2, '2026-10-26', -460, 'Gulf Supplies bill'), (3, '2026-10-27', -10.5, 'Bank fees'),
        ])
        self.assertEqual((body['errors'], body['summary']['total'], body['balance_start'], body['balance_end_real']), ([], 279.5, 1000, 1279.5))
        self.assertEqual((self.lines_count(), self.env['account.bank.statement'].search_count([])), before)

    def test_the_camt_import_takes_the_balances_from_the_file(self):
        result = self.api('POST', IMPORT, json=self.body(CAMT))
        self.assertEqual(result.status_code, 201, result.text)
        statement = result.json()
        self.assertEqual((statement['lines_count'], statement['balance_start'], statement['balance_end_real']), (3, 1000, 1279.5))
        self.assertEqual(statement['date'], '2026-10-27')
        events = self.env['liwan.finance.audit.event'].search([('action', '=', 'bank_statement_imported'), ('res_id', '=', statement['id'])])
        self.assertEqual(events.mapped('outcome'), ['CAMT file, 3 lines, 0 reconciled'])

    def test_a_camt_file_whose_balances_do_not_add_up_is_refused(self):
        entries = [CAMT_ENTRY.format(amount='750.00', sign='CRDT', day='2026-10-25', ref='R1', text='Deposit')]
        refused = self.api('POST', IMPORT, json=self.body(camt_file(entries, opening='1000.00', closing='1800.00')))
        self.assertRefused(refused, 422, 'balance_mismatch', 'balance_end_real')
        self.assertEqual(refused.json()['details'], {'expected': 1750, 'given': 1800})
        self.assertEqual(self.env['account.bank.statement'].search_count([('journal_id', '=', self.bank.id)]), 0)

    def test_the_same_camt_twice_is_refused_and_skipping_moves_the_opening_balance(self):
        self.assertEqual(self.api('POST', IMPORT, json=self.body(CAMT)).status_code, 201)
        refused = self.api('POST', IMPORT, json=self.body(CAMT))
        self.assertRefused(refused, 422, 'duplicate_lines')
        self.assertEqual(refused.json()['details'], {'rows': [1, 2, 3]})
        entries = [
            CAMT_ENTRY.format(amount='750.00', sign='CRDT', day='2026-10-25', ref='BANKREF-1', text='Transfer from Al Noor'),
            CAMT_ENTRY.format(amount='460.00', sign='DBIT', day='2026-10-26', ref='BANKREF-2', text='Gulf Supplies bill'),
            CAMT_ENTRY.format(amount='10.50', sign='DBIT', day='2026-10-27', ref='BANKREF-3', text='Bank fees'),
            CAMT_ENTRY.format(amount='100.00', sign='CRDT', day='2026-10-28', ref='BANKREF-4', text='New deposit'),
        ]
        longer = camt_file(entries, opening='1000.00', closing='1379.50')
        preview = self.api('POST', PREVIEW, json=self.body(longer)).json()
        self.assertEqual((preview['summary']['duplicates'], preview['balance_start'], preview['balance_end_real']), (3, 1279.5, 1379.5))
        result = self.api('POST', IMPORT, json=self.body(longer, skip_duplicates=True))
        self.assertEqual(result.status_code, 201, result.text)
        self.assertEqual([line['payment_ref'] for line in result.json()['lines']], ['New deposit'])

    def test_files_that_are_not_statements_are_refused_with_a_422(self):
        wrong_namespace = '<?xml version="1.0"?><Document xmlns="urn:example:other"><A/></Document>'
        entity = '<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY x "y">]>' + CAMT.split('?>', 1)[1]
        for content, fmt in (
            ('not a statement at all', 'ofx'), ('<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>', 'ofx'),
            (OFX_V2, 'camt'), ('Date,Amount\n2026-10-25,10\n', 'camt'), (wrong_namespace, 'camt'),
            ('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"/>', 'camt'), (entity, 'camt'),
            (camt_file([]), 'camt'),
        ):
            with self.subTest(content=content[:40], fmt=fmt):
                for route, extra in ((PREVIEW, {}), (IMPORT, {'balance_start': 0, 'balance_end_real': 0})):
                    refused = self.api('POST', route, json=self.body(content, format=fmt, **extra))
                    self.assertRefused(refused, 422, 'invalid', 'content')

    def test_a_file_in_another_currency_or_with_several_statements_is_refused(self):
        self.assertRefused(self.api('POST', PREVIEW, json=self.body(OFX_V2.replace('SAR', 'USD'))), 422, 'invalid', 'journal_id')
        entries = [CAMT_ENTRY.format(amount='1.00', sign='CRDT', day='2026-10-25', ref='R1', text='One')]
        self.assertRefused(self.api('POST', PREVIEW, json=self.body(camt_file(entries, statements=2))), 422, 'invalid', 'content')

    def test_csv_options_and_other_journals_are_refused_for_these_files(self):
        for change, field in (
            ({'delimiter': ';'}, 'delimiter'), ({'mapping': {'date': 'a', 'payment_ref': 'b', 'amount': 'c'}}, 'mapping'),
            ({'has_header': False}, 'has_header'), ({'date_format': 'DD/MM/YYYY'}, 'date_format'), ({'decimal_separator': ','}, 'decimal_separator'),
            ({'journal_id': self.other_bank.id}, 'journal_id'), ({'journal_id': self._journal(self.company, 'sale').id}, 'journal_id'),
            ({'unknown': 1}, 'unknown'),
        ):
            with self.subTest(change=change):
                self.assertRefused(self.api('POST', PREVIEW, json=self.body(OFX_V2, **change)), 422, 'invalid', field)

    def test_a_line_with_a_bank_id_is_not_hidden_by_a_manual_line_with_the_same_text(self):
        manual = self.api('POST', BANK, json={'journal_id': self.bank.id, 'date': '2026-10-25', 'lines': [
            {'date': '2026-10-25', 'payment_ref': 'Transfer from Al Noor - Invoice INV/2026/0001', 'amount': 750},
        ]})
        self.assertEqual(manual.status_code, 201, manual.text)
        preview = self.api('POST', PREVIEW, json=self.body(OFX_V2)).json()
        self.assertEqual([line['duplicate'] for line in preview['lines']], [False, False, False])
        no_ids = self.api('POST', PREVIEW, json=self.body(OFX_V2.replace('<FITID>2026102500001</FITID>', ''))).json()
        self.assertEqual([line['duplicate'] for line in no_ids['lines']], [True, False, False])
        self.assertEqual(self.api('POST', IMPORT, json=self.body(OFX_V2, balance_start=0)).status_code, 201)

    def test_repeated_bank_ids_in_one_file_are_kept_and_the_file_is_still_caught_on_re_import(self):
        repeated = OFX_V2.replace('2026102600002', '2026102500001').replace('2026102700003', '2026102500001')
        self.assertEqual(self.api('POST', IMPORT, json=self.body(repeated, balance_start=0)).status_code, 201)
        refused = self.api('POST', IMPORT, json=self.body(repeated, balance_start=0))
        self.assertRefused(refused, 422, 'duplicate_lines')
        self.assertEqual(refused.json()['details'], {'rows': [1, 2, 3]})

    def test_a_literal_id_with_a_hash_is_not_the_suffix_of_a_repeated_one(self):
        first = OFX_V2.replace('2026102500001', 'BANK-ID').replace('2026102600002', 'BANK-ID#2').replace('2026102700003', 'OTHER')
        self.assertEqual(self.api('POST', IMPORT, json=self.body(first, balance_start=0)).status_code, 201)
        repeated = OFX_V2.replace('2026102500001', 'BANK-ID').replace('2026102600002', 'BANK-ID').replace('2026102700003', 'NEW')
        preview = self.api('POST', PREVIEW, json=self.body(repeated)).json()
        self.assertEqual([line['duplicate'] for line in preview['lines']], [True, False, False])

    def test_two_transactions_with_one_stored_id_are_refused_with_a_422(self):
        clash = [{'currency': 'SAR', 'account_number': None, 'balance_end': 5.0, 'errors': [], 'lines': [
            {'row': row, 'date': date(2026, 10, 25), 'payment_ref': f'Line {row}', 'amount': 5.0, 'fitid': 'SAME'} for row in (1, 2)]}]
        with patch('odoo.addons.liwan_finance.controllers.finance_bank_import.parse_ofx', return_value=clash):
            refused = self.api('POST', PREVIEW, json=self.body(OFX_V2))
        self.assertRefused(refused, 422, 'invalid', 'content')

    def test_an_existing_payment_matched_by_id_is_not_counted_again_for_a_line_without_one(self):
        coffee = ('<STMTTRN><DTPOSTED>20261025</DTPOSTED><TRNAMT>-5.00</TRNAMT>{fitid}<NAME>Coffee</NAME></STMTTRN>')
        with_id, without_id = coffee.format(fitid='<FITID>A</FITID>'), coffee.format(fitid='')
        self.env['account.bank.statement.line'].create({
            'journal_id': self.bank.id, 'date': '2026-10-25', 'payment_ref': 'Coffee', 'amount': -5, 'unique_import_id': f'{self.bank.id}-ofx-A',
        })
        for order in ((with_id, without_id), (without_id, with_id)):
            body = OFX_V2.split('<BANKTRANLIST>')[0] + '<BANKTRANLIST>' + ''.join(order) + '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
            lines = self.api('POST', PREVIEW, json=self.body(body)).json()['lines']
            self.assertEqual(sorted(line['duplicate'] for line in lines), [False, True])
            self.assertEqual(lines[0]['duplicate'], order[0] == with_id)

    def test_the_account_in_the_file_must_be_the_journals_when_both_are_known(self):
        camt = camt_file([CAMT_ENTRY.format(amount='5.00', sign='CRDT', day='2026-10-25', ref='R1', text='One')], opening='0.00', closing='5.00')
        no_account_ofx = OFX_V2.replace('<ACCTID>SA0380000000608010167519</ACCTID>', '')
        self.assertEqual(self.api('POST', PREVIEW, json=self.body(OFX_V2)).status_code, 200)
        partner_bank = self.env['res.partner.bank'].create({'acc_number': 'SA99 0000 0000 0000 0000 0001', 'partner_id': self.company.partner_id.id})
        self.bank.bank_account_id = partner_bank
        for content in (OFX_V2, camt):
            with self.subTest(content=content[:20]):
                self.assertRefused(self.api('POST', PREVIEW, json=self.body(content)), 422, 'account_mismatch', 'journal_id')
                self.assertRefused(self.api('POST', IMPORT, json=self.body(content, balance_start=0, balance_end_real=0)), 422, 'account_mismatch', 'journal_id')
        self.assertEqual(self.api('POST', PREVIEW, json=self.body(no_account_ofx)).status_code, 200)
        partner_bank.acc_number = 'sa03 8000 0000 6080 1016 7519'
        self.assertEqual(self.api('POST', PREVIEW, json=self.body(OFX_V2)).status_code, 200)
        self.assertEqual(self.api('POST', PREVIEW, json=self.body(OFX_V2.replace('SA0380000000608010167519', '608010167519'))).status_code, 200)
        self.assertEqual(self.api('POST', PREVIEW, json=self.body(camt)).status_code, 200)

    def test_a_camt_file_with_no_balances_asks_the_caller_for_them(self):
        entries = [CAMT_ENTRY.format(amount='5.00', sign='CRDT', day='2026-10-25', ref='R1', text='One')]
        bare = camt_file(entries, opening=None, closing=None)
        preview = self.api('POST', PREVIEW, json=self.body(bare)).json()
        self.assertEqual((preview['balance_start'], preview['balance_end_real']), (None, None))
        self.assertRefused(self.api('POST', IMPORT, json=self.body(bare)), 422, 'invalid', 'balance_start')
        self.assertEqual(self.api('POST', IMPORT, json=self.body(bare, balance_start=10, balance_end_real=15)).status_code, 201)

    def test_capability(self):
        self.user_with('bank_reader', ['finance.bank.read'])
        self.authenticate('bank_reader', PASSWORD)
        for content in (OFX_V2, CAMT):
            self.assertRefused(self.api('POST', PREVIEW, json=self.body(content)), 403, 'forbidden')
            self.assertRefused(self.api('POST', IMPORT, json=self.body(content)), 403, 'forbidden')
