# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date
from decimal import Decimal

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import RUNS, PayrollFinanceCase
from odoo.addons.webvue_hr.models.payroll_math import money

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

    def _posted_run(self, month, employees=None):
        run = self._approved_run([self.employee] if employees is None else employees, month)
        self.login_as(self.poster)
        res = self.api('POST', f"{RUNS}/{run['id']}/post")
        self.assertEqual(res.status_code, 200, res.text)
        return run

    def _provision(self, month):
        self.login_as(self.poster)
        return self.api('POST', PROVISIONS, json={'month': month})

    def _accrual(self):
        return self.env['webvue.hr.payroll.eos.accrual'].search([('employee_id', '=', self.employee.id)])

    def _second_leaver(self, departure):
        """A second employee who leaves on ``departure`` in the no-award case.

        The run of that month still holds a payslip for them, so it can be posted, while the provision has
        nothing to book for them: their target and their award are zero.
        """
        employee = self.make_employee('Provision E2', self.dept)
        employee.departure_date = departure
        self.env['webvue.hr.payroll.eos.settlement'].create({
            'employee_id': employee.id, 'departure_date': departure, 'case': 'no_award',
            'award': 0, 'total': 0, 'state': 'confirmed',
        })
        return employee

    def _provision_account_totals(self):
        """``(credited, debited)`` of the company's provision account, as Decimals.

        The end-of-service lines are the only ones that post there: the provision of the month and, through
        the payroll entry, the settlement award that entry pays out of it.
        """
        lines = self.env['account.move.line'].search([
            ('account_id', '=', self.accounts['eos_provision'].id),
            ('company_id', '=', self.company.id),
        ])
        return (
            money(sum((Decimal(str(line.credit)) for line in lines), Decimal(0))),
            money(sum((Decimal(str(line.debit)) for line in lines), Decimal(0))),
        )

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
        self.assertEqual(self._provision_account_totals(), (Decimal('34896.58'), Decimal('34896.58')))

    def test_settlement_equal_to_the_accrual_releases_nothing_in_the_next_month(self):
        """A leaver whose award equals their accrual: the settlement month books nothing, and the month
        after it never releases the provision a second time."""
        self._posted_run('2026-11')
        self.assertEqual(self._provision('2026-11').status_code, 201)
        self.employee.departure_date = date(2027, 1, 31)
        self.env['webvue.hr.payroll.eos.settlement'].create({
            'employee_id': self.employee.id, 'departure_date': date(2027, 1, 31), 'case': 'termination',
            'award': 33750.00, 'total': 33750.00, 'state': 'confirmed',
        })
        self._posted_run('2027-01')
        # The award the payroll entry pays out of the provision equals the accrual: the account is at zero.
        self.assertEqual(self._provision_account_totals(), (Decimal('33750.00'), Decimal('33750.00')))
        res = self._provision('2027-01')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'))
        self.assertFalse(self.env['webvue.hr.payroll.eos.provision'].search([
            ('company_id', '=', self.company.id), ('month', '=', date(2027, 1, 1)),
        ]))
        # The month after: the payout is netted against the accrual, so it is not released a second time.
        second = self._second_leaver(date(2027, 2, 28))
        self._posted_run('2027-02', [second])
        res = self._provision('2027-02')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'invalid'))
        self.assertEqual(self._provision_account_totals(), (Decimal('33750.00'), Decimal('33750.00')))

    def test_settlement_in_an_unposted_month_releases_only_the_unpaid_part(self):
        """A leaver settled in a month whose provision was never posted: the next month books only the part
        their payout did not cover, so the provision account is never debited more than it was credited."""
        self._posted_run('2026-11')
        self.assertEqual(self._provision('2026-11').status_code, 201)
        self.employee.departure_date = date(2027, 1, 31)
        self.env['webvue.hr.payroll.eos.settlement'].create({
            'employee_id': self.employee.id, 'departure_date': date(2027, 1, 31), 'case': 'termination',
            'award': 30000.00, 'total': 30000.00, 'state': 'confirmed',
        })
        self._posted_run('2027-01')
        self.assertEqual(self._provision_account_totals(), (Decimal('33750.00'), Decimal('30000.00')))
        second = self._second_leaver(date(2027, 2, 28))
        self._posted_run('2027-02', [second])
        res = self._provision('2027-02')
        self.assertEqual(res.status_code, 201, res.text)
        self.assertEqual(res.json()['amount'], 3750.00)
        self.assertEqual(self._provision_account_totals(), (Decimal('33750.00'), Decimal('33750.00')))
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

    def test_provision_waits_for_every_earlier_run_to_be_posted(self):
        self._approved_run([self.employee], '2026-10')
        self._posted_run('2026-11')
        res = self._provision('2026-11')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'earlier_run_unposted'), res.text)
        self.assertFalse(self.env['webvue.hr.payroll.eos.provision'].search_count([('company_id', '=', self.company.id)]))

    def test_an_earlier_run_cannot_be_posted_after_a_later_provision(self):
        self._posted_run('2026-11')
        self.assertEqual(self._provision('2026-11').status_code, 201)
        late = self._approved_run([self.employee], '2026-10')
        self.login_as(self.poster)
        res = self.api('POST', f"{RUNS}/{late['id']}/post")
        self.assertEqual((res.status_code, res.json()['code']), (422, 'provision_after_run'), res.text)
        self.assertEqual(self.env['hr.payslip.run'].browse(late['id']).webvue_state, 'approved')

    def test_provision_refuses_a_journal_made_foreign_after_the_save(self):
        self._posted_run('2026-11')
        foreign = self.env['res.currency'].search([('id', '!=', self.company.currency_id.id)], limit=1)
        foreign.active = True
        self.settings.journal_id.currency_id = foreign
        res = self._provision('2026-11')
        self.assertEqual((res.status_code, res.json()['code'], res.json()['field']), (422, 'invalid', 'journal_id'))

    def test_a_leaver_without_a_payslip_books_to_their_last_payslip_department(self):
        other_dept = self.make_department('Provision B')
        jeddah = self.env['account.analytic.account'].create({
            'name': 'Jeddah payroll', 'plan_id': self.riyadh.plan_id.id, 'company_id': self.company.id,
        })
        self.env['webvue.hr.payroll.cost.center'].create({
            'company_id': self.company.id, 'department_id': other_dept.id, 'analytic_account_id': jeddah.id,
        })
        self.employee.department_id = other_dept
        self._posted_run('2026-11')
        self.assertEqual(self._provision('2026-11').status_code, 201)
        # The leaver has no compensation any more, so the December run holds only the stayer; the provision of
        # December still reverses the leaver's accrual and must book it to the department of their last payslip.
        self.env['webvue.hr.compensation'].search([('employee_id', '=', self.employee.id)]).unlink()
        self.employee.departure_date = date(2026, 11, 30)
        stayer = self.make_employee('Provision Stayer', self.dept)
        stayer.version_id.contract_date_start = date(2021, 12, 1)
        self._posted_run('2026-12', [stayer])
        res = self._provision('2026-12')
        self.assertEqual(res.status_code, 201, res.text)
        move = self.env['account.move'].browse(res.json()['entry_id'])
        reversal = move.line_ids.filtered(
            lambda line: line.account_id == self.accounts['eos_expense'] and line.credit,
        )
        self.assertEqual(reversal.analytic_distribution, {str(jeddah.id): 100})
