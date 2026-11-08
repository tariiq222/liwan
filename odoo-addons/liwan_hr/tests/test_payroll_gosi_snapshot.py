# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
MONTH = '2026-11'
IBAN = 'SA0380000000608010167519'
GOSI_NUMBER = '1234567890'
NEW_GOSI_NUMBER = '9876543210'


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollGosiSnapshot(PayrollCase):
    """The GOSI statement of an approved run reads the number stored at approval, never the live one."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'gosi_snap_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'gosi_snap_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.worker = cls.make_employee(cls, 'Gosi Snapshot Worker')
        cls.compensation = cls.set_compensation(
            cls, cls.worker, 10000, 2500, 1000, iban=IBAN, gosi_registration_date=date(2020, 1, 1),
        )
        cls.compensation.gosi_number = GOSI_NUMBER

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _approved_run(self):
        self._login(self.officer)
        run = self.env['hr.payslip.run'].browse(self.api('POST', RUNS, json={'month': MONTH}).json()['id'])
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/compute').status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/approve').status_code, 200)
        return run

    def _statement_numbers(self, run):
        self._login(self.officer)
        res = self.api('GET', f'{RUNS}/{run.id}/gosi-statement')
        self.assertEqual(res.status_code, 200, res.text)
        return {line['employee']['id']: line['gosi_number'] for line in res.json()['lines']}

    def test_the_approval_stores_the_gosi_number_of_the_payslip(self):
        run = self._approved_run()
        payment = self.env['liwan.hr.payslip.payment'].search([('payslip_id', '=', run.slip_ids.id)])
        self.assertEqual(payment.gosi_number, GOSI_NUMBER)

    def test_correcting_the_number_after_approval_keeps_the_statement(self):
        run = self._approved_run()
        before = self._statement_numbers(run)
        self.assertEqual(before, {self.worker.id: GOSI_NUMBER})
        self.compensation.gosi_number = NEW_GOSI_NUMBER
        self.assertEqual(self._statement_numbers(run), before)

    def test_clearing_the_live_number_keeps_the_statement_number(self):
        run = self._approved_run()
        self.compensation.gosi_number = False
        self.assertEqual(self._statement_numbers(run), {self.worker.id: GOSI_NUMBER})

    def test_a_payslip_without_a_live_number_exports_an_empty_one(self):
        self.compensation.gosi_number = False
        run = self._approved_run()
        self.assertEqual(self._statement_numbers(run), {self.worker.id: ''})
