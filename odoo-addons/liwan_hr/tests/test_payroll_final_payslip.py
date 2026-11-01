# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
VALID_IBAN = 'SA0380000000608010167519'
MONTH = '2026-12'


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollFinalPayslip(PayrollCase):
    """A leaver's account closes with the archive, so the final payslip goes to the personal email on approval."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'final_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'final_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.leaver = cls._paid('Final Leaver', 'leaver.personal@example.com', departure=date(2026, 12, 20))
        cls.no_address = cls._paid('Leaver Without Address', None, departure=date(2026, 12, 21))
        cls.stayer = cls._paid('Staying Worker', 'stayer.personal@example.com', departure=None)
        cls.future = cls._paid('Leaving Next Year', 'future.personal@example.com', departure=date(2027, 4, 10))

    @classmethod
    def _paid(cls, name, private_email, departure):
        employee = cls.make_employee(cls, name)
        cls.set_compensation(cls, employee, 9000, 2000, iban=VALID_IBAN, gosi_registration_date=date(2020, 1, 1))
        employee.private_email = private_email or False
        if departure:
            employee.write({'departure_date': departure, 'departure_reason_id': cls.env.ref('hr.departure_resigned').id})
            if departure <= date(2026, 12, 31):
                # A leaver of the month needs a confirmed settlement before the run can be approved.
                cls.env['liwan.hr.payroll.eos.settlement']._liwan_save_draft(employee, 'resignation', 0)
                cls.env['liwan.hr.payroll.eos.settlement']._liwan_current(employee)._liwan_confirm()
        return employee

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _approve_the_run(self):
        self._login(self.officer)
        run_id = self.api('POST', RUNS, json={'month': MONTH}).json()['id']
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/compute').status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f'{RUNS}/{run_id}/approve').status_code, 200)

    def _mails_to(self, address):
        return self.env['mail.mail'].search([('email_to', '=', address)])

    def test_the_leaver_gets_the_final_payslip_at_the_personal_email_when_the_run_is_approved(self):
        self._approve_the_run()
        mails = self._mails_to('leaver.personal@example.com')
        self.assertEqual(len(mails), 1)
        self.assertIn(MONTH, mails.subject)
        self.assertIn('Final Leaver', mails.body_html)

    def test_nobody_else_is_mailed(self):
        self._approve_the_run()
        for address in ('stayer.personal@example.com', 'future.personal@example.com'):
            self.assertFalse(self._mails_to(address), address)

    def test_a_run_that_is_only_computed_mails_nobody(self):
        self._login(self.officer)
        run_id = self.api('POST', RUNS, json={'month': MONTH}).json()['id']
        self.api('POST', f'{RUNS}/{run_id}/compute')
        self.assertFalse(self._mails_to('leaver.personal@example.com'))
