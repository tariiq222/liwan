# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .oca_common import REPORTS, LiwanFinanceOcaCase
from .write_common import PASSWORD

YEAR = '?date_from=2026-01-01&date_to=2026-12-31'
END = '?date_to=2026-12-31'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceMisCompanyIsolation(LiwanFinanceOcaCase):
    """Each MIS report evaluates only the authenticated user's current company books."""

    @staticmethod
    def _figures(report):
        return {line['code']: line['value'] for line in report['lines']}

    def _report(self, path, query):
        result = self.api('GET', f'{REPORTS}/{path}{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def _assert_company_report_lines(self, response, expected_markers, forbidden_markers):
        self.assertTrue(response['lines'])
        codes = []
        for line in response['lines']:
            self.assertEqual(set(line), {'code', 'label', 'value'})
            self.assertTrue(line['code'])
            self.assertTrue(line['label'])
            self.assertIsInstance(line['value'], (int, float))
            codes.append(line['code'])
        self.assertEqual(len(codes), len(set(codes)))
        serialized = str(response)
        for marker in expected_markers:
            self.assertIn(str(marker), serialized)
        for marker in forbidden_markers:
            self.assertNotIn(str(marker), serialized)

    def _posted_account_codes(self, company):
        lines = self.env['account.move.line'].search([
            ('company_id', '=', company.id), ('parent_state', '=', 'posted'),
        ])
        return set(lines.mapped('account_id.code'))

    def _assert_no_foreign_account_lines(self, report, foreign_only_codes):
        figures = self._figures(report)
        for code in foreign_only_codes:
            self.assertTrue(code not in figures or figures[code] == 0, f'Foreign posted account code {code} leaked')

    def _company_b_manager(self):
        user = new_test_user(
            self.env, login='finance_mis_company_b', password=PASSWORD, name='Company B Finance Manager',
            groups='liwan_core.group_employee', company_id=self.other_company.id,
            company_ids=[Command.set(self.other_company.ids)],
        )
        self.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': self.env.ref('liwan_finance.role_finance_manager').id, 'company_id': self.other_company.id,
        }])
        return user

    def test_profit_loss_uses_only_the_current_company(self):
        # Both companies have distinct income entries; each report must retain its own fixture and entry amounts.
        self.entry('2026-11-01', [('101001', 7300, 0), ('500001', 0, 7300)])
        other_income = self.account('500001', self.other_company)
        self.env['account.move'].with_company(self.other_company).create({
            'move_type': 'entry', 'date': '2026-11-01', 'journal_id': self._journal(self.other_company, 'general').id,
            'line_ids': [
                (0, 0, {'account_id': self.account('101001', self.other_company).id, 'debit': 9100, 'credit': 0, 'name': 'Other-company revenue'}),
                (0, 0, {'account_id': other_income.id, 'debit': 0, 'credit': 9100, 'name': 'Other-company revenue'}),
            ],
        }).action_post()

        codes_a = self._posted_account_codes(self.env.company)
        codes_b = self._posted_account_codes(self.other_company)
        report_a = self._report('profit-loss', YEAR)
        self._assert_no_foreign_account_lines(report_a, codes_b - codes_a)
        figures_a = self._figures(report_a)
        self.assertEqual((figures_a['revenue'], figures_a['net_profit']), (8600, 8200))
        self._assert_company_report_lines(report_a, [8600, 8200], ['Other-company revenue', 9100, 10100])
        self._company_b_manager()
        self.authenticate('finance_mis_company_b', PASSWORD)
        report_b = self._report('profit-loss', YEAR)
        self._assert_no_foreign_account_lines(report_b, codes_a - codes_b)
        figures_b = self._figures(report_b)
        self.assertEqual((figures_b['revenue'], figures_b['net_profit']), (10100, 10100))
        self._assert_company_report_lines(report_b, [10100], ['Company A', 7300, 8600, 8200])

    def test_balance_sheet_uses_only_the_current_company(self):
        other_liability = self.account('202001', self.other_company)
        self.entry('2026-11-03', [('101001', 6400, 0), ('201005', 0, 6400)])
        self.env['account.move'].with_company(self.other_company).create({
            'move_type': 'entry', 'date': '2026-11-03', 'journal_id': self._journal(self.other_company, 'general').id,
            'line_ids': [
                (0, 0, {'account_id': self.account('101001', self.other_company).id, 'debit': 12500, 'credit': 0, 'name': 'Other-company liability'}),
                (0, 0, {'account_id': other_liability.id, 'debit': 0, 'credit': 12500, 'name': 'Other-company liability'}),
            ],
        }).action_post()

        codes_a = self._posted_account_codes(self.env.company)
        codes_b = self._posted_account_codes(self.other_company)
        report_a = self._report('balance-sheet', END)
        self._assert_no_foreign_account_lines(report_a, codes_b - codes_a)
        figures_a = self._figures(report_a)
        self.assertEqual((figures_a['total_assets'], figures_a['total_liabilities']), (122955, 17055))
        self._assert_company_report_lines(report_a, [122955, 17055], ['Other-company liability', 12500, 13650, 12650])
        self._company_b_manager()
        self.authenticate('finance_mis_company_b', PASSWORD)
        report_b = self._report('balance-sheet', END)
        self._assert_no_foreign_account_lines(report_b, codes_a - codes_b)
        figures_b = self._figures(report_b)
        self.assertEqual((figures_b['total_assets'], figures_b['total_liabilities']), (13650, 12650))
        self._assert_company_report_lines(report_b, [13650, 12650, 12500], ['Other-company liability', 6400, 122955, 17055])

    def test_zakat_base_and_adjustments_are_company_isolated(self):
        self.api('POST', '/api/v1/finance/zakat/adjustments', json={
            'date_to': '2026-12-31', 'kind': 'deduct', 'label': 'Company A only', 'amount': 3100,
        })
        codes_a = self._posted_account_codes(self.env.company)
        codes_b = self._posted_account_codes(self.other_company)
        company_a = self._report('zakat-base', END)
        self._assert_no_foreign_account_lines(company_a, codes_b - codes_a)
        self.assertEqual((company_a['template_base'], company_a['adjustments_total'], company_a['base']), (103900, -3100, 100800))
        self.assertEqual(len(company_a['adjustments']), 1)
        self.assertEqual(company_a['adjustments'][0]['label'], 'Company A only')
        self.assertEqual(company_a['adjustments'][0]['amount'], 3100)
        self.assertEqual(company_a['adjustments'][0]['kind'], 'deduct')
        self._assert_company_report_lines(company_a, [3100, -3100, 103900, 100800], ['Company B only', 9999])

        self._company_b_manager()
        self.authenticate('finance_mis_company_b', PASSWORD)
        company_b = self._report('zakat-base', END)
        self._assert_no_foreign_account_lines(company_b, codes_a - codes_b)
        self.assertEqual((company_b['template_base'], company_b['adjustments_total'], company_b['base']), (1000, 0, 1000))
        self.assertEqual(company_b['adjustments'], [])
        self._assert_company_report_lines(company_b, [1000], ['Company A only', 3100, -3100, 103900, 100800])
        self.assertNotEqual(company_a['base'], company_b['base'])
