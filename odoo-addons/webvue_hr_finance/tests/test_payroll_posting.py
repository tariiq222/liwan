# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import RUNS, PayrollFinanceCase

MONTH = '2026-11'
PAYROLL_READ = ('hr.payroll.read', 'hr.employees.read')
POSTING = ('finance.entries.read', 'finance.entries.manage', 'finance.entries.post')
PREVIEW_KEYS = {'entry_detail', 'date', 'journal', 'lines', 'debit', 'credit', 'warnings'}
PREVIEW_LINE_KEYS = {'account', 'analytic_account', 'employee', 'debit', 'credit'}


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollPosting(PayrollFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dept_a = cls.make_department('Posting A')
        cls.dept_b = cls.make_department('Posting B')
        cls.env['webvue.hr.payroll.cost.center'].create({
            'company_id': cls.company.id, 'department_id': cls.dept_a.id, 'analytic_account_id': cls.riyadh.id,
        })
        cls.e1 = cls.make_employee('Posting E1', cls.dept_a)
        cls.e2 = cls.make_employee('Posting E2', cls.dept_b)
        cls.e2.version_id.country_id = cls.env.ref('base.eg')
        cls.env['webvue.hr.compensation'].search([('employee_id', '=', cls.e2.id)]).write({
            'basic_wage': 6000, 'housing_allowance': 1500, 'transport_allowance': 500,
        })
        cls.settings = cls.full_settings()
        cls.settings.default_analytic_account_id = cls.jeddah
        cls.poster = cls.user_with('pp_poster', [*PAYROLL_READ, *POSTING])

    def _post(self, run_id, user=None):
        self.login_as(user or self.poster)
        return self.api('POST', f'{RUNS}/{run_id}/post')

    def _posted(self, month=MONTH, **inputs):
        """Approve a run of ``month`` (with ``inputs`` on E1's payslip) and post it; the posted move."""
        run = self._approved_run_with(month, **inputs)
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 200, res.text)
        return res.json(), self.env['account.move'].browse(res.json()['finance']['entry_id'])

    def _approved_run_with(self, month, **inputs):
        if not inputs:
            return self._approved_run([self.e1, self.e2], month)
        self.login_as(self.payroll_officer)
        run_id = self.api('POST', RUNS, json={'month': month}).json()['id']
        slip = next(
            row for row in self.api('GET', f'{RUNS}/{run_id}/payslips').json()['items']
            if row['employee']['id'] == self.e1.id
        )
        patched = self.api('PATCH', f"{RUNS}/{run_id}/payslips/{slip['id']}/inputs", json=inputs)
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/compute').status_code, 200)
        self.login_as(self.payroll_approver)
        approved = self.api('POST', f'{RUNS}/{run_id}/approve')
        self.assertEqual(approved.status_code, 200, approved.text)
        return approved.json()

    @staticmethod
    def _amounts(move, account):
        return sorted((line.debit, line.credit) for line in move.line_ids if line.account_id == account)

    def _line(self, move, role, analytic=None, partner=None):
        lines = move.line_ids.filtered(lambda line: line.account_id == self.accounts[role])
        if analytic:
            lines = lines.filtered(lambda line: line.analytic_distribution == {str(analytic.id): 100})
        if partner:
            lines = lines.filtered(lambda line: line.partner_id == partner.work_contact_id)
        self.assertEqual(len(lines), 1, f'{role}: {lines}')
        return lines

    def test_aggregated_entry_is_balanced_with_analytic_split(self):
        run, move = self._posted()
        self.assertEqual(run['state'], 'posted')
        self.assertEqual(move.state, 'posted')
        self.assertEqual(move.date, date(2026, 11, 30))
        self.assertEqual(move.journal_id, self.general_journal)
        self.assertEqual(move.ref, MONTH)
        self.assertEqual(move.webvue_payroll_origin, 'run')
        self.assertEqual(len(move.line_ids), 8)
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh).debit, 10000.00)
        self.assertEqual(self._line(move, 'basic_expense', self.jeddah).debit, 6000.00)
        self.assertEqual(self._line(move, 'allowance_expense', self.riyadh).debit, 3500.00)
        self.assertEqual(self._line(move, 'allowance_expense', self.jeddah).debit, 2000.00)
        self.assertEqual(self._line(move, 'gosi_expense', self.riyadh).debit, 1468.75)
        self.assertEqual(self._line(move, 'gosi_expense', self.jeddah).debit, 150.00)
        self.assertEqual(self._line(move, 'salaries_payable').credit, 20281.25)
        self.assertEqual(self._line(move, 'gosi_payable').credit, 2837.50)
        self.assertEqual(sum(move.line_ids.mapped('debit')), 23118.75)
        self.assertEqual(sum(move.line_ids.mapped('credit')), 23118.75)
        self.assertFalse(move.line_ids.partner_id)
        self.assertEqual(run['finance']['entry_id'], move.id)

    def test_preview_shows_the_entry_and_the_unmapped_department(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.login_as(self.poster)
        res = self.api('GET', f"{RUNS}/{run['id']}/posting-preview")
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), PREVIEW_KEYS)
        self.assertEqual(body['entry_detail'], 'aggregated')
        self.assertEqual(body['date'], '2026-11-30')
        self.assertEqual(body['journal'], {'id': self.general_journal.id, 'name': self.general_journal.name})
        self.assertEqual(len(body['lines']), 8)
        self.assertTrue(all(set(line) == PREVIEW_LINE_KEYS for line in body['lines']))
        self.assertEqual(set(body['lines'][0]['account']), {'id', 'code', 'name'})
        self.assertEqual((body['debit'], body['credit']), (23118.75, 23118.75))
        self.assertEqual(
            body['warnings'],
            [{'code': 'unmapped_department', 'employee': {'id': self.e2.id, 'name': self.e2.name}}],
        )
        self.assertFalse(self.env['account.move'].search_count([('webvue_payroll_origin', '=', 'run')]))

    def test_per_employee_entry_lines(self):
        self.settings.entry_detail = 'per_employee'
        _run, move = self._posted()
        self.assertEqual(len(move.line_ids), 10)
        payable = self.accounts['salaries_payable']
        by_partner = {
            line.partner_id: line.credit for line in move.line_ids if line.account_id == payable
        }
        self.assertEqual(by_partner, {self.e1.work_contact_id: 12281.25, self.e2.work_contact_id: 8000.00})
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh, self.e1).debit, 10000.00)
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh, self.e1).name, self.e1.name)

    def test_setting_change_does_not_rewrite_posted_runs(self):
        _october, october_move = self._posted('2026-10')
        count = len(october_move.line_ids)
        self.settings.entry_detail = 'per_employee'
        _november, november_move = self._posted(MONTH)
        self.assertEqual(len(october_move.line_ids), count)
        self.assertEqual(count, 8)
        self.assertEqual(len(november_move.line_ids), 10)

    def test_advance_recovery_credits_employee_receivable_with_partner(self):
        _run, move = self._posted(advance_recovery_amount=500)
        advance = self._line(move, 'advance')
        self.assertEqual(advance.credit, 500.00)
        self.assertEqual(advance.partner_id, self.e1.work_contact_id)
        self.assertEqual(self._line(move, 'salaries_payable').credit, 19781.25)
        self.assertEqual(sum(move.line_ids.mapped('debit')), sum(move.line_ids.mapped('credit')))

    def test_post_refuses_locked_period(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.company.hard_lock_date = date(2026, 11, 30)
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'period_locked')
        self.assertEqual(res.json()['field'], 'date')
        self.assertFalse(self.env['account.move'].search_count([('webvue_payroll_origin', '=', 'run')]))
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'approved')

    def test_posting_uses_payslip_department_snapshot(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.e1.department_id = self.dept_b
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 200, res.text)
        move = self.env['account.move'].browse(res.json()['finance']['entry_id'])
        self.assertEqual(self._line(move, 'basic_expense', self.riyadh).debit, 10000.00)

    def test_post_needs_both_capabilities(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        reader = self.user_with('pp_reader', list(PAYROLL_READ))
        accountant = self.user_with('pp_accountant', list(POSTING))
        for user in (reader, accountant, self.payroll_approver):
            res = self._post(run['id'], user)
            self.assertEqual(res.status_code, 403, res.text)
            self.assertEqual(res.json()['code'], 'forbidden')
            self.login_as(user)
            self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}/posting-preview").status_code, 403)
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state'], 'posted')

    def test_only_an_approved_run_posts_once(self):
        self.login_as(self.payroll_officer)
        draft_id = self.api('POST', RUNS, json={'month': MONTH}).json()['id']
        res = self._post(draft_id)
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'transition_forbidden')
        run, _move = self._posted('2026-10')
        again = self._post(run['id'])
        self.assertEqual(again.status_code, 403, again.text)

    def test_posted_run_is_listed_and_offers_only_the_provision_action(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.login_as(self.poster)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['post'])
        self.assertEqual(self._post(run['id']).status_code, 200)
        self.assertEqual(self.api('GET', f'{RUNS}?state=posted').json()['total'], 1)
        self.assertEqual(self.api('GET', f'{RUNS}?state=approved').json()['total'], 0)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['eos_provision'])

    def test_entry_name_needs_entries_read(self):
        run, move = self._posted()
        self.assertEqual(run['finance'], {
            'entry_id': move.id, 'entry_name': move.name, 'payment_id': None, 'payment_name': None,
        })
        self.login_as(self.user_with('pp_reader_only', list(PAYROLL_READ)))
        finance = self.api('GET', f"{RUNS}/{run['id']}").json()['finance']
        self.assertEqual(finance['entry_id'], move.id)
        self.assertIsNone(finance['entry_name'])

    def test_payroll_move_cannot_be_reset_or_deleted(self):
        _run, move = self._posted()
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        res = self.api('POST', f'/api/v1/finance/entries/{move.id}/reset-to-draft')
        self.assertEqual(res.status_code, 422, res.text)
        with self.assertRaises(UserError):
            move.button_cancel()
        with self.assertRaises(UserError):
            move.unlink()
        self.assertEqual(move.state, 'posted')

    def test_missing_cost_center_without_default(self):
        run = self._approved_run([self.e1, self.e2], MONTH)
        self.settings.default_analytic_account_id = False
        res = self._post(run['id'])
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'missing_cost_center')
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'approved')
