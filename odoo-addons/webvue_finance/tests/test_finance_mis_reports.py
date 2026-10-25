# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .oca_common import REPORTS, WebVueFinanceOcaCase

YEAR = '?date_from=2026-01-01&date_to=2026-12-31'
END = '?date_to=2026-12-31'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceMisReports(WebVueFinanceOcaCase):
    """Profit and loss, balance sheet and the Zakat base: MIS Builder templates over the books of ``oca_common``."""

    def _get(self, path, query):
        result = self.api('GET', f'{REPORTS}/{path}{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _figures(self, report):
        for line in report['lines']:
            self.assertEqual(set(line), {'code', 'label', 'value'})
        return {line['code']: line['value'] for line in report['lines']}

    # --- profit and loss -------------------------------------------------------------------------------

    def test_the_profit_and_loss_of_the_year(self):
        report = self._get('profit-loss', YEAR)
        self.assertEqual(set(report), {'date_from', 'date_to', 'target_move', 'currency', 'statutory', 'status', 'lines'})
        self.assertEqual((report['currency'], report['target_move']), ('SAR', 'posted'))
        self.assertEqual((report['statutory'], report['status']), (False, 'management_information'))
        figures = self._figures(report)
        self.assertEqual(figures['revenue'], 1300)
        # The bill's expense lands on the journal's default account, the cost of goods sold.
        self.assertEqual((figures['cost_of_revenue'], figures['gross_profit']), (400, 900))
        self.assertEqual((figures['operating_expenses'], figures['operating_profit'], figures['net_profit']), (0, 900, 900))
        self.assertEqual([line['code'] for line in report['lines']][:3], ['revenue', 'cost_of_revenue', 'gross_profit'])

    def test_the_profit_and_loss_follows_the_period(self):
        sales_day = self._figures(self._get('profit-loss', '?date_from=2026-10-01&date_to=2026-10-18'))
        self.assertEqual((sales_day['revenue'], sales_day['cost_of_revenue'], sales_day['net_profit']), (1300, 0, 1300))
        bill_days = self._figures(self._get('profit-loss', '?date_from=2026-10-19&date_to=2026-10-31'))
        self.assertEqual((bill_days['revenue'], bill_days['cost_of_revenue'], bill_days['net_profit']), (0, 400, -400))
        previous_year = self._figures(self._get('profit-loss', '?date_from=2025-01-01&date_to=2025-12-31'))
        self.assertEqual((previous_year['revenue'], previous_year['net_profit']), (5000, 5000))

    def test_the_profit_and_loss_counts_every_entry_on_request(self):
        self.entry('2026-11-01', [('400016', 50, 0), ('101001', 0, 50)])
        self.env['account.move'].with_company(self.company).create({
            'move_type': 'entry', 'date': '2026-11-02', 'journal_id': self._journal(self.company, 'general').id,
            'line_ids': [
                (0, 0, {'account_id': self.account('400016').id, 'debit': 7, 'credit': 0}),
                (0, 0, {'account_id': self.account('101001').id, 'debit': 0, 'credit': 7}),
            ],
        })
        posted = self._figures(self._get('profit-loss', YEAR))
        every = self._figures(self._get('profit-loss', YEAR + '&target_move=all'))
        self.assertEqual((posted['operating_expenses'], every['operating_expenses']), (50, 57))

    # --- balance sheet ---------------------------------------------------------------------------------

    def test_the_balance_sheet_balances_with_the_earnings_of_every_year(self):
        report = self._get('balance-sheet', END)
        self.assertEqual(set(report), {'date_to', 'target_move', 'currency', 'statutory', 'status', 'lines'})
        self.assertEqual((report['statutory'], report['status']), (False, 'management_information'))
        figures = self._figures(report)
        self.assertEqual(
            (figures['cash'], figures['receivables'], figures['current_assets'], figures['fixed_assets']),
            (103000, 1095, 460, 12000),
        )
        self.assertEqual(figures['total_assets'], 116555)
        self.assertEqual(
            (figures['payables'], figures['current_liabilities'], figures['non_current_liabilities'], figures['total_liabilities']),
            (460, 2195, 8000, 10655),
        )
        self.assertEqual(
            (figures['equity'], figures['retained_earnings'], figures['current_year_earnings'], figures['total_equity']),
            (100000, 5000, 900, 105900),
        )
        self.assertEqual((figures['total_liabilities_and_equity'], figures['difference']), (116555, 0))

    def test_the_balance_sheet_of_an_earlier_date_leaves_out_later_entries(self):
        figures = self._figures(self._get('balance-sheet', '?date_to=2026-06-30'))
        self.assertEqual((figures['cash'], figures['receivables'], figures['current_year_earnings']), (103000, 0, 0))
        self.assertEqual((figures['total_assets'], figures['total_equity'], figures['difference']), (115000, 105000, 0))

    # --- Zakat base ------------------------------------------------------------------------------------

    def test_the_zakat_base_adds_equity_and_long_term_funds_and_deducts_fixed_assets(self):
        report = self._get('zakat-base', END)
        self.assertEqual(set(report), {
            'date_to', 'target_move', 'currency', 'lines', 'template_base', 'adjustments', 'adjustments_total', 'base', 'rate',
            'zakat_due', 'status', 'filed', 'review', 'disclaimer',
        })
        figures = self._figures(report)
        self.assertEqual(
            (figures['equity'], figures['retained_earnings'], figures['long_term_liabilities'], figures['provisions']),
            (100000, 5000, 8000, 2000),
        )
        self.assertEqual((figures['net_profit'], figures['profit_addbacks'], figures['adjusted_net_profit']), (900, 0, 900))
        self.assertEqual((figures['total_additions'], figures['total_deductions']), (115900, 12000))
        self.assertEqual(report['base'], 103900)
        self.assertAlmostEqual(report['rate'], 0.025 * 365 / 354, places=6)
        self.assertEqual(report['zakat_due'], round(103900 * 0.025 * 365 / 354, 2))
        self.assertEqual(figures['zakat_base'], report['base'])
        self.assertIn('Saudi certified public accountant', report['disclaimer'])
        self.assertIn('365/354', report['disclaimer'])

    def test_the_zakat_expense_is_added_back_to_the_profit(self):
        self.entry('2026-12-01', [('400072', 300, 0), ('101001', 0, 300)])
        report = self._get('zakat-base', END)
        figures = self._figures(report)
        self.assertEqual((figures['net_profit'], figures['profit_addbacks'], figures['adjusted_net_profit']), (600, 300, 900))
        self.assertEqual(report['base'], 103900)

    def test_a_negative_base_owes_no_zakat(self):
        self.entry('2026-12-02', [('106002', 200000, 0), ('300001', 0, 1), ('101001', 0, 199999)])
        report = self._get('zakat-base', END)
        self.assertEqual(report['base'], 103900 + 1 - 200000)
        self.assertEqual(report['zakat_due'], 0)

    def test_a_year_without_entries_is_all_zero(self):
        report = self._get('zakat-base', '?date_to=2024-12-31')
        self.assertEqual((report['base'], report['zakat_due']), (0, 0))
        self.assertTrue(all(isinstance(line['value'], int | float) for line in report['lines']))

    # --- refusals --------------------------------------------------------------------------------------

    def test_bad_queries_are_422_invalid(self):
        for path, query, field in (
            ('profit-loss', '', 'date_from'),
            ('profit-loss', '?date_from=2026-02-01&date_to=2026-01-01', 'date_to'),
            ('profit-loss', YEAR + '&target_move=draft', 'target_move'),
            ('balance-sheet', '', 'date_to'),
            ('balance-sheet', '?date_to=31/12/2026', 'date_to'),
            ('zakat-base', '', 'date_to'),
        ):
            with self.subTest(path=path, query=query):
                self.assertRefused(self.api('GET', f'{REPORTS}/{path}{query}'), 422, 'invalid', field)
