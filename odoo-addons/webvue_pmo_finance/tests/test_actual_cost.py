# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tests import tagged

from .common import PmoFinanceCase

LINE_KEYS = {'id', 'date', 'label', 'reference', 'partner', 'amount', 'record'}
EXTERNAL_KEYS = ('actual_source', 'actual_account', 'can_read_actual_lines', 'can_choose_actual_account')


@tagged('post_install', '-at_install', 'webvue')
class TestActualCost(PmoFinanceCase):

    def test_totals_count_posted_expense_items_of_the_cost_center_only(self):
        self.login_as(self.reader)
        summary = self.get_ok(self.summary_url())
        # 1000 + 60% of 2000 - 200 + 50; the draft bill, the sale and the Riyadh share are left out.
        self.assertEqual((summary['actual'], summary['expense_count']), (2050, 4))
        self.assertEqual(
            {key: summary[key] for key in EXTERNAL_KEYS},
            {
                'actual_source': 'external',
                'actual_account': {'id': self.alpha.id, 'name': 'Alpha', 'code': None},
                'can_read_actual_lines': False,
                'can_choose_actual_account': False,
            },
        )

    def test_a_cost_center_without_items_is_external_with_zero_actual(self):
        self.login_as(self.reader)
        summary = self.get_ok(self.summary_url(self.other_project))
        self.assertEqual(
            (summary['actual'], summary['expense_count'], summary['actual_source']), (0, 0, 'external'),
        )
        self.assertEqual(summary['actual_account']['id'], self.beta.id)

    def test_a_project_without_a_cost_center_is_external_with_nothing_yet(self):
        self.login_as(self.reader)
        summary = self.get_ok(self.summary_url(self.manual_project))
        self.assertEqual(
            {key: summary[key] for key in EXTERNAL_KEYS},
            {'actual_source': 'external', 'actual_account': None,
             'can_read_actual_lines': False, 'can_choose_actual_account': False},
        )
        self.assertEqual((summary['actual'], summary['expense_count']), (0, 0))
        self.login_as(self.owner)
        self.assertTrue(self.get_ok(self.summary_url(self.manual_project))['can_choose_actual_account'])

    def test_a_project_without_a_cost_center_takes_no_manual_expense_and_has_no_lines(self):
        self.login_as(self.owner)
        refused = self.api('POST', f'/api/v1/projects/{self.manual_project.id}/finance', {
            'kind': 'expense', 'title': 'Taxi', 'amount': 10, 'expense_date': '2026-10-20',
        })
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'))
        self.assertEqual(self.get_ok(self.lines_url(project=self.manual_project)), {'items': [], 'total': 0})

    def test_the_report_rows_use_one_total_per_project(self):
        self.login_as(self.reader)
        rows = {row['project']['id']: row['finance'] for row in self.get_ok('/api/v1/reports/projects/analytics')['projects']}
        self.assertEqual((rows[self.project.id]['actual'], rows[self.project.id]['actual_source']), (2050, 'external'))
        self.assertEqual(rows[self.other_project.id]['actual_source'], 'external')
        self.assertEqual(
            (rows[self.manual_project.id]['actual_source'], rows[self.manual_project.id]['actual']), ('external', 0),
        )
        totals = self.get_ok('/api/v1/reports/projects/analytics')['totals'][0]
        self.assertEqual(totals['actual'], 2050)

    def test_the_flags_follow_the_finance_capabilities(self):
        self.login_as(self.line_reader)
        summary = self.get_ok(self.summary_url())
        self.assertEqual((summary['can_read_actual_lines'], summary['can_choose_actual_account']), (True, False))
        self.login_as(self.project_manager)
        summary = self.get_ok(self.summary_url())
        self.assertEqual((summary['can_read_actual_lines'], summary['can_choose_actual_account']), (False, False))
        self.login_as(self.owner)
        summary = self.get_ok(self.summary_url())
        self.assertEqual((summary['can_read_actual_lines'], summary['can_choose_actual_account']), (True, True))

    def test_lines_need_the_finance_capability(self):
        self.login_as(self.reader)
        refused = self.api('GET', self.lines_url())
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'))
        self.login_as(self.line_reader)
        body = self.get_ok(self.lines_url())
        self.assertEqual(body['total'], 4)
        self.assertEqual(sorted(item['amount'] for item in body['items']), [-200, 50, 1000, 1200])
        dates = [item['date'] for item in body['items']]
        self.assertEqual(dates, sorted(dates, reverse=True))
        self.assertTrue(all(set(item) == LINE_KEYS for item in body['items']))
        by_amount = {item['amount']: item for item in body['items']}
        self.assertEqual(by_amount[1000]['label'], 'Cost')
        self.assertEqual(by_amount[1000]['partner'], {'id': self.vendor.id, 'name': 'Gulf Supplies'})
        self.assertEqual(by_amount[1000]['date'], fields.Date.to_string(self.bill.date))
        self.assertEqual(by_amount[1000]['record'], {'kind': 'finance-bill', 'id': self.bill.id})
        self.assertEqual(by_amount[1200]['record'], {'kind': 'finance-bill', 'id': self.split_bill.id})
        self.assertEqual(by_amount[-200]['record'], {'kind': 'finance-refund', 'id': self.refund.id})
        self.assertEqual(by_amount[50]['record'], {'kind': 'finance-entry', 'id': self.entry.id})
        page = self.get_ok(self.lines_url('?limit=2&offset=1'))
        self.assertEqual((page['total'], page['items']), (4, body['items'][1:3]))

    def test_customer_documents_on_an_expense_account_are_linked_by_their_kind(self):
        invoice = self._document('out_invoice', {self.beta: 100}, 300)
        credit_note = self._document('out_refund', {self.beta: 100}, 100)
        self.login_as(self.line_reader)
        body = self.get_ok(self.lines_url(project=self.other_project))
        self.assertEqual(
            sorted((item['record']['kind'], item['record']['id']) for item in body['items']),
            sorted([('finance-invoice', invoice.id), ('finance-credit-note', credit_note.id)]),
        )
        # A credit on an expense account is a negative cost: 100 - 300 on the cost center of the other project.
        self.assertEqual(self.get_ok(self.summary_url(self.other_project))['actual'], -200)

    def test_a_net_refund_makes_actual_and_utilization_negative(self):
        self._document('in_refund', {self.beta: 100}, 200)
        self.login_as(self.owner)
        budget = self.api('POST', f'/api/v1/projects/{self.other_project.id}/finance', {
            'kind': 'budget', 'title': 'Plan', 'amount': 1000,
        })
        self.assertEqual(budget.status_code, 201, budget.text)
        summary = self.get_ok(self.summary_url(self.other_project))
        self.assertEqual(
            (summary['planned'], summary['actual'], summary['remaining'], summary['utilization_percent']),
            (1000, -200, 1200, -20),
        )
        self.assertFalse(summary['over_budget'])
        analytics = self.get_ok('/api/v1/reports/projects/analytics')
        row = next(item for item in analytics['projects'] if item['project']['id'] == self.other_project.id)
        self.assertEqual((row['finance']['actual'], row['finance']['utilization_percent']), (-200, -20))
        self.assertEqual(analytics['totals'][0]['actual'], 2050 - 200)

    def test_manual_expenses_are_switched_off_while_the_project_has_a_cost_center(self):
        self.login_as(self.owner)
        base = f'/api/v1/projects/{self.project.id}/finance'
        budget = self.api('POST', base, {'kind': 'budget', 'title': 'Plan', 'amount': 5000})
        self.assertEqual(budget.status_code, 201, budget.text)
        expense = {'kind': 'expense', 'title': 'Taxi', 'amount': 10, 'expense_date': '2026-10-20'}
        refused = self.api('POST', base, expense)
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'))
        listed = self.get_ok(base)
        self.assertEqual([item['kind'] for item in listed['items']], ['budget'])
        self.assertEqual((listed['summary']['planned'], listed['summary']['actual']), (5000, 2050))
        self.assertEqual(listed['summary']['remaining'], 2950)
        # Unlinking the cost center does not bring manual expenses back: only switching finance off does.
        self.assertEqual(self.api('PATCH', self.account_url(), {'account_id': None}).status_code, 200)
        self.assertEqual(self.api('POST', base, expense).status_code, 422)

    def test_a_withdrawn_finance_keeps_the_totals_but_nothing_can_change(self):
        self.switch_finance(False, retained=True)
        self.login_as(self.owner)
        summary = self.get_ok(self.summary_url())
        self.assertEqual((summary['actual_source'], summary['actual']), ('external', 2050))
        self.assertEqual((summary['can_read_actual_lines'], summary['can_choose_actual_account']), (True, False))
        self.assertEqual(self.api('PATCH', self.account_url(), {'account_id': self.riyadh.id}).status_code, 404)

    def test_manual_returns_when_finance_is_switched_off(self):
        self.switch_finance(False)
        self.login_as(self.owner)
        summary = self.get_ok(self.summary_url())
        self.assertEqual(
            {key: summary[key] for key in EXTERNAL_KEYS},
            {'actual_source': 'manual', 'actual_account': None,
             'can_read_actual_lines': False, 'can_choose_actual_account': False},
        )
        self.assertEqual(summary['actual'], 0)
        self.assertEqual(self.api('GET', self.lines_url()).status_code, 404)
        self.assertEqual(self.api('PATCH', self.account_url(), {'account_id': self.alpha.id}).status_code, 404)
        self.assertEqual(self.get_ok(self.summary_url(self.manual_project))['actual_source'], 'manual')
        created = self.api('POST', f'/api/v1/projects/{self.project.id}/finance', {
            'kind': 'expense', 'title': 'Taxi', 'amount': 10, 'expense_date': '2026-10-20',
        })
        self.assertEqual(created.status_code, 201, created.text)
