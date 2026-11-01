# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import BaseCase, tagged

from .statement_samples import OFX_V1, OFX_V2
from odoo.addons.liwan_finance.serializers.statement_camt import (
    CamtError,
    camt_bytes,
    normalize_camt,
)
from odoo.addons.liwan_finance.serializers.statement_ofx import OfxError, parse_ofx


def single(text):
    statements = parse_ofx(text)
    assert len(statements) == 1
    return statements[0]


@tagged('post_install', '-at_install', 'liwan')
class TestOfxReader(BaseCase):

    def test_both_versions_give_the_same_statement(self):
        for text in (OFX_V1, OFX_V2):
            with self.subTest(version=text[:8]):
                statement = single(text)
                self.assertEqual((statement['currency'], statement['account_number'], statement['balance_end']), ('SAR', 'SA0380000000608010167519', 279.5))
                self.assertEqual(statement['errors'], [])
                self.assertEqual(
                    [(line['row'], line['date'], line['amount'], line['fitid'], line['payment_ref']) for line in statement['lines']],
                    [
                        (1, date(2026, 10, 25), 750.0, '2026102500001', 'Transfer from Al Noor - Invoice INV/2026/0001'),
                        (2, date(2026, 10, 26), -460.0, '2026102600002', 'Gulf Supplies & Co'),
                        (3, date(2026, 10, 27), -10.5, '2026102700003', 'Bank fees'),
                    ],
                )

    def test_the_ledger_balance_wins_and_the_available_one_is_the_fallback(self):
        self.assertEqual(single(OFX_V1)['balance_end'], 279.5)
        no_ledger = OFX_V1.replace('<LEDGERBAL>', '<IGNORED>').replace('</LEDGERBAL>', '</IGNORED>')
        self.assertEqual(single(no_ledger)['balance_end'], 250.0)
        neither = OFX_V2.replace('<LEDGERBAL><BALAMT>279.50</BALAMT><DTASOF>20261027</DTASOF></LEDGERBAL>', '')
        self.assertIsNone(single(neither)['balance_end'])

    def test_a_credit_card_statement_and_a_decimal_comma_are_read(self):
        card = (
            '<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>SAR<CCACCTFROM><ACCTID>4111</CCACCTFROM>'
            '<BANKTRANLIST><STMTTRN><DTPOSTED>20261001<TRNAMT>-12,50<FITID>A1<NAME>Coffee</STMTTRN></BANKTRANLIST>'
            '</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>'
        )
        statement = single(card)
        self.assertEqual((statement['account_number'], statement['lines'][0]['amount']), ('4111', -12.5))

    def test_unreadable_transactions_are_reported_by_number(self):
        broken = OFX_V2.replace('<DTPOSTED>20261026</DTPOSTED>', '<DTPOSTED>soon</DTPOSTED>').replace('<TRNAMT>-10.50</TRNAMT>', '<TRNAMT>0.00</TRNAMT>')
        statement = single(broken)
        self.assertEqual([(error['row'], error['field']) for error in statement['errors']], [(2, 'date'), (3, 'amount')])
        self.assertEqual([line['row'] for line in statement['lines']], [1])

    def test_a_transaction_without_an_id_is_kept_and_a_repeated_id_gets_a_stable_suffix(self):
        statement = single(OFX_V2.replace('<FITID>2026102600002</FITID>', ''))
        self.assertIsNone(statement['lines'][1]['fitid'])
        repeated = OFX_V2.replace('2026102600002', '2026102500001').replace('2026102700003', '2026102500001')
        ids = [line['fitid'] for line in single(repeated)['lines']]
        self.assertEqual(ids, ['2026102500001', '2026102500001#2', '2026102500001#3'])
        self.assertEqual([line['fitid'] for line in single(repeated)['lines']], ids)

    def test_generated_suffixes_cannot_meet_a_literal_bank_id(self):
        text = OFX_V2.replace('2026102500001', 'BANK-ID').replace('2026102600002', 'BANK-ID').replace('2026102700003', 'BANK-ID#2')
        ids = [line['fitid'] for line in single(text)['lines']]
        self.assertEqual(ids, ['BANK-ID', 'BANK-ID#2', 'BANK-ID%232'])
        self.assertEqual(len(set(ids)), 3)
        percent = OFX_V2.replace('2026102500001', 'A%23').replace('2026102600002', 'A#')
        self.assertEqual([line['fitid'] for line in single(percent)['lines']][:2], ['A%2523', 'A%23'])

    def test_a_self_closed_element_does_not_swallow_the_next_ones_and_cdata_is_read(self):
        text = OFX_V2.replace('<STMTTRN><TRNTYPE>DEBIT', '<STMTTRN/><STMTTRN><TRNTYPE>DEBIT', 1)
        statement = single(text)
        self.assertEqual([(error['row'], error['field']) for error in statement['errors']], [(2, 'date')])
        self.assertEqual([line['row'] for line in statement['lines']], [1, 3, 4])
        cdata = OFX_V2.replace('<NAME>Gulf Supplies &amp; Co</NAME>', '<NAME><![CDATA[Gulf <Supplies> & Co]]></NAME>')
        self.assertEqual(single(cdata)['lines'][1]['payment_ref'], 'Gulf <Supplies> & Co')

    def test_a_file_nested_too_deeply_is_refused(self):
        with self.assertRaisesRegex(OfxError, 'levels deep'):
            parse_ofx('<OFX><STMTRS>' + '<PAYEE>' * 5000)

    def test_a_file_that_is_not_a_statement_is_refused(self):
        for text in ('Date,Amount\n2026-10-25,100\n', '<OFX></OFX>', '<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>'):
            with self.subTest(text=text[:20]), self.assertRaises(OfxError):
                parse_ofx(text)
        with self.assertRaisesRegex(OfxError, 'LEDGERBAL'):
            parse_ofx(OFX_V2.replace('<BALAMT>279.50</BALAMT>', '<BALAMT>lots</BALAMT>'))

    def test_a_file_cannot_declare_entities(self):
        text = OFX_V2.replace('<OFX>', '<!DOCTYPE OFX [<!ENTITY x SYSTEM "file:///etc/passwd">]><OFX>', 1).replace('Bank fees</NAME>', '&x;</NAME>', 1)
        names = [line['payment_ref'] for line in single(text)['lines']]
        self.assertNotIn('root:', ' '.join(names))


@tagged('post_install', '-at_install', 'liwan')
class TestCamtMapping(BaseCase):

    def test_the_declared_encoding_is_dropped_and_a_doctype_refused(self):
        self.assertNotIn(b'encoding', camt_bytes('<?xml version="1.0" encoding="ISO-8859-1"?><Document/>'))
        self.assertEqual(camt_bytes('<Document/>'), b'<Document/>')
        with self.assertRaises(CamtError):
            camt_bytes('<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY x "y">]><Document/>')

    def test_the_engine_answer_becomes_lines_balances_and_row_problems(self):
        statements = [{
            'balance_start': 1000.0, 'balance_end_real': 1279.5,
            'transactions': [
                {'date': '2026-10-25', 'amount': 750.0, 'payment_ref': ' Transfer\nfrom Al Noor '},
                {'date': '2026-10-26T09:30:00', 'amount': -460.0, 'payment_ref': ''},
                {'date': '2026-10-27', 'amount': 0.0, 'payment_ref': 'Zero'},
                {'amount': 5.0, 'payment_ref': 'No date'},
            ],
        }]
        text = '<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp></Bal><Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp></Bal>'
        [statement] = normalize_camt(text, 'SAR', 'SA03', statements)
        self.assertEqual((statement['currency'], statement['balance_start'], statement['balance_end']), ('SAR', 1000.0, 1279.5))
        self.assertEqual(
            [(line['row'], line['date'], line['payment_ref']) for line in statement['lines']],
            [(1, date(2026, 10, 25), 'Transfer from Al Noor'), (2, date(2026, 10, 26), '-')],
        )
        self.assertEqual([(error['row'], error['field']) for error in statement['errors']], [(3, 'amount'), (4, 'date')])
        with self.assertRaises(CamtError):
            normalize_camt(text, 'SAR', None, [])

    def test_a_balance_the_file_does_not_state_is_none_not_zero(self):
        statements = [{'balance_start': 0.0, 'balance_end_real': 0.0, 'transactions': [{'date': '2026-10-25', 'amount': 5.0, 'payment_ref': 'x'}]}]
        [none] = normalize_camt('<Document/>', 'SAR', None, statements)
        self.assertEqual((none['balance_start'], none['balance_end']), (None, None))
        closing_only = '<ns:Bal><ns:Tp><ns:CdOrPrtry><ns:Cd>CLBD</ns:Cd></ns:CdOrPrtry></ns:Tp></ns:Bal>'
        [closing] = normalize_camt(closing_only, 'SAR', None, statements)
        self.assertEqual((closing['balance_start'], closing['balance_end']), (None, 0.0))
