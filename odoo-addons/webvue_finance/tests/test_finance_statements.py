# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import REPORTS, WebVueFinanceOcaCase

YEAR = '?date_from=2026-01-01&date_to=2026-12-31'
AMOUNTS = ('initial_balance', 'debit', 'credit', 'balance', 'ending_balance')


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceStatements(WebVueFinanceOcaCase):
    """Trial balance, general ledger, aged partner balance and partner statement over the OCA reports."""

    def _get(self, path, query=''):
        result = self.api('GET', f'{REPORTS}/{path}{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _by_code(self, report):
        return {row['account']['code']: row for row in report['accounts']}

    # --- trial balance ---------------------------------------------------------------------------------

    def test_the_trial_balance_balances_and_carries_the_previous_year_as_earnings(self):
        report = self._get('trial-balance', YEAR)
        self.assertEqual(set(report), {'date_from', 'date_to', 'target_move', 'currency', 'accounts', 'totals'})
        self.assertEqual((report['currency'], report['target_move']), ('SAR', 'posted'))
        totals = report['totals']
        self.assertEqual(set(totals), set(AMOUNTS))
        self.assertEqual(totals['debit'], totals['credit'])
        self.assertEqual((totals['initial_balance'], totals['balance'], totals['ending_balance']), (0, 0, 0))
        rows = self._by_code(report)
        self.assertEqual(set(rows['101001']), {'account', *AMOUNTS})
        self.assertEqual(
            (rows['101001']['initial_balance'], rows['101001']['debit'], rows['101001']['credit'],
             rows['101001']['ending_balance']),
            (5000, 110000, 12000, 103000),
        )
        self.assertEqual(rows['500001']['ending_balance'], -1300)
        self.assertEqual(rows['999999']['initial_balance'], -5000)

    def test_the_trial_balance_counts_posted_entries_of_the_company_only(self):
        self.entry('2026-03-01', [('101001', 1, 0), ('300001', 0, 1)])
        self.env['account.move'].with_company(self.company).create({
            'move_type': 'entry', 'date': '2026-03-02', 'journal_id': self._journal(self.company, 'general').id,
            'line_ids': [
                (0, 0, {'account_id': self.account('101001').id, 'debit': 7, 'credit': 0}),
                (0, 0, {'account_id': self.account('300001').id, 'debit': 0, 'credit': 7}),
            ],
        })
        posted = self._by_code(self._get('trial-balance', YEAR))['101001']
        every = self._by_code(self._get('trial-balance', YEAR + '&target_move=all'))['101001']
        self.assertEqual((posted['debit'], every['debit']), (110001, 110008))

    # --- general ledger --------------------------------------------------------------------------------

    def test_the_general_ledger_gives_lines_with_a_running_balance(self):
        report = self._get('general-ledger', YEAR + f'&account_id={self.account("101001").id}')
        self.assertEqual(len(report['accounts']), 1)
        bank = report['accounts'][0]
        self.assertEqual(bank['account']['code'], '101001')
        self.assertEqual((bank['initial_balance'], bank['debit'], bank['credit'], bank['ending_balance']), (5000, 110000, 12000, 103000))
        self.assertEqual(bank['lines']['total'], 3)
        self.assertEqual([line['balance'] for line in bank['lines']['items']], [105000, 93000, 103000])
        self.assertEqual(set(bank['lines']['items'][0]), {'id', 'date', 'entry', 'journal', 'partner', 'label', 'debit', 'credit', 'balance'})

    def test_the_general_ledger_pages_its_lines(self):
        query = YEAR + f'&account_id={self.account("101001").id}&limit=2&offset=2'
        lines = self._get('general-ledger', query)['accounts'][0]['lines']
        self.assertEqual((lines['total'], len(lines['items'])), (3, 1))
        self.assertEqual(lines['items'][0]['balance'], 103000)

    def test_the_general_ledger_filters_by_partner(self):
        report = self._get('general-ledger', YEAR + f'&partner_id={self.riyadh.id}')
        rows = self._by_code(report)
        self.assertEqual(rows['102011']['debit'], 345)
        self.assertEqual(rows['102011']['lines']['items'][0]['partner'], {'id': self.riyadh.id, 'name': 'Riyadh Supplies'})
        self.assertNotIn('101001', rows)

    # --- aged partner balance ---------------------------------------------------------------------------

    def test_the_aged_receivables_fall_in_their_overdue_buckets(self):
        report = self._get('aged-partner-balance', '?date_to=2026-11-30')
        self.assertEqual((report['kind'], report['date_to'], report['currency']), ('receivable', '2026-11-30', 'SAR'))
        self.assertEqual(report['totals'], {
            'current': 230, 'days_1_30': 115, 'days_31_60': 750, 'days_61_90': 0, 'days_91_120': 0,
            'days_over_120': 0, 'total': 1095,
        })
        partners = {item['partner']['name']: item for item in report['accounts'][0]['partners']}
        self.assertEqual(partners['Al Noor Trading']['days_31_60'], 750)
        self.assertEqual(partners['Al Noor Trading']['partner']['id'], self.partner.id)
        self.assertEqual((partners['Riyadh Supplies']['current'], partners['Riyadh Supplies']['days_1_30']), (230, 115))

    def test_the_aged_payables_and_the_partner_filter(self):
        payables = self._get('aged-partner-balance', '?date_to=2026-11-30&kind=payable')
        self.assertEqual((payables['kind'], payables['totals']['days_1_30'], payables['totals']['total']), ('payable', -460, -460))
        one = self._get('aged-partner-balance', f'?date_to=2026-11-30&partner_id={self.riyadh.id}')
        self.assertEqual(one['totals']['total'], 345)

    # --- partner statement ------------------------------------------------------------------------------

    def test_the_activity_statement_lists_the_period_with_a_running_balance(self):
        query = f'?partner_id={self.partner.id}&date_from=2026-10-01&date_to=2026-10-31'
        statement = self._get('partner-statement', query)
        self.assertEqual((statement['type'], statement['kind']), ('activity', 'receivable'))
        self.assertEqual(statement['partner'], {'id': self.partner.id, 'name': 'Al Noor Trading'})
        block = statement['currencies'][0]
        self.assertEqual(block['currency'], 'SAR')
        self.assertEqual((block['balance_forward'], block['amount_due'], block['ending_balance']), (0, 750, 750))
        self.assertEqual(
            [(line['date'], line['debit'], line['credit'], line['balance']) for line in block['lines']],
            [('2026-10-18', 1150, 0, 1150), ('2026-10-19', 0, 400, 750)],
        )
        self.assertEqual(block['lines'][0]['date_due'], '2026-10-18')
        self.assertEqual(block['buckets']['total'], 750)

    def test_the_outstanding_statement_lists_the_open_items(self):
        statement = self._get('partner-statement', f'?partner_id={self.partner.id}&type=outstanding&date_to=2026-11-30')
        self.assertEqual((statement['type'], statement['date_from']), ('outstanding', None))
        block = statement['currencies'][0]
        self.assertEqual(len(block['lines']), 1)
        self.assertEqual(block['lines'][0]['open_amount'], 750)
        self.assertEqual((block['amount_due'], block['buckets']['days_31_60'], block['buckets']['total']), (750, 750, 750))

    def test_a_partner_without_items_has_an_empty_statement(self):
        quiet = self.env['res.partner'].create({'name': 'Quiet Customer'})
        for query in (f'?partner_id={quiet.id}&date_from=2026-10-01&date_to=2026-10-31', f'?partner_id={quiet.id}&type=outstanding&date_to=2026-10-31'):
            with self.subTest(query=query):
                statement = self._get('partner-statement', query)
                self.assertEqual((statement['partner']['id'], statement['currencies']), (quiet.id, []))

    def test_a_contact_of_a_company_has_no_statement(self):
        contact = self.env['res.partner'].create({'name': 'Accounts clerk', 'parent_id': self.partner.id})
        query = f'?partner_id={contact.id}&type=outstanding&date_to=2026-11-30'
        self.assertRefused(self.api('GET', f'{REPORTS}/partner-statement{query}'), 422, 'invalid', 'partner_id')

    def test_an_item_without_a_partner_is_aged_with_no_partner(self):
        self.entry('2026-10-01', [('102011', 100, 0), ('300001', 0, 100)])
        report = self._get('aged-partner-balance', '?date_to=2026-11-30')
        partners = {item['partner'] and item['partner']['name']: item for item in report['accounts'][0]['partners']}
        self.assertEqual(partners[None]['total'], 100)
        self.assertEqual(report['totals']['total'], 1195)

    def test_a_vendor_statement_uses_the_payable_account(self):
        statement = self._get(
            'partner-statement', f'?partner_id={self.vendor.id}&type=outstanding&kind=payable&date_to=2026-11-30',
        )
        self.assertEqual(statement['kind'], 'payable')
        self.assertEqual(statement['currencies'][0]['amount_due'], -460)

    # --- refusals ---------------------------------------------------------------------------------------

    def test_bad_queries_are_422_invalid(self):
        for path, query, field in (
            ('trial-balance', '', 'date_from'),
            ('trial-balance', YEAR + '&target_move=draft', 'target_move'),
            ('general-ledger', YEAR + '&account_id=x', 'account_id'),
            ('general-ledger', YEAR + '&limit=-1', 'limit'),
            ('general-ledger', YEAR + '&limit=5', 'account_id'),
            ('general-ledger', YEAR + '&offset=1', 'account_id'),
            ('aged-partner-balance', '', 'date_to'),
            ('aged-partner-balance', '?date_to=2026-11-30&kind=other', 'kind'),
            ('partner-statement', '?date_from=2026-10-01&date_to=2026-10-31', 'partner_id'),
            ('partner-statement', f'?partner_id={self.partner.id}&type=other', 'type'),
            ('partner-statement', f'?partner_id={self.partner.id}', 'date_from'),
            ('partner-statement', f'?partner_id={self.partner.id}&type=outstanding', 'date_to'),
        ):
            with self.subTest(path=path, query=query):
                result = self.api('GET', f'{REPORTS}/{path}{query}')
                self.assertRefused(result, 422, 'invalid', field)

    def test_records_of_another_company_are_422_on_their_field(self):
        other_account = self.account('101001', self.other_company)
        for path, query, field in (
            ('general-ledger', YEAR + f'&account_id={other_account.id}', 'account_id'),
            ('general-ledger', YEAR + f'&partner_id={self.foreign_partner.id}', 'partner_id'),
            ('aged-partner-balance', f'?date_to=2026-11-30&partner_id={self.foreign_partner.id}', 'partner_id'),
            ('partner-statement', f'?partner_id={self.foreign_partner.id}&date_from=2026-10-01&date_to=2026-10-31', 'partner_id'),
        ):
            with self.subTest(path=path):
                self.assertRefused(self.api('GET', f'{REPORTS}/{path}{query}'), 422, 'invalid', field)

    def test_the_reports_of_the_other_company_stay_out_of_the_figures(self):
        rows = self._by_code(self._get('trial-balance', YEAR))
        self.assertEqual(rows['102011']['debit'], 1150 + 345)
