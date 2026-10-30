# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from psycopg2 import IntegrityError

from odoo import Command
from odoo.exceptions import ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .write_common import PASSWORD, LiwanFinanceWriteCase

YEARS = '/api/v1/finance/fiscal-years'
REPORTS = '/api/v1/finance/reports'
END_2025 = date(2025, 12, 31)


class ClosingCase(LiwanFinanceWriteCase):

    @classmethod
    def _account(cls, company, account_type):
        return cls.env['account.account'].with_company(company).search([
            ('company_ids', 'in', company.id), ('account_type', '=', account_type),
        ], limit=1)

    @classmethod
    def _entry(cls, company, day, debit_account, credit_account, amount, post=True):
        entry = cls.env['account.move'].with_company(company).create({
            'move_type': 'entry', 'journal_id': cls._journal(company, 'general').id, 'date': day,
            'line_ids': [
                Command.create({'account_id': debit_account.id, 'debit': amount, 'name': 'x'}),
                Command.create({'account_id': credit_account.id, 'credit': amount, 'name': 'x'}),
            ],
        })
        if post:
            entry.action_post()
        return entry

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.income = cls._account(cls.company, 'income')
        cls.expense = cls._account(cls.company, 'expense')
        cls.cash = cls._account(cls.company, 'asset_current')
        cls.retained = cls._account(cls.company, 'equity_unaffected')
        # 2025: revenue 10,000 and expenses 6,000, a profit of 4,000.
        cls._entry(cls.company, '2025-03-10', cls.cash, cls.income, 10000)
        cls._entry(cls.company, '2025-06-10', cls.expense, cls.cash, 6000)
        cls._entry(cls.other_company, '2025-03-10', cls._account(cls.other_company, 'asset_current'),
                   cls._account(cls.other_company, 'income'), 777)

    def year_item(self, year):
        result = self.api('GET', YEARS)
        self.assertEqual(result.status_code, 200, result.text)
        return next(item for item in result.json()['items'] if item['year'] == year)

    def close(self, year=2025):
        return self.api('POST', f'{YEARS}/{year}/close', json={})

    def report(self, path, query):
        result = self.api('GET', f'{REPORTS}/{path}{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return {line['code']: line['value'] for line in result.json()['lines']}

    def balance(self, account, date_to=END_2025, company=None):
        lines = self.env['account.move.line'].search([
            ('company_id', '=', (company or self.company).id), ('parent_state', '=', 'posted'),
            ('account_id', '=', account.id), ('date', '<=', date_to),
        ])
        return sum(lines.mapped('balance'))


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceClosing(ClosingCase):

    def test_years_list_the_results_and_state(self):
        year = self.year_item(2025)
        self.assertEqual(
            (year['date_from'], year['date_to'], year['state'], year['result'], year['closing_entry']),
            ('2025-01-01', '2025-12-31', 'open', 4000, None),
        )
        self.assertEqual(self.year_item(2026)['result'], 1000)
        self.assertEqual(self.api('GET', YEARS).json()['total'], 2)

    def test_preview_shows_the_entry_without_writing_it(self):
        moves_before = self.env['account.move'].search_count([])
        result = self.api('GET', f'{YEARS}/2025/closing-preview')
        self.assertEqual(result.status_code, 200, result.text)
        preview = result.json()
        self.assertEqual(self.env['account.move'].search_count([]), moves_before)
        self.assertEqual((preview['date_to'], preview['result'], preview['blockers']), ('2025-12-31', 4000, []))
        self.assertEqual(preview['retained_earnings_account']['id'], self.retained.id)
        lines = {line['account']['id']: (line['debit'], line['credit']) for line in preview['lines']}
        self.assertEqual(lines, {
            self.income.id: (10000, 0), self.expense.id: (0, 6000), self.retained.id: (0, 4000),
        })
        self.assertEqual((preview['total_debit'], preview['total_credit']), (10000, 10000))

    def test_close_moves_the_result_to_retained_earnings_and_locks_the_year(self):
        result = self.close()
        self.assertEqual(result.status_code, 200, result.text)
        year = result.json()
        self.assertEqual((year['state'], year['result']), ('closed', 4000))
        entry = self.env['account.move'].browse(year['closing_entry']['id'])
        self.assertEqual((entry.state, entry.date, entry.ref), ('posted', END_2025, 'FYC/2025'))
        self.assertEqual(sum(entry.line_ids.mapped('debit')), sum(entry.line_ids.mapped('credit')))
        # The year's P&L accounts are zero, the result sits in retained earnings.
        self.assertEqual(self.balance(self.income), 0)
        self.assertEqual(self.balance(self.expense), 0)
        self.assertEqual(self.balance(self.retained), -4000)
        # The balance sheet still balances: the 4,000 of cash is matched by the 4,000 of equity.
        sheet = self.env['account.move.line'].search([
            ('company_id', '=', self.company.id), ('parent_state', '=', 'posted'), ('date', '<=', END_2025),
            ('account_id.internal_group', 'in', ('asset', 'liability', 'equity')),
        ])
        self.assertEqual(sum(sheet.mapped('balance')), 0)
        self.assertEqual(self.balance(self.cash), 4000)
        # The next year starts from zero on every P&L account; the lock date is the year end.
        self.assertEqual(self.balance(self.income, date(2026, 1, 1)), 0)
        self.assertEqual(self.company.fiscalyear_lock_date, END_2025)
        listed = self.year_item(2025)
        self.assertEqual((listed['state'], listed['result'], listed['closing_entry']['id']), ('closed', 4000, entry.id))
        self.assertEqual(self.year_item(2026)['result'], 1000)

    def test_reports_of_a_closed_year_keep_its_result_and_the_balance_sheet_balances(self):
        year, end = '?date_from=2025-01-01&date_to=2025-12-31', '?date_to=2025-12-31'
        profit_before = self.report('profit-loss', year)
        sheet_before = self.report('balance-sheet', end)
        zakat_before = self.report('zakat-base', end)
        self.assertEqual((profit_before['revenue'], profit_before['net_profit']), (10000, 4000))
        self.assertEqual(sheet_before['difference'], 0)
        self.assertEqual(self.close().status_code, 200)
        profit = self.report('profit-loss', year)
        self.assertEqual((profit['revenue'], profit['operating_expenses'], profit['net_profit']), (10000, 6000, 4000))
        self.assertEqual(profit, profit_before)
        self.assertEqual(self.report('zakat-base', end), zakat_before)
        sheet = self.report('balance-sheet', end)
        # The result moved from the current year to retained earnings; nothing is counted twice.
        self.assertEqual((sheet['difference'], sheet['current_year_earnings'], sheet['retained_earnings']), (0, 0, 4000))
        self.assertEqual(sheet['total_equity'], sheet_before['total_equity'])
        self.assertEqual(sheet['total_assets'], sheet_before['total_assets'])
        # 2026: no carried P&L (its own invoice only) and its sheet still balances.
        next_year = self.report('profit-loss', '?date_from=2026-01-01&date_to=2026-12-31')
        self.assertEqual((next_year['revenue'], next_year['net_profit']), (1000, 1000))
        later = self.report('balance-sheet', '?date_to=2026-12-31')
        self.assertEqual((later['difference'], later['retained_earnings'], later['current_year_earnings']), (0, 4000, 1000))

    def test_a_manual_entry_with_the_closing_ref_is_not_a_closing_entry(self):
        self.assertEqual(self.close().status_code, 200)
        service = self.env['liwan.finance.closing']
        self.assertEqual(len(service._liwan_closing_moves(self.company)), 1)
        self._entry(self.company, '2026-12-31', self.expense, self.cash, 50).ref = 'FYC/2026'
        self.assertEqual(len(service._liwan_closing_moves(self.company)), 1)
        self.assertEqual(len(service._liwan_closing_moves(self.other_company)), 0)
        # The spoofed entry still counts in the 2026 reports and in the year result.
        self.assertEqual(self.report('profit-loss', '?date_from=2026-01-01&date_to=2026-12-31')['operating_expenses'], 50)
        self.assertEqual(self.year_item(2026)['result'], 950)

    def test_the_closing_year_cannot_be_set_through_the_entry_routes(self):
        body = {
            'journal_id': self._journal(self.company, 'general').id, 'date': '2025-02-01', 'liwan_closing_year': 2025,
            'lines': [
                {'account_id': self.expense.id, 'name': 'x', 'debit': 1},
                {'account_id': self.cash.id, 'name': 'x', 'credit': 1},
            ],
        }
        self.assertRefused(self.api('POST', '/api/v1/finance/entries', json=body), 422, 'invalid', 'liwan_closing_year')

    def test_a_year_that_has_not_ended_is_refused_and_nothing_is_locked(self):
        for year in (date.today().year, 2999):
            with self.subTest(year=year):
                self.assertRefused(self.close(year), 422, 'year_not_ended')
        preview = self.api('GET', f'{YEARS}/2999/closing-preview').json()
        self.assertEqual(preview['blockers'][0]['code'], 'year_not_ended')
        self.assertFalse(self.company.fiscalyear_lock_date)

    def test_an_earlier_year_covered_by_a_lock_does_not_block_a_later_close(self):
        self._entry(self.company, '2024-05-01', self.cash, self.income, 300)
        patched = self.setup_api(
            'PATCH', '/api/v1/finance/setup/fiscal', user=self.manager, company=self.company,
            json={'fiscalyear_lock_date': '2024-12-31'},
        )
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(self.year_item(2024)['state'], 'locked')
        self.assertRefused(self.close(2024), 422, 'already_closed')
        self.assertEqual(self.close().status_code, 200)
        self.assertEqual((self.year_item(2025)['state'], self.year_item(2024)['closing_entry']), ('closed', None))

    def test_an_earlier_year_under_the_hard_lock_does_not_block_a_later_close(self):
        self._entry(self.company, '2024-05-01', self.cash, self.income, 300)
        self.company.hard_lock_date = date(2024, 12, 31)
        self.assertEqual(self.close().status_code, 200)

    def test_the_closing_entry_is_still_recognised_after_the_fiscal_year_end_changes(self):
        self.assertEqual(self.close().status_code, 200)
        self.company.write({'fiscalyear_last_day': 30, 'fiscalyear_last_month': '6'})
        self.assertEqual(len(self.env['liwan.finance.closing']._liwan_closing_moves(self.company, 2025)), 1)
        self.assertEqual(self.year_item(2025)['closing_entry']['id'], self.env['account.move'].search([('liwan_closing_year', '=', 2025)]).id)

    def test_closing_lines_carry_no_analytic_distribution(self):
        plan = self.env['account.analytic.plan'].create({'name': 'Closing plan'})
        analytic = self.env['account.analytic.account'].create({'name': 'Dept', 'plan_id': plan.id, 'company_id': self.company.id})
        for account in (self.income, self.expense, self.retained):
            self.env['account.analytic.distribution.model'].create({
                'account_prefix': account.code, 'analytic_distribution': {str(analytic.id): 100}, 'company_id': self.company.id,
            })
        self.assertEqual(self.close().status_code, 200)
        entry = self.env['account.move'].search([('liwan_closing_year', '=', 2025)])
        self.assertEqual(len(entry.line_ids), 3)
        self.assertFalse(any(entry.line_ids.mapped('analytic_distribution')))

    def test_an_archived_account_with_a_balance_blocks_the_close(self):
        self.expense.active = False
        preview = self.api('GET', f'{YEARS}/2025/closing-preview').json()
        blocker = next(item for item in preview['blockers'] if item['code'] == 'account_not_closable')
        self.assertEqual(blocker['details'], {'account_ids': [self.expense.id]})
        result = self.close()
        self.assertRefused(result, 422, 'account_not_closable')
        self.assertEqual(result.json()['details'], {'account_ids': [self.expense.id]})
        self.assertFalse(self.company.fiscalyear_lock_date)

    def test_an_account_with_a_forced_foreign_currency_blocks_the_close(self):
        usd = self.env.ref('base.USD')
        foreign = self.env['account.account'].with_company(self.company).create({
            'code': '599901', 'name': 'USD expenses', 'account_type': 'expense', 'currency_id': usd.id,
            'company_ids': [Command.link(self.company.id)],
        })
        self.env['account.move'].with_company(self.company).create({
            'move_type': 'entry', 'journal_id': self._journal(self.company, 'general').id, 'date': '2025-07-01',
            'line_ids': [
                Command.create({'account_id': foreign.id, 'name': 'x', 'currency_id': usd.id, 'amount_currency': 10, 'debit': 37.5}),
                Command.create({'account_id': self.cash.id, 'name': 'x', 'credit': 37.5}),
            ],
        }).action_post()
        preview = self.api('GET', f'{YEARS}/2025/closing-preview').json()
        blocker = next(item for item in preview['blockers'] if item['code'] == 'account_not_closable')
        self.assertEqual(blocker['details'], {'account_ids': [foreign.id]})
        self.assertRefused(self.close(), 422, 'account_not_closable')

    def test_a_second_close_and_a_preview_of_a_closed_year_are_refused(self):
        self.assertEqual(self.close().status_code, 200)
        entries = self.env['account.move'].search_count([('ref', '=', 'FYC/2025')])
        self.assertRefused(self.close(), 422, 'already_closed')
        self.assertRefused(self.api('GET', f'{YEARS}/2025/closing-preview'), 422, 'already_closed')
        self.assertEqual(self.env['account.move'].search_count([('ref', '=', 'FYC/2025')]), entries)

    def test_a_second_closing_entry_for_the_same_year_and_company_is_refused_by_the_database(self):
        entry = self.env['account.move'].browse(self.close().json()['closing_entry']['id'])
        self.assertEqual(entry.liwan_closing_year, 2025)
        duplicate = self._entry(self.company, '2025-12-30', self.expense, self.cash, 1)
        with self.assertRaises(IntegrityError), mute_logger('odoo.sql_db'), self.env.cr.savepoint():
            duplicate.liwan_closing_year = 2025
            duplicate.flush_recordset()
        # Another company and another year are not constrained.
        other = self._entry(self.other_company, '2025-12-30', self._account(self.other_company, 'expense'),
                            self._account(self.other_company, 'asset_current'), 1)
        other.liwan_closing_year = 2025
        duplicate.liwan_closing_year = 2024
        self.env['account.move'].flush_model()

    def test_the_close_leaves_a_log_record_and_audit_events(self):
        with self.assertLogs('odoo.addons.liwan_finance.controllers.finance_closing', 'INFO') as logs:
            year = self.close().json()
        entry = self.env['account.move'].browse(year['closing_entry']['id'])
        self.assertEqual(len(logs.records), 1)
        self.assertIn(
            f'finance.fiscal_year.closed company={self.company.id} year=2025 user={self.manager.id} entry={entry.id} state=closed',
            logs.output[0],
        )
        events = self.env['liwan.finance.audit.event'].search([('company_id', '=', self.company.id)])
        closed = events.filtered(lambda event: event.action == 'fiscal_year_closed')
        self.assertEqual((closed.res_model, closed.res_id, closed.outcome, closed.create_uid), ('account.move', entry.id, '2025:closed', self.manager))
        written = events.filtered(lambda event: event.action == 'company_written')
        self.assertEqual(written.fields_written, 'fiscalyear_lock_date')

    def test_a_concurrent_close_of_the_same_year_is_a_422_already_closed(self):
        # A closing entry the plan cannot see (a draft dated outside the year) holds the unique index.
        hidden = self._entry(self.company, '2024-01-01', self.expense, self.cash, 1, post=False)
        hidden.liwan_closing_year = 2025
        hidden.flush_recordset()
        self.assertRefused(self.close(), 422, 'already_closed')
        self.assertFalse(self.company.fiscalyear_lock_date)
        self.assertFalse(self.env['liwan.finance.audit.event'].search([('action', '=', 'fiscal_year_closed')]))

    def test_draft_entries_of_the_year_refuse_the_close(self):
        draft = self._entry(self.company, '2025-11-01', self.expense, self.cash, 5, post=False)
        result = self.close()
        self.assertRefused(result, 422, 'has_drafts')
        self.assertEqual(result.json()['details']['drafts'], 1)
        self.assertFalse(self.company.fiscalyear_lock_date)
        draft.unlink()
        self.assertEqual(self.close().status_code, 200)

    def test_an_earlier_open_year_must_be_closed_first(self):
        self._entry(self.company, '2024-05-01', self.cash, self.income, 300)
        self.assertRefused(self.close(), 422, 'previous_year_open')
        self.assertEqual(self.close(2024).status_code, 200)
        self.assertEqual(self.close().status_code, 200)
        self.assertEqual(self.balance(self.income), 0)

    def test_a_hard_locked_period_refuses_the_close(self):
        self.company.hard_lock_date = END_2025
        self.assertRefused(self.close(), 422, 'period_locked')
        self.assertFalse(self.company.fiscalyear_lock_date)

    def test_a_year_without_income_or_expense_is_only_locked(self):
        result = self.close(2020)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['state'], result.json()['result'], result.json()['closing_entry']), ('locked', 0, None))

    def test_a_loss_is_debited_to_retained_earnings(self):
        self._entry(self.company, '2025-09-01', self.expense, self.cash, 7000)
        preview = self.api('GET', f'{YEARS}/2025/closing-preview').json()
        retained = next(line for line in preview['lines'] if line['account']['id'] == self.retained.id)
        self.assertEqual((preview['result'], retained['debit'], retained['credit']), (-3000, 3000, 0))
        self.assertEqual(self.close().status_code, 200)
        self.assertEqual(self.balance(self.retained), 3000)

    def test_another_company_is_never_read_or_locked(self):
        self.assertEqual(self.year_item(2025)['result'], 4000)
        self.assertEqual(self.close().status_code, 200)
        self.assertFalse(self.other_company.fiscalyear_lock_date)
        self.assertFalse(self.env['account.move'].search_count([('company_id', '=', self.other_company.id), ('ref', '=', 'FYC/2025')]))
        self.assertEqual(self.balance(self._account(self.other_company, 'income'), company=self.other_company), -777)

    def test_year_out_of_range_is_invalid(self):
        self.assertRefused(self.close(1800), 422, 'invalid', 'year')
        self.assertRefused(self.api('GET', f'{YEARS}/3500/closing-preview'), 422, 'invalid', 'year')


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceClosingAccess(ClosingCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.user_with('finance_closing_reader', ['finance.closing.read'])
        cls.user_with('finance_closing_manager', ['finance.closing.read', 'finance.closing.manage', 'finance.setup.read', 'finance.setup.manage'])
        cls.user_with('finance_entries_only', ['finance.entries.read', 'finance.entries.manage', 'finance.entries.post'])

    def statuses(self, login, password=PASSWORD):
        self.authenticate(login, password)
        return {
            'list': self.api('GET', YEARS).status_code,
            'preview': self.api('GET', f'{YEARS}/2025/closing-preview').status_code,
            'close': self.close().status_code,
        }

    def test_403_matrix(self):
        self.assertEqual(self.statuses(OUTSIDER_LOGIN, OUTSIDER_PASSWORD), {'list': 403, 'preview': 403, 'close': 403})
        self.assertEqual(self.statuses('finance_entries_only'), {'list': 403, 'preview': 403, 'close': 403})
        self.assertEqual(self.statuses('finance_closing_reader'), {'list': 200, 'preview': 200, 'close': 403})
        self.assertFalse(self.company.fiscalyear_lock_date)
        self.assertEqual(self.statuses('finance_closing_manager'), {'list': 200, 'preview': 200, 'close': 200})
        self.assertEqual(self.company.fiscalyear_lock_date, END_2025)


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceClosingDependencies(ClosingCase):

    def test_closing_manage_needs_closing_read_and_setup_manage(self):
        dependencies = self.env['liwan.access.service']._liwan_permission_dependencies()
        self.assertGreaterEqual(dependencies['finance.closing.manage'], {'finance.closing.read', 'finance.setup.manage'})
        # A role cannot hold closing.manage without them.
        with self.assertRaises(ValidationError), self.cr.savepoint():
            self.user_with('finance_closing_no_setup', ['finance.closing.read', 'finance.closing.manage'])
