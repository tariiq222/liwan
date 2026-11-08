# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
MINE = '/api/v1/hr/payroll/payslips/mine'
MONTH = '2026-11'
IBAN = 'SA0380000000608010167519'
VAT = '300000000000003'
# The employer share and the company tax number are the employer's own operating data.
MY_PAYSLIP_KEYS = {
    'id', 'number', 'month', 'state', 'employee', 'department', 'paid_days', 'lines', 'gross',
    'deductions', 'net', 'company', 'currency',
}
MY_PAYSLIP_COMPANY_KEYS = {'name'}


@tagged('post_install', '-at_install', 'liwan')
class TestMyPayslipShape(PayrollCase):
    """An employee's own payslip carries what concerns their pay, not the employer's cost and registration."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.company.vat = VAT
        cls.officer = cls.payroll_user(cls, 'mine_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'mine_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.own = cls.payroll_user(cls, 'mine_own', ['hr.employees.read'])
        cls.worker = cls.make_employee(cls, 'Mine Worker', user=cls.own)
        cls.set_compensation(
            cls, cls.worker, 10000, 2500, 1000, iban=IBAN, gosi_registration_date=date(2020, 1, 1),
        )

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _approved_run(self):
        self._login(self.officer)
        run = self.env['hr.payslip.run'].browse(self.api('POST', RUNS, json={'month': MONTH}).json()['id'])
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/compute').status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/approve').status_code, 200)
        return run

    def test_the_self_service_payslip_has_no_employer_share_and_no_tax_number(self):
        run = self._approved_run()
        slip = run.slip_ids
        self._login(self.own)
        res = self.api('GET', f'{MINE}/{slip.id}')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), MY_PAYSLIP_KEYS)
        self.assertEqual(set(body['company']), MY_PAYSLIP_COMPANY_KEYS)
        self.assertNotIn(VAT, res.text)

    def test_the_manager_payslip_keeps_the_employer_share_and_the_tax_number(self):
        run = self._approved_run()
        slip = run.slip_ids
        self._login(self.officer)
        res = self.api('GET', f'{RUNS}/{run.id}/payslips/{slip.id}')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body['gosi_employer'], 1468.75)
        self.assertEqual(body['company'], {'name': self.env.company.name, 'vat': VAT})
