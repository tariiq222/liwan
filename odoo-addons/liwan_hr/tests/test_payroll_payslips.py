# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .common import set_hr_feature
from .payroll_common import PayrollCase

PAYSLIP_KEYS = {
    'id', 'number', 'month', 'state', 'employee', 'department', 'paid_days', 'lines', 'gross',
    'deductions', 'net', 'gosi_employer', 'company', 'currency',
}
LINE_KEYS = {'code', 'name', 'category', 'amount'}
SUMMARY_KEYS = {'id', 'number', 'month', 'net', 'currency'}
RUNS = '/api/v1/hr/payroll/runs'
MINE = '/api/v1/hr/payroll/payslips/mine'
APPROVED_MONTH = '2026-11'
DRAFT_MONTH = '2026-12'
VALID_IBAN = 'SA0380000000608010167519'


@tagged('post_install', '-at_install', 'liwan')
class TestPayrollPayslips(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'slip_officer', ['hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read'])
        cls.approver = cls.payroll_user(cls, 'slip_approver', ['hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read'])
        cls.own = cls.payroll_user(cls, 'slip_own', ['hr.employees.read'])
        cls.employee_a = cls.make_employee(cls, 'Slip A', user=cls.own)
        cls.employee_b = cls.make_employee(cls, 'Slip B')
        for employee in (cls.employee_a, cls.employee_b):
            cls.set_compensation(
                cls, employee, 10000, 2500, 1000, iban=VALID_IBAN, gosi_registration_date=date(2020, 1, 1),
            )

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _run(self, month, approve):
        self._login(self.officer)
        run = self.api('POST', RUNS, json={'month': month}).json()
        self.assertEqual(self.api('POST', f"{RUNS}/{run['id']}/compute").status_code, 200)
        if approve:
            self._login(self.approver)
            res = self.api('POST', f"{RUNS}/{run['id']}/approve")
            self.assertEqual(res.status_code, 200, res.text)
        return run['id']

    def _slip(self, run_id, employee):
        return self.env['hr.payslip.run'].browse(run_id).slip_ids.filtered(
            lambda slip: slip.employee_id == employee,
        )

    def test_employee_sees_only_own_approved_payslips(self):
        approved = self._run(APPROVED_MONTH, approve=True)
        self._run(DRAFT_MONTH, approve=False)
        slip_a = self._slip(approved, self.employee_a)
        slip_b = self._slip(approved, self.employee_b)

        self._login(self.own)
        res = self.api('GET', MINE)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual((body['total'], [item['id'] for item in body['items']]), (1, [slip_a.id]))
        self.assertEqual(set(body['items'][0]), SUMMARY_KEYS)
        self.assertEqual(body['items'][0]['month'], APPROVED_MONTH)

        self.assertEqual(self.api('GET', f'{MINE}/{slip_a.id}').status_code, 200)
        res = self.api('GET', f'{MINE}/{slip_b.id}')
        self.assertEqual((res.status_code, res.json()['code']), (404, 'not_found'))

    def test_draft_run_payslip_of_own_employee_is_not_found(self):
        draft = self._run(DRAFT_MONTH, approve=False)
        self._login(self.own)
        res = self.api('GET', f"{MINE}/{self._slip(draft, self.employee_a).id}")
        self.assertEqual((res.status_code, res.json()['code']), (404, 'not_found'))

    def test_caller_without_employee_sees_nothing(self):
        self._run(APPROVED_MONTH, approve=True)
        self._login(self.approver)
        res = self.api('GET', MINE)
        self.assertEqual((res.status_code, res.json()), (200, {'items': [], 'total': 0}))

    def test_employee_without_payroll_cannot_open_run_payslip(self):
        approved = self._run(APPROVED_MONTH, approve=True)
        self._login(self.own)
        res = self.api('GET', f"{RUNS}/{approved}/payslips/{self._slip(approved, self.employee_a).id}")
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))

    def test_payslip_detail_keys_and_lines(self):
        approved = self._run(APPROVED_MONTH, approve=True)
        slip = self._slip(approved, self.employee_a)
        self._login(self.officer)
        res = self.api('GET', f'{RUNS}/{approved}/payslips/{slip.id}')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(set(body), PAYSLIP_KEYS)
        self.assertEqual([line['code'] for line in body['lines']], [
            'BASIC', 'HOUSING', 'TRANSPORT', 'GOSI_EE_ANN', 'GOSI_EE_SANED',
        ])
        self.assertTrue(all(set(line) == LINE_KEYS for line in body['lines']))
        self.assertEqual(body['net'], 12281.25)
        self.assertEqual(body['gosi_employer'], 1468.75)
        self.assertEqual((body['gross'], body['paid_days'], body['state']), (13500, 30, 'done'))
        self.assertEqual(body['employee']['id'], self.employee_a.id)
        self.assertEqual(set(body['company']), {'name', 'vat'})

        self._login(self.own)
        self.assertEqual(self.api('GET', f'{MINE}/{slip.id}').json(), body)

    def test_run_payslip_of_another_run_is_not_found(self):
        approved = self._run(APPROVED_MONTH, approve=True)
        draft = self._run(DRAFT_MONTH, approve=False)
        self._login(self.officer)
        res = self.api('GET', f"{RUNS}/{draft}/payslips/{self._slip(approved, self.employee_a).id}")
        self.assertEqual((res.status_code, res.json()['code']), (404, 'not_found'))

    def test_mine_closed_with_payroll_feature_off(self):
        approved = self._run(APPROVED_MONTH, approve=True)
        set_hr_feature(self, 'hr.payroll', False)
        self._login(self.own)
        for path in (MINE, f"{MINE}/{self._slip(approved, self.employee_a).id}"):
            res = self.api('GET', path)
            self.assertEqual((res.status_code, res.json()['code']), (403, 'feature_not_included'), path)
