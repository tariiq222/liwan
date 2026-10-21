# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import RUNS, PayrollFinanceCase

PAYROLL_READ = ('hr.payroll.read', 'hr.employees.read')
POSTING = ('finance.entries.read', 'finance.entries.manage', 'finance.entries.post')
PROVISIONS = '/api/v1/hr/payroll/eos-provisions'
ITEM_KEYS = {'month', 'entry_id', 'entry_name', 'amount'}


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollEosProvision(PayrollFinanceCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dept = cls.make_department('Provision A')
        cls.env['webvue.hr.payroll.cost.center'].create({
            'company_id': cls.company.id, 'department_id': cls.dept.id, 'analytic_account_id': cls.riyadh.id,
        })
        cls.employee = cls.make_employee('Provision E1', cls.dept)
        cls.employee.version_id.contract_date_start = date(2021, 12, 1)
        cls.settings = cls.full_settings()
        cls.poster = cls.user_with('pe_poster', [*PAYROLL_READ, *POSTING])

    def _posted_run(self, month):
        run = self._approved_run([self.employee], month)
        self.login_as(self.poster)
        res = self.api('POST', f"{RUNS}/{run['id']}/post")
        self.assertEqual(res.status_code, 200, res.text)
        return run

    def _provision(self, month):
        self.login_as(self.poster)
        return self.api('POST', PROVISIONS, json={'month': month})

    def _accrual(self):
        return self.env['webvue.hr.payroll.eos.accrual'].search([('employee_id', '=', self.employee.id)])

    def test_first_provision_posts_full_accrual(self):
        self._posted_run('2026-11')
        res = self._provision('2026-11')
        self.assertEqual(res.status_code, 201, res.text)
        body = res.json()
        self.assertEqual(set(body), ITEM_KEYS)
        self.assertEqual((body['month'], body['amount']), ('2026-11', 33750.00))
        move = self.env['account.move'].browse(body['entry_id'])
        self.assertEqual(move.webvue_payroll_origin, 'eos_provision')
        self.assertEqual(move.state, 'posted')
        debit = move.line_ids.filtered(lambda line: line.debit)
        self.assertEqual(debit.account_id, self.accounts['eos_expense'])
        self.assertEqual(debit.analytic_distribution, {str(self.riyadh.id): 100})
        self.assertEqual(move.line_ids.filtered(lambda line: line.credit).account_id, self.accounts['eos_provision'])
        self.assertEqual(self._accrual().amount, 33750.00)
        listed = self.api('GET', PROVISIONS).json()
        self.assertEqual((listed['total'], listed['items'][0]), (1, body))

    def test_next_month_posts_only_the_delta(self):
        self._posted_run('2026-11')
        self.assertEqual(self._provision('2026-11').status_code, 201)
        self._posted_run('2026-12')
        res = self._provision('2026-12')
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['amount'], 1146.58)
        self.assertEqual(self._accrual().amount, 34896.58)

    def test_settlement_month_reverses_the_unpaid_part(self):
        self._posted_run('2026-11')
        self.assertEqual(self._provision('2026-11').status_code, 201)
        self._posted_run('2026-12')
        self.assertEqual(self._provision('2026-12').status_code, 201)
        self.employee.departure_date = date(2027, 1, 31)
        self.env['webvue.hr.payroll.eos.settlement'].create({
            'employee_id': self.employee.id, 'departure_date': date(2027, 1, 31), 'case': 'termination',
            'award': 30000.00, 'total': 30000.00, 'state': 'confirmed',
        })
        self._posted_run('2027-01')
        res = self._provision('2027-01')
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['amount'], 4896.58)
        move = self.env['account.move'].browse(res.json()['entry_id'])
        self.assertEqual(move.line_ids.filtered(lambda line: line.debit).account_id, self.accounts['eos_provision'])
        self.assertEqual(move.line_ids.filtered(lambda line: line.credit).account_id, self.accounts['eos_expense'])
        self.assertEqual(self._accrual().amount, 0)

    def test_one_provision_per_month(self):
        self._posted_run('2026-11')
        self.assertEqual(self._provision('2026-11').status_code, 201)
        res = self._provision('2026-11')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'duplicate'))

    def test_provision_needs_a_posted_run(self):
        self._approved_run([self.employee], '2026-11')
        res = self._provision('2026-11')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))

    def test_provision_refuses_locked_period(self):
        self._posted_run('2026-11')
        self.company.hard_lock_date = date(2026, 11, 30)
        res = self._provision('2026-11')
        self.assertEqual(res.status_code, 422, res.text)
        self.assertFalse(self.env['webvue.hr.payroll.eos.provision'].search([('company_id', '=', self.company.id)]))
        self.assertFalse(self._accrual())

    def test_provision_move_cannot_be_reset(self):
        self._posted_run('2026-11')
        move = self.env['account.move'].browse(self._provision('2026-11').json()['entry_id'])
        with self.assertRaises(UserError):
            move.button_draft()

    def test_finance_actions_offer_the_provision(self):
        run = self._posted_run('2026-11')
        self.login_as(self.poster)
        self.assertIn('eos_provision', self.api('GET', f'{RUNS}/{run["id"]}').json()['allowed_actions'])
