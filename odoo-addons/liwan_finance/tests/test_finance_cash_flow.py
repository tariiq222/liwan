# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .oca_common import REPORTS, LiwanFinanceOcaCase
from .write_common import PASSWORD

CASH_FLOW = f'{REPORTS}/cash-flow'
YEAR = 'date_from=2026-01-01&date_to=2026-12-31'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceCashFlow(LiwanFinanceOcaCase):

    def report(self, query=YEAR):
        result = self.api('GET', f'{CASH_FLOW}?{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def by_code(self, section):
        return {item['account']['code']: item['amount'] for item in section['items']}

    def test_the_statement_closes_against_the_cash_accounts(self):
        report = self.report()
        self.assertEqual((report['basis'], report['statutory'], report['currency']), ('indirect', False, 'SAR'))
        self.assertEqual((report['opening_cash'], report['closing_cash'], report['net_change']), (5000, 103000, 98000))
        self.assertEqual((report['difference'], report['total_change']), (0, 98000))
        parts = report['operating']['total'] + report['investing']['total'] + report['financing']['total']
        self.assertAlmostEqual(parts, report['net_change'], places=2)

    def test_each_section_names_the_accounts_behind_its_total(self):
        report = self.report()
        self.assertEqual(report['investing']['items'][0]['account']['code'], '106002')
        self.assertEqual(self.by_code(report['investing'])['106002'], -12000)
        self.assertEqual(report['investing']['total'], -12000)
        self.assertEqual(self.by_code(report['financing'])['300001'], 100000)
        operating_accounts = set(self.by_code(report['operating']))
        self.assertTrue({'202001', '201005'} & (operating_accounts | set(self.by_code(report['financing']))))
        self.assertEqual(set(report['operating']), {'net_income', 'adjustments', 'items', 'total'})

    def test_depreciation_is_added_back_and_taken_out_of_investing(self):
        profile = self.asset_profile(self.company)
        asset = self.env['account.asset'].with_company(self.company).create({
            'name': 'Table', 'profile_id': profile.id, 'purchase_value': 12000, 'date_start': '2026-01-01',
        })
        asset.validate()
        self.env['account.asset'].with_company(self.company).search([('id', '=', asset.id)])._compute_entries(date(2026, 12, 31), check_triggers=True)
        report = self.report()
        depreciation = report['operating']['adjustments']
        self.assertEqual([item['key'] for item in depreciation], ['depreciation'])
        self.assertGreater(depreciation[0]['amount'], 0)
        self.assertEqual(report['investing']['depreciation_reclass'], -depreciation[0]['amount'])
        self.assertEqual(report['difference'], 0)
        self.assertEqual(report['net_change'], 98000)

    def test_a_period_before_the_books_is_empty_and_a_later_one_starts_from_the_closing_cash(self):
        early = self.report('date_from=2024-01-01&date_to=2024-12-31')
        self.assertEqual((early['opening_cash'], early['closing_cash'], early['total_change'], early['difference']), (0, 0, 0, 0))
        later = self.report('date_from=2027-01-01&date_to=2027-12-31')
        self.assertEqual((later['opening_cash'], later['closing_cash'], later['net_change']), (103000, 103000, 0))

    def test_other_company_books_are_not_included(self):
        self.env['account.move'].with_company(self.other_company).create({
            'move_type': 'entry', 'date': '2026-03-01', 'journal_id': self._journal(self.other_company, 'general').id,
            'line_ids': [
                (0, 0, {'account_id': self.account('101001', self.other_company).id, 'debit': 777, 'credit': 0, 'name': 'x'}),
                (0, 0, {'account_id': self.account('500001', self.other_company).id, 'debit': 0, 'credit': 777, 'name': 'x'}),
            ],
        }).action_post()
        self.assertEqual(self.report()['net_change'], 98000)

    def test_bad_queries_and_capability(self):
        for query, field in (('', 'date_from'), ('date_from=2026-01-01', 'date_to'), ('date_from=2026-12-31&date_to=2026-01-01', 'date_to'), ('date_from=x&date_to=2026-01-01', 'date_from')):
            with self.subTest(query=query):
                self.assertRefused(self.api('GET', f'{CASH_FLOW}?{query}'), 422, 'invalid', field)
        self.user_with('plain_reader', ['finance.reports.read'])
        self.authenticate('plain_reader', PASSWORD)
        self.assertRefused(self.api('GET', f'{CASH_FLOW}?{YEAR}'), 403, 'forbidden')
