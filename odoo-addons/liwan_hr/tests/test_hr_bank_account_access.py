# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .payroll_common import PayrollCase

RUNS = '/api/v1/hr/payroll/runs'
EMPLOYEES = '/api/v1/hr/employees'
IBAN = 'SA0380000000608010167519'
STOCK_IBAN = 'SA4420000001234567891234'
MONTH = '2026-11'
# Every stock field that carries a salary bank account, on the employee record.
BANK_FIELDS = (
    'bank_account_ids', 'primary_bank_account_id', 'is_trusted_bank_account',
    'has_multiple_bank_accounts', 'salary_distribution',
)


@tagged('post_install', '-at_install', 'liwan')
class TestEmployeeBankAccountAccess(PayrollCase):
    """The stock employee bank accounts sit behind the payroll capability, not behind hr.group_hr_user."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.worker = cls.make_employee(cls, 'Bank Worker')
        cls.compensation = cls.set_compensation(
            cls, cls.worker, 10000, 2500, iban=IBAN, gosi_registration_date=date(2020, 1, 1),
        )
        cls.bank = cls.env['res.bank'].create({'name': 'Exposure Bank', 'bic': 'RJHISARI'})
        cls.compensation.bank_id = cls.bank
        # The stock many2many is the second store of the same fact; it gets a value so a leak would show.
        cls.bank_account = cls.env['res.partner.bank'].create({
            'acc_number': STOCK_IBAN, 'bank_id': cls.bank.id,
            'partner_id': cls.worker.work_contact_id.id,
        })
        cls.worker.write({'bank_account_ids': [(4, cls.bank_account.id)]})
        cls.officer = cls.payroll_user(
            cls, 'bank_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'],
        )
        cls.approver = cls.payroll_user(
            cls, 'bank_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'],
        )
        cls.hr_manager = cls.payroll_user(cls, 'bank_hr_manager', [
            'hr.employees.read', 'hr.employees.manage', 'hr.employees.archive',
            'hr.departments.read', 'hr.departments.manage',
        ])

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def test_the_hr_manager_holds_no_payroll_capability(self):
        self.assertFalse(
            self.env['liwan.access.service']._liwan_has_capability(self.hr_manager, 'hr.payroll.read'),
        )
        self.assertTrue(
            self.env['liwan.access.service']._liwan_has_capability(self.hr_manager, 'hr.employees.manage'),
        )

    def test_an_hr_manager_without_payroll_cannot_read_the_bank_fields(self):
        record = self.worker.with_user(self.hr_manager)
        for name in BANK_FIELDS:
            with self.subTest(field=name), self.assertRaises(AccessError):
                record.read([name])

    def test_a_payroll_reader_still_reads_the_bank_fields(self):
        """The payroll capability keeps the stock fields readable: closing the gap must not break payroll."""
        record = self.worker.with_user(self.officer)
        for name in BANK_FIELDS:
            with self.subTest(field=name):
                self.assertTrue(record._fields[name].groups, name)
                record.read([name])
        self.assertEqual(
            record.read(['bank_account_ids'])[0]['bank_account_ids'],
            self.worker.sudo().read(['bank_account_ids'])[0]['bank_account_ids'],
        )

    def test_the_employee_shapes_carry_no_bank_account(self):
        self._login(self.hr_manager)
        for path in (EMPLOYEES, f'{EMPLOYEES}/{self.worker.id}', '/api/v1/hr/me'):
            res = self.api('GET', path)
            self.assertEqual(res.status_code, 200, (path, res.text))
            for leaked in (IBAN, STOCK_IBAN):
                self.assertNotIn(leaked, res.text, path)

    def test_the_people_picker_carries_no_bank_account(self):
        if not self.env['ir.module.module'].search_count(
            [('name', '=', 'liwan_directory'), ('state', '=', 'installed')],
        ):
            self.skipTest('the people picker is not installed')
        self._login(self.hr_manager)
        res = self.api('GET', '/api/v1/people?q=Bank')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertNotIn(STOCK_IBAN, res.text)

    def test_the_approved_payment_uses_the_compensation_not_the_stock_field(self):
        self._login(self.officer)
        run = self.env['hr.payslip.run'].browse(self.api('POST', RUNS, json={'month': MONTH}).json()['id'])
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/compute').status_code, 200)
        self._login(self.approver)
        self.assertEqual(self.api('POST', f'{RUNS}/{run.id}/approve').status_code, 200)
        payment = self.env['liwan.hr.payslip.payment'].search([('payslip_id', '=', run.slip_ids.id)])
        self.assertEqual(payment.iban, IBAN)
        self.assertNotEqual(payment.iban, STOCK_IBAN)
