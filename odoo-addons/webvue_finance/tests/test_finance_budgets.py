# Part of Odoo. See LICENSE file for full copyright and licensing details.
from urllib.parse import urlencode

from odoo import Command
from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .oca_common import WebVueFinanceOcaCase
from .write_common import PASSWORD
from odoo.addons.webvue_api.tests.common import set_probe_feature

BUDGETS = '/api/v1/finance/budgets'
REPORT = '/api/v1/finance/reports/budget-vs-actual'
YEAR = {'date_from': '2026-01-01', 'date_to': '2026-12-31'}


def with_query(path, **params):
    return f'{path}?{urlencode(params)}'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceBudgets(WebVueFinanceOcaCase):
    """Budgets by account over OCA mis_builder_budget: 10000 budgeted on an expense account, 7500 posted."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        accounts = cls.env['account.account'].with_company(cls.company)
        cls.expense = accounts.create({'code': '600901', 'name': 'Budgeted expense', 'account_type': 'expense'})
        cls.income = accounts.create({'code': '500901', 'name': 'Budgeted income', 'account_type': 'income'})
        cls.other_expense = cls.env['account.account'].with_company(cls.other_company).create({
            'code': '600902', 'name': 'Foreign expense', 'account_type': 'expense',
        })
        plan = cls.env['account.analytic.plan'].create({'name': 'Budget plan'})
        cls.analytic = cls.env['account.analytic.account'].create({
            'name': 'Riyadh branch', 'plan_id': plan.id, 'company_id': cls.company.id,
        })
        cls.analytic_b = cls.env['account.analytic.account'].create({
            'name': 'Jeddah branch', 'plan_id': plan.id, 'company_id': cls.company.id,
        })
        cls.other_analytic = cls.env['account.analytic.account'].create({
            'name': 'Foreign branch', 'plan_id': plan.id, 'company_id': cls.other_company.id,
        })
        cls.foreign_budget = cls.env['mis.budget.by.account'].create({
            'name': 'Foreign budget', **YEAR, 'company_id': cls.other_company.id,
        })
        cls.read_user = cls.user_with('finance_budgets_reader', ['finance.budgets.read'])
        cls.manage_user = cls.user_with('finance_budgets_manager', ['finance.budgets.manage', 'finance.budgets.read'])

    # --- helpers ---------------------------------------------------------------------------------------

    def create_budget(self, **overrides):
        result = self.api('POST', BUDGETS, json={'name': 'Budget 2026', **YEAR, **overrides})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def add_line(self, budget, account, amount, **overrides):
        result = self.api('POST', f'{BUDGETS}/{budget["id"]}/lines', json={'account_id': account.id, 'amount': amount, **overrides})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def report(self, budget, **query):
        result = self.api('GET', with_query(REPORT, budget_id=budget['id'], **query))
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def post_expense(self, day, amount, analytic=None, distribution=None):
        move = self.env['account.move'].with_company(self.company).create({
            'move_type': 'entry', 'date': day, 'journal_id': self._journal(self.company, 'general').id,
            'line_ids': [
                Command.create({
                    'account_id': self.expense.id, 'debit': amount, 'credit': 0, 'name': 'cost',
                    'analytic_distribution': distribution or ({str(analytic.id): 100} if analytic else False),
                }),
                Command.create({'account_id': self.account('101001').id, 'debit': 0, 'credit': amount, 'name': 'cost'}),
            ],
        })
        move.action_post()
        return move

    def row(self, report, account):
        return next(line for line in report['lines'] if line['account']['id'] == account.id)

    # --- budget versus actual --------------------------------------------------------------------------

    def test_an_expense_budget_of_10000_with_7500_posted_leaves_2500(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 10000)
        self.post_expense('2026-03-01', 7500)
        report = self.report(budget)
        self.assertEqual(set(report), {'budget', 'date_from', 'date_to', 'currency', 'target_move', 'lines', 'totals'})
        self.assertEqual((report['currency'], report['target_move'], report['date_to']), ('SAR', 'posted', '2026-12-31'))
        row = self.row(report, self.expense)
        self.assertEqual(
            {key: row[key] for key in ('budget', 'actual', 'variance', 'variance_percent')},
            {'budget': 10000, 'actual': 7500, 'variance': 2500, 'variance_percent': 25.0},
        )
        self.assertEqual((row['nature'], row['favorable']), ('debit', True))
        self.assertEqual(report['totals'], {
            'debit': {'budget': 10000, 'actual': 7500, 'variance': 2500, 'variance_percent': 25.0},
            'credit': {'budget': 0, 'actual': 0, 'variance': 0, 'variance_percent': None},
            'net': {'budget': -10000, 'actual': -7500},
        })

    def test_closing_a_year_leaves_its_budget_actuals_unchanged(self):
        year = {'date_from': '2025-01-01', 'date_to': '2025-12-31'}
        budget = self.create_budget(name='Budget 2025', **year)
        self.add_line(budget, self.expense, 10000)
        analytic_budget = self.create_budget(name='Riyadh 2025', **year)
        self.add_line(analytic_budget, self.expense, 10000, analytic_account_id=self.analytic.id)
        self.post_expense('2025-03-01', 7500, self.analytic)
        self.assertEqual(self.row(self.report(budget), self.expense)['actual'], 7500)
        closed = self.api('POST', '/api/v1/finance/fiscal-years/2025/close', json={})
        self.assertEqual(closed.status_code, 200, closed.text)
        closing = self.env['account.move'].browse(closed.json()['closing_entry']['id'])
        self.assertTrue(closing.webvue_closing_year)
        # The closing entry zeroes the expense account, yet the actual still reads the activity of the year.
        self.assertEqual(self.row(self.report(budget), self.expense)['actual'], 7500)
        self.assertEqual(self.row(self.report(analytic_budget), self.expense)['actual'], 7500)

    def test_an_overspent_budget_has_a_negative_variance(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 1000)
        self.post_expense('2026-03-01', 1250)
        row = self.row(self.report(budget), self.expense)
        self.assertEqual((row['variance'], row['variance_percent'], row['favorable']), (-250, -25.0, False))

    def test_only_posted_entries_count(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 10000)
        self.post_expense('2026-03-01', 7500)
        self.env['account.move'].with_company(self.company).create({
            'move_type': 'entry', 'date': '2026-03-02', 'journal_id': self._journal(self.company, 'general').id,
            'line_ids': [
                Command.create({'account_id': self.expense.id, 'debit': 900, 'credit': 0}),
                Command.create({'account_id': self.account('101001').id, 'debit': 0, 'credit': 900}),
            ],
        })
        self.assertEqual(self.row(self.report(budget), self.expense)['actual'], 7500)

    def test_an_income_budget_reads_in_the_credit_direction(self):
        budget = self.create_budget()
        line = self.add_line(budget, self.income, 5000)
        self.assertEqual(line['amount'], 5000)
        self.entry('2026-02-01', [('101001', 4000, 0), ('500901', 0, 4000)])
        row = self.row(self.report(budget), self.income)
        self.assertEqual((row['budget'], row['actual'], row['variance'], row['variance_percent']), (5000, 4000, 1000, 20.0))
        # An income line under its target is not favorable.
        self.assertEqual((row['nature'], row['favorable'], line['nature']), ('credit', False, 'credit'))
        totals = self.report(budget)['totals']
        self.assertEqual((totals['credit']['actual'], totals['debit']['actual'], totals['net']['actual']), (4000, 0, 4000))
        self.assertEqual(self.env['mis.budget.by.account.item'].browse(line['id']).credit, 5000)

    def test_the_report_follows_date_to_and_prorates_the_budget(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 36500)
        self.post_expense('2026-02-10', 1000)
        self.post_expense('2026-09-10', 2000)
        report = self.report(budget, date_to='2026-06-30')
        self.assertEqual(report['date_to'], '2026-06-30')
        row = self.row(report, self.expense)
        # 181 of the 365 days of the line have passed: 36500 x 181 / 365.
        self.assertEqual((row['budget'], row['actual'], row['variance']), (18100, 1000, 17100))
        before = self.row(self.report(budget, date_to='2025-12-31'), self.expense)
        self.assertEqual((before['budget'], before['actual'], before['variance_percent']), (0, 0, None))

    def test_a_line_with_no_budget_has_no_percentage(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 0)
        self.post_expense('2026-03-01', 100)
        row = self.row(self.report(budget), self.expense)
        self.assertEqual((row['budget'], row['actual'], row['variance'], row['variance_percent']), (0, 100, -100, None))

    def test_an_analytic_line_counts_only_its_own_analytic_account(self):
        budget = self.create_budget()
        line = self.add_line(budget, self.expense, 1000, analytic_account_id=self.analytic.id)
        self.assertEqual(line['analytic_account'], {'id': self.analytic.id, 'name': 'Riyadh branch'})
        self.post_expense('2026-03-01', 300, analytic=self.analytic)
        self.post_expense('2026-03-02', 450)
        row = self.row(self.report(budget), self.expense)
        self.assertEqual((row['actual'], row['variance']), (300, 700))
        self.assertEqual(row['analytic_account']['id'], self.analytic.id)

    def test_an_income_over_target_and_an_expense_under_budget_are_favorable_and_never_summed(self):
        budget = self.create_budget()
        self.add_line(budget, self.income, 1000)
        self.add_line(budget, self.expense, 1000)
        self.entry('2026-02-01', [('101001', 1200, 0), ('500901', 0, 1200)])
        self.post_expense('2026-03-01', 400)
        report = self.report(budget)
        self.assertTrue(all(line['favorable'] for line in report['lines']))
        self.assertEqual(report['totals']['credit']['variance'], -200)
        self.assertEqual(report['totals']['debit']['variance'], 600)
        self.assertEqual(report['totals']['net'], {'budget': 0, 'actual': 800})

    def test_a_split_analytic_distribution_counts_its_own_share(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 1000, analytic_account_id=self.analytic.id)
        self.post_expense('2026-03-01', 1000, distribution={str(self.analytic.id): 50, str(self.analytic_b.id): 50})
        row = self.row(self.report(budget), self.expense)
        self.assertEqual((row['budget'], row['actual'], row['variance'], row['variance_percent']), (1000, 500, 500, 50.0))
        other = self.create_budget(name='Jeddah')
        self.add_line(other, self.expense, 1000, analytic_account_id=self.analytic_b.id)
        self.assertEqual(self.row(self.report(other), self.expense)['actual'], 500)

    def test_the_report_is_in_the_order_of_the_lines(self):
        budget = self.create_budget()
        income = self.add_line(budget, self.income, 100)
        expense = self.add_line(budget, self.expense, 200)
        self.assertEqual([line['id'] for line in self.report(budget)['lines']], [income['id'], expense['id']])

    def test_the_report_validates_its_query(self):
        self.assertRefused(self.api('GET', REPORT), 422, 'invalid', 'budget_id')
        self.assertRefused(self.api('GET', with_query(REPORT, budget_id='x')), 422, 'invalid', 'budget_id')
        budget = self.create_budget()
        self.assertRefused(self.api('GET', with_query(REPORT, budget_id=budget['id'], date_to='2026-13-01')), 422, 'invalid', 'date_to')
        self.assertRefused(self.api('GET', with_query(REPORT, budget_id=999999999)), 404, 'not_found')

    # --- budgets and lines -----------------------------------------------------------------------------

    def test_a_budget_is_created_listed_and_read_with_its_lines(self):
        budget = self.create_budget(description='Annual plan')
        self.assertEqual(
            {key: budget[key] for key in ('name', 'description', 'state', 'date_from', 'date_to', 'currency', 'line_count', 'lines')},
            {'name': 'Budget 2026', 'description': 'Annual plan', 'state': 'draft', 'date_from': '2026-01-01',
             'date_to': '2026-12-31', 'currency': 'SAR', 'line_count': 0, 'lines': []},
        )
        line = self.add_line(budget, self.expense, 2500.5, label='Paper', date_from='2026-02-01', date_to='2026-03-31')
        self.assertIn('Budgeted expense', line['account']['name'])
        self.assertEqual(
            line,
            {'id': line['id'], 'account': {'id': self.expense.id, 'name': line['account']['name']}, 'nature': 'debit',
             'analytic_account': None,
             'label': 'Paper', 'date_from': '2026-02-01', 'date_to': '2026-03-31', 'amount': 2500.5},
        )
        detail = self.api('GET', f'{BUDGETS}/{budget["id"]}').json()
        self.assertEqual((detail['line_count'], detail['lines']), (1, [line]))
        listing = self.api('GET', with_query(BUDGETS, q='budget 2026')).json()
        self.assertEqual(set(listing), {'items', 'total'})
        self.assertIn(budget['id'], [item['id'] for item in listing['items']])
        self.assertNotIn('lines', listing['items'][0])
        self.assertEqual(self.api('GET', with_query(BUDGETS, state='confirmed')).json()['total'], 0)
        self.assertRefused(self.api('GET', with_query(BUDGETS, state='nope')), 422, 'invalid', 'state')

    def test_a_line_defaults_to_the_period_of_the_budget(self):
        budget = self.create_budget()
        line = self.add_line(budget, self.expense, 10)
        self.assertEqual((line['date_from'], line['date_to']), ('2026-01-01', '2026-12-31'))

    def test_a_draft_budget_can_be_edited_and_its_lines_changed(self):
        budget = self.create_budget()
        line = self.add_line(budget, self.expense, 100)
        patched = self.api('PATCH', f'{BUDGETS}/{budget["id"]}', json={'name': 'Plan', 'date_to': '2027-06-30'}).json()
        self.assertEqual((patched['name'], patched['date_to']), ('Plan', '2027-06-30'))
        result = self.api('PATCH', f'{BUDGETS}/{budget["id"]}/lines/{line["id"]}', json={'amount': 300, 'label': 'Rent'})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['amount'], result.json()['label']), (300, 'Rent'))
        # Moving the line to an income account keeps the amount and books it as a credit.
        moved = self.api('PATCH', f'{BUDGETS}/{budget["id"]}/lines/{line["id"]}', json={'account_id': self.income.id}).json()
        self.assertEqual((moved['account']['id'], moved['amount']), (self.income.id, 300))
        item = self.env['mis.budget.by.account.item'].browse(line['id'])
        self.assertEqual((item.debit, item.credit), (0, 300))
        cleared = self.api('PATCH', f'{BUDGETS}/{budget["id"]}/lines/{line["id"]}', json={'analytic_account_id': self.analytic.id}).json()
        self.assertEqual(cleared['analytic_account']['id'], self.analytic.id)
        cleared = self.api('PATCH', f'{BUDGETS}/{budget["id"]}/lines/{line["id"]}', json={'analytic_account_id': None}).json()
        self.assertIsNone(cleared['analytic_account'])
        deleted = self.api('DELETE', f'{BUDGETS}/{budget["id"]}/lines/{line["id"]}')
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.api('GET', f'{BUDGETS}/{budget["id"]}').json()['line_count'], 0)

    def test_the_budget_period_cannot_leave_a_line_outside(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 100)
        self.assertRefused(self.api('PATCH', f'{BUDGETS}/{budget["id"]}', json={'date_to': '2026-06-30'}), 422, 'invalid', 'date_from')
        self.assertRefused(self.api('PATCH', f'{BUDGETS}/{budget["id"]}', json={'date_from': '2027-01-01'}), 422, 'invalid', 'date_to')

    # --- validation ------------------------------------------------------------------------------------

    def test_a_budget_body_is_validated(self):
        base = {'name': 'B', **YEAR}
        cases = (
            ({'date_from': YEAR['date_from'], 'date_to': YEAR['date_to']}, 'name'),
            ({**base, 'name': '  '}, 'name'),
            ({**base, 'name': 5}, 'name'),
            ({'name': 'B', 'date_from': '2026-01-01'}, 'date_to'),
            ({**base, 'date_to': '2025-12-31'}, 'date_to'),
            ({**base, 'date_from': '01/01/2026'}, 'date_from'),
            ({**base, 'state': 'confirmed'}, 'state'),
        )
        for body, field in cases:
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', BUDGETS, json=body), 422, 'invalid', field)
        # A payload company_id outside the pinned request set is the uniform not-found.
        self.assertRefused(
            self.api('POST', BUDGETS, json={**base, 'company_id': self.other_company.id}), 404, 'not_found',
        )
        budget = self.create_budget()
        self.assertRefused(self.api('PATCH', f'{BUDGETS}/{budget["id"]}', json={}), 422, 'invalid')
        self.assertRefused(self.api('PATCH', f'{BUDGETS}/{budget["id"]}', json={'state': 'confirmed'}), 422, 'invalid', 'state')

    def test_a_line_body_is_validated(self):
        budget = self.create_budget()
        url = f'{BUDGETS}/{budget["id"]}/lines'
        base = {'account_id': self.expense.id, 'amount': 10}
        cases = (
            ({'amount': 10}, 'account_id'),
            ({'account_id': self.expense.id}, 'amount'),
            ({**base, 'amount': -1}, 'amount'),
            ({**base, 'amount': '10'}, 'amount'),
            ({**base, 'amount': True}, 'amount'),
            ({**base, 'account_id': 'x'}, 'account_id'),
            ({**base, 'account_id': self.other_expense.id}, 'account_id'),
            ({**base, 'account_id': 999999999}, 'account_id'),
            ({**base, 'analytic_account_id': self.other_analytic.id}, 'analytic_account_id'),
            ({**base, 'date_from': '2025-12-31'}, None),
            ({**base, 'date_from': '2026-05-01', 'date_to': '2026-04-01'}, None),
            ({**base, 'debit': 5}, 'debit'),
        )
        for body, field in cases:
            with self.subTest(body=body):
                result = self.api('POST', url, json=body)
                self.assertEqual(result.status_code, 422, result.text)
                self.assertEqual(result.json()['code'], 'invalid')
                if field:
                    self.assertEqual(result.json().get('field'), field)
        self.assertEqual(self.api('GET', f'{BUDGETS}/{budget["id"]}').json()['line_count'], 0)

    def test_two_lines_of_one_account_cannot_overlap(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 10, date_from='2026-01-01', date_to='2026-06-30')
        result = self.api('POST', f'{BUDGETS}/{budget["id"]}/lines', json={
            'account_id': self.expense.id, 'amount': 10, 'date_from': '2026-06-30', 'date_to': '2026-12-31',
        })
        self.assertRefused(result, 422, 'invalid')
        self.add_line(budget, self.expense, 10, date_from='2026-07-01', date_to='2026-12-31')

    # --- states ----------------------------------------------------------------------------------------

    def test_a_confirmed_budget_is_frozen_until_it_is_reset_to_draft(self):
        budget = self.create_budget()
        line = self.add_line(budget, self.expense, 100)
        confirmed = self.api('POST', f'{BUDGETS}/{budget["id"]}/confirm', json={})
        self.assertEqual((confirmed.status_code, confirmed.json()['state']), (200, 'confirmed'))
        line_url = f'{BUDGETS}/{budget["id"]}/lines/{line["id"]}'
        for method, url, body in (
            ('PATCH', f'{BUDGETS}/{budget["id"]}', {'name': 'x'}),
            ('POST', f'{BUDGETS}/{budget["id"]}/lines', {'account_id': self.income.id, 'amount': 1}),
            ('PATCH', line_url, {'amount': 5}),
            ('DELETE', line_url, None),
            ('POST', f'{BUDGETS}/{budget["id"]}/confirm', {}),
        ):
            with self.subTest(method=method, url=url):
                self.assertRefused(self.api(method, url, json=body), 422, 'not_draft')
        self.assertEqual(self.report(budget)['lines'][0]['budget'], 100)
        reset = self.api('POST', f'{BUDGETS}/{budget["id"]}/reset-to-draft', json={})
        self.assertEqual(reset.json()['state'], 'draft')
        self.assertEqual(self.api('PATCH', line_url, json={'amount': 5}).status_code, 200)

    def test_a_budget_is_cancelled_and_reopened(self):
        budget = self.create_budget()
        self.assertRefused(self.api('POST', f'{BUDGETS}/{budget["id"]}/reset-to-draft', json={}), 422, 'invalid_state')
        cancelled = self.api('POST', f'{BUDGETS}/{budget["id"]}/cancel', json={})
        self.assertEqual(cancelled.json()['state'], 'cancelled')
        self.assertRefused(self.api('POST', f'{BUDGETS}/{budget["id"]}/cancel', json={}), 422, 'invalid_state')
        self.assertRefused(self.api('POST', f'{BUDGETS}/{budget["id"]}/confirm', json={}), 422, 'not_draft')
        self.assertRefused(self.api('POST', f'{BUDGETS}/{budget["id"]}/lines', json={'account_id': self.expense.id, 'amount': 1}), 422, 'not_draft')
        self.assertEqual(self.api('POST', f'{BUDGETS}/{budget["id"]}/reset-to-draft', json={}).json()['state'], 'draft')
        self.assertEqual(self.api('POST', f'{BUDGETS}/{budget["id"]}/confirm', json={}).json()['state'], 'confirmed')
        self.assertEqual(self.api('POST', f'{BUDGETS}/{budget["id"]}/cancel', json={}).json()['state'], 'cancelled')

    # --- company isolation -----------------------------------------------------------------------------

    def test_another_company_budget_is_not_found_everywhere(self):
        url = f'{BUDGETS}/{self.foreign_budget.id}'
        foreign_line = self.env['mis.budget.by.account.item'].create({
            'budget_id': self.foreign_budget.id, 'account_id': self.other_expense.id, 'debit': 5,
            'date_from': '2026-01-01', 'date_to': '2026-12-31', 'company_id': self.other_company.id,
        })
        for method, route, body in (
            ('GET', url, None),
            ('PATCH', url, {'name': 'x'}),
            ('POST', f'{url}/confirm', {}),
            ('POST', f'{url}/cancel', {}),
            ('POST', f'{url}/reset-to-draft', {}),
            ('POST', f'{url}/lines', {'account_id': self.expense.id, 'amount': 1}),
            ('PATCH', f'{url}/lines/{foreign_line.id}', {'amount': 1}),
            ('DELETE', f'{url}/lines/{foreign_line.id}', None),
        ):
            with self.subTest(method=method, route=route):
                self.assertRefused(self.api(method, route, json=body), 404, 'not_found')
        self.assertRefused(self.api('GET', with_query(REPORT, budget_id=self.foreign_budget.id)), 404, 'not_found')
        self.assertNotIn(self.foreign_budget.id, [item['id'] for item in self.api('GET', BUDGETS).json()['items']])
        self.assertEqual(self.foreign_budget.item_ids.debit, 5)

    def test_a_line_of_another_budget_is_not_found_through_this_one(self):
        mine = self.create_budget()
        other = self.create_budget(name='Other')
        line = self.add_line(other, self.expense, 10)
        self.assertRefused(self.api('PATCH', f'{BUDGETS}/{mine["id"]}/lines/{line["id"]}', json={'amount': 1}), 404, 'not_found')
        self.assertRefused(self.api('DELETE', f'{BUDGETS}/{mine["id"]}/lines/{line["id"]}'), 404, 'not_found')

    # --- access ----------------------------------------------------------------------------------------

    def _routes(self):
        budget = self.create_budget()
        line = self.add_line(budget, self.expense, 10)
        url = f'{BUDGETS}/{budget["id"]}'
        reads = (('GET', BUDGETS, None), ('GET', url, None), ('GET', f'{REPORT}?budget_id={budget["id"]}', None))
        writes = (
            ('POST', BUDGETS, {}), ('PATCH', url, {}), ('POST', f'{url}/confirm', {}), ('POST', f'{url}/cancel', {}),
            ('POST', f'{url}/reset-to-draft', {}), ('POST', f'{url}/lines', {}),
            ('PATCH', f'{url}/lines/{line["id"]}', {}), ('DELETE', f'{url}/lines/{line["id"]}', None),
        )
        return reads, writes

    def test_the_read_capability_reads_but_never_writes(self):
        reads, writes = self._routes()
        self.authenticate(self.read_user.login, PASSWORD)
        for method, route, body in reads:
            with self.subTest(route=route):
                self.assertEqual(self.api(method, route, json=body).status_code, 200)
        for method, route, body in writes:
            with self.subTest(method=method, route=route):
                self.assertRefused(self.api(method, route, json=body), 403, 'forbidden')

    def test_the_manage_capability_opens_the_writes(self):
        reads, writes = self._routes()
        self.authenticate(self.manage_user.login, PASSWORD)
        for method, route, body in (*reads, *writes):
            with self.subTest(method=method, route=route):
                self.assertNotEqual(self.api(method, route, json=body).status_code, 403)

    def test_a_user_without_the_capabilities_and_other_finance_capabilities_are_refused(self):
        reads, writes = self._routes()
        self.user_with('finance_budgets_not_granted', ['finance.reports.read', 'finance.statements.read', 'finance.accounts.read'])
        for login, password in ((OUTSIDER_LOGIN, OUTSIDER_PASSWORD), ('finance_budgets_not_granted', PASSWORD)):
            self.authenticate(login, password)
            for method, route, body in (*reads, *writes):
                with self.subTest(login=login, method=method, route=route):
                    self.assertRefused(self.api(method, route, json=body), 403, 'forbidden')

    def test_the_manager_role_holds_both_capabilities(self):
        role = self.env.ref('webvue_finance.role_finance_manager')
        self.assertLessEqual({'finance.budgets.read', 'finance.budgets.manage'}, set(role.permission_ids.mapped('key')))
        dependencies = self.env['webvue.access.service']._webvue_permission_dependencies()
        self.assertIn('finance.budgets.read', dependencies['finance.budgets.manage'])

    def test_a_closed_feature_refuses_every_route(self):
        reads, writes = self._routes()
        set_probe_feature(self, key='finance.enabled', enabled=False)
        for method, route, body in (*reads, *writes):
            with self.subTest(method=method, route=route):
                self.assertEqual(self.api(method, route, json=body).status_code, 403)

    # --- path keys -------------------------------------------------------------------------------------

    def test_a_body_key_named_like_a_path_key_is_refused(self):
        budget = self.create_budget()
        line = self.add_line(budget, self.expense, 10)
        url = f'{BUDGETS}/{budget["id"]}'
        self.assertRefused(self.api('POST', f'{url}/lines', json={'account_id': self.income.id, 'amount': 1, 'budget_id': 999}), 422, 'invalid', 'budget_id')
        self.assertRefused(self.api('PATCH', url, json={'name': 'x', 'budget_id': 999}), 422, 'invalid', 'budget_id')
        self.assertRefused(self.api('PATCH', f'{url}/lines/{line["id"]}', json={'amount': 1, 'line_id': 999}), 422, 'invalid', 'line_id')
        self.assertRefused(self.api('PATCH', f'{url}/lines/{line["id"]}', json={'amount': 1, 'budget_id': 999}), 422, 'invalid', 'budget_id')
        self.assertEqual(self.api('GET', url).json()['line_count'], 1)

    # --- the ORM enforces the same rules ---------------------------------------------------------------

    def orm_budget(self, **values):
        return self.env['mis.budget.by.account'].with_company(self.company).create({
            'name': 'ORM', **YEAR, 'company_id': self.company.id, **values,
        })

    def orm_item(self, budget, **values):
        return self.env['mis.budget.by.account.item'].create({
            'budget_id': budget.id, 'account_id': self.expense.id, 'debit': 5, 'company_id': self.company.id, **YEAR, **values,
        })

    def test_the_orm_refuses_line_changes_unless_the_budget_is_a_draft(self):
        budget = self.orm_budget()
        item = self.orm_item(budget)
        budget.action_confirm()
        message = 'only be changed while it is a draft'
        with self.assertRaisesRegex(UserError, message):
            self.orm_item(budget, account_id=self.income.id)
        with self.assertRaisesRegex(UserError, message):
            item.write({'debit': 9})
        with self.assertRaisesRegex(UserError, message):
            item.unlink()
        budget.action_cancel()
        with self.assertRaisesRegex(UserError, message):
            item.write({'debit': 9})
        budget.action_draft()
        item.write({'debit': 9})
        self.assertEqual(item.debit, 9)

    def test_the_orm_refuses_moving_a_line_into_a_frozen_budget(self):
        draft = self.orm_budget()
        frozen = self.orm_budget(name='Frozen')
        item = self.orm_item(draft)
        frozen.action_confirm()
        with self.assertRaisesRegex(UserError, 'draft'):
            item.write({'budget_id': frozen.id})

    def test_the_orm_follows_the_state_matrix(self):
        budget = self.orm_budget()
        with self.assertRaisesRegex(UserError, 'cannot be changed this way'):
            budget.action_draft()
        budget.action_confirm()
        with self.assertRaisesRegex(UserError, 'cannot be changed this way'):
            budget.action_confirm()
        budget.action_cancel()
        with self.assertRaisesRegex(UserError, 'cannot be changed this way'):
            budget.action_cancel()
        with self.assertRaisesRegex(UserError, 'cannot be changed this way'):
            budget.action_confirm()
        budget.action_draft()
        self.assertEqual(budget.state, 'draft')

    def test_a_copy_of_a_confirmed_budget_is_a_draft_with_its_lines(self):
        budget = self.orm_budget()
        self.orm_item(budget)
        budget.action_confirm()
        copy = budget.copy()
        self.assertEqual((copy.state, len(copy.item_ids)), ('draft', 1))

    def test_the_orm_gives_the_read_capability_no_write_and_the_manage_capability_write(self):
        budget = self.orm_budget()
        item = self.orm_item(budget)
        reader_budgets = self.env['mis.budget.by.account'].with_user(self.read_user)
        reader_items = self.env['mis.budget.by.account.item'].with_user(self.read_user)
        self.assertEqual(reader_budgets.browse(budget.id).name, 'ORM')
        with self.assertRaises(AccessError):
            reader_budgets.create({'name': 'x', **YEAR, 'company_id': self.company.id})
        with self.assertRaises(AccessError):
            reader_budgets.browse(budget.id).write({'name': 'x'})
        with self.assertRaises(AccessError):
            reader_budgets.browse(budget.id).unlink()
        with self.assertRaises(AccessError):
            reader_items.create({'budget_id': budget.id, 'account_id': self.expense.id, 'debit': 1, **YEAR})
        with self.assertRaises(AccessError):
            reader_items.browse(item.id).write({'debit': 1})
        with self.assertRaises(AccessError):
            reader_items.browse(item.id).unlink()
        manager_budget = self.env['mis.budget.by.account'].with_user(self.manage_user).browse(budget.id)
        manager_item = self.env['mis.budget.by.account.item'].with_user(self.manage_user).browse(item.id)
        manager_budget.check_access('write')
        manager_item.check_access('write')
        manager_item.check_access('unlink')

    # --- cost center split (OCA's overlap switch, guarded so an account is never counted twice) ----------

    def distribute(self, budget, **overrides):
        body = {
            'account_id': self.expense.id, 'amount': 10000,
            'shares': [{'analytic_account_id': self.analytic.id, 'percent': 60}, {'analytic_account_id': self.analytic_b.id, 'percent': 40}],
            **overrides,
        }
        return self.api('POST', f'{BUDGETS}/{budget["id"]}/lines/distribute', json=body)

    def test_the_budget_of_an_account_is_split_between_two_cost_centers(self):
        budget = self.create_budget()
        result = self.distribute(budget)
        self.assertEqual(result.status_code, 201, result.text)
        body = result.json()
        self.assertEqual(body['total'], 2)
        self.assertEqual(
            sorted((line['analytic_account']['id'], line['amount']) for line in body['items']),
            sorted([(self.analytic.id, 6000), (self.analytic_b.id, 4000)]),
        )
        self.assertTrue(self.api('GET', f'{BUDGETS}/{budget["id"]}').json()['cost_center_split'])
        self.post_expense('2026-03-01', 1500, analytic=self.analytic)
        self.post_expense('2026-03-02', 500, analytic=self.analytic_b)
        report = self.report(budget)
        figures = {line['analytic_account']['id']: (line['budget'], line['actual']) for line in report['lines']}
        self.assertEqual(figures, {self.analytic.id: (6000, 1500), self.analytic_b.id: (4000, 500)})
        self.assertEqual(report['totals']['debit']['budget'], 10000)

    def test_the_rounding_difference_goes_to_the_largest_share_so_the_lines_add_up(self):
        budget = self.create_budget()
        shares = [{'analytic_account_id': self.analytic.id, 'percent': 33.33}, {'analytic_account_id': self.analytic_b.id, 'percent': 66.67}]
        amounts = sorted(line['amount'] for line in self.distribute(budget, amount=100.01, shares=shares).json()['items'])
        self.assertEqual(round(sum(amounts), 2), 100.01)

    def test_two_lines_of_one_account_and_cost_center_still_cannot_share_a_period(self):
        budget = self.create_budget(cost_center_split=True)
        self.add_line(budget, self.expense, 100, analytic_account_id=self.analytic.id)
        for extra in ({'analytic_account_id': self.analytic.id}, {}):
            result = self.api('POST', f'{BUDGETS}/{budget["id"]}/lines', json={'account_id': self.expense.id, 'amount': 5, **extra})
            self.assertRefused(result, 422, 'cost_center_overlap', 'analytic_account_id')
        self.add_line(budget, self.expense, 50, analytic_account_id=self.analytic_b.id)
        other_period = self.api('POST', f'{BUDGETS}/{budget["id"]}/lines', json={
            'account_id': self.expense.id, 'amount': 5, 'date_from': '2026-01-01', 'date_to': '2026-01-31', 'analytic_account_id': self.analytic.id,
        })
        self.assertRefused(other_period, 422, 'cost_center_overlap')

    def test_without_the_split_the_overlap_rule_of_the_engine_stays(self):
        budget = self.create_budget()
        self.add_line(budget, self.expense, 100, analytic_account_id=self.analytic.id)
        result = self.api('POST', f'{BUDGETS}/{budget["id"]}/lines', json={'account_id': self.expense.id, 'amount': 5, 'analytic_account_id': self.analytic_b.id})
        self.assertEqual(result.status_code, 422, result.text)
        self.assertFalse(self.api('GET', f'{BUDGETS}/{budget["id"]}').json()['cost_center_split'])
        patched = self.api('PATCH', f'{BUDGETS}/{budget["id"]}', json={'cost_center_split': True})
        self.assertTrue(patched.json()['cost_center_split'])

    def test_distribution_refusals(self):
        budget = self.create_budget()
        good = [{'analytic_account_id': self.analytic.id, 'percent': 50}, {'analytic_account_id': self.analytic_b.id, 'percent': 50}]
        for change, field in (
            ({'shares': good[:1]}, 'shares'),
            ({'shares': [good[0], {**good[1], 'percent': 40}]}, 'shares'),
            ({'shares': [good[0], {**good[0]}]}, 'shares'),
            ({'shares': [good[0], {'analytic_account_id': self.other_analytic.id, 'percent': 50}]}, 'analytic_account_id'),
            ({'shares': [good[0], {**good[1], 'percent': 0}]}, 'shares[1].percent'),
            ({'shares': 'x'}, 'shares'),
            ({'amount': -1}, 'amount'),
            ({'account_id': self.other_expense.id}, 'account_id'),
            ({'colour': 1}, 'colour'),
        ):
            with self.subTest(change=change):
                self.assertRefused(self.distribute(budget, **{'shares': good, **change}), 422, 'invalid', field)
        self.assertEqual(self.api('GET', f'{BUDGETS}/{budget["id"]}').json()['line_count'], 0)

    def test_a_confirmed_budget_cannot_be_distributed(self):
        budget = self.create_budget()
        self.api('POST', f'{BUDGETS}/{budget["id"]}/confirm')
        self.assertRefused(self.distribute(budget), 422, 'not_draft')
