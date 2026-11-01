# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
SETTINGS = '/api/v1/hr/payroll/settings'
GOSI_RATES = '/api/v1/hr/payroll/gosi-rates'
VALID_IBAN = 'SA0380000000608010167519'
MONTH = '2026-12'
GOSI_RATE = {
    'branch': 'annuities', 'nationality_class': 'gcc', 'date_from': '2030-01-01',
    'employee_rate': 9, 'employer_rate': 9, 'wage_min': 0, 'wage_max': 45000,
}


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollDutySplit(PayrollCase):
    """The setup of payroll and its approval are separate capabilities: a custom role holding only one of
    them does that half alone, which is how a customer separates configuration from approval."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'split_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'split_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.configurer = cls.payroll_user(cls, 'split_config', ['hr.payroll.read', 'hr.payroll.config', 'hr.employees.read'])
        worker = cls.make_employee(cls, 'Split Worker')
        cls.set_compensation(cls, worker, 9000, 2000, iban=VALID_IBAN, gosi_registration_date=date(2020, 1, 1))

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def test_an_approver_cannot_change_the_setup(self):
        self._login(self.approver)
        revision = self.api('GET', SETTINGS).json()['revision']
        self.assertEqual(self.api('PATCH', SETTINGS, json={'day_divisor': 28, 'revision': revision}).status_code, 403)
        self.assertEqual(self.api('POST', GOSI_RATES, json=GOSI_RATE).status_code, 403)
        self.assertEqual(self.api('POST', RUNS, json={'month': MONTH}).status_code, 403)

    def test_a_setup_user_cannot_approve(self):
        self._login(self.officer)
        run_id = self.api('POST', RUNS, json={'month': MONTH}).json()['id']
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/compute').status_code, 200)
        self._login(self.configurer)
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/approve').status_code, 403)
        self.assertEqual(self.env['hr.payslip.run'].browse(run_id).liwan_state, 'computed')
        self._login(self.approver)
        approved = self.api('POST', f'{RUNS}/{run_id}/approve')
        self.assertEqual((approved.status_code, approved.json()['state']), (200, 'approved'))

    def test_a_setup_user_still_changes_the_setup(self):
        self._login(self.configurer)
        revision = self.api('GET', SETTINGS).json()['revision']
        self.assertEqual(self.api('PATCH', SETTINGS, json={'day_divisor': 28, 'revision': revision}).status_code, 200)
