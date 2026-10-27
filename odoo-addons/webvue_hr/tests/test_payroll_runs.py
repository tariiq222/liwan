# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import tagged

from .payroll_common import PayrollCase

RUN_KEYS = {
    'id', 'month', 'state', 'employee_count', 'totals', 'warnings', 'allowed_actions',
    'approved_by', 'approved_at', 'finance',
}
SUMMARY_KEYS = {'id', 'month', 'state', 'employee_count', 'totals', 'approved_at'}
TOTALS_KEYS = {'gross', 'deductions', 'gosi_employee', 'gosi_employer', 'net'}
ROW_KEYS = {
    'id', 'employee', 'department', 'state', 'paid_days', 'inputs', 'gross', 'deductions', 'net',
    'iban_missing',
}
INPUT_KEYS = {'overtime_amount', 'absence_days', 'bonus_amount', 'deduction_amount', 'advance_recovery_amount'}
VALID_IBAN = 'SA0380000000608010167519'
RUNS = '/api/v1/hr/payroll/runs'
MONTH = '2026-11'


@tagged('post_install', '-at_install', 'webvue')
class TestPayrollRuns(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.officer = cls.payroll_user(cls, 'run_officer', [
            'hr.payroll.read', 'hr.payroll.manage', 'hr.employees.read',
        ])
        cls.approver = cls.payroll_user(cls, 'run_approver', [
            'hr.payroll.read', 'hr.payroll.approve', 'hr.employees.read',
        ])
        cls.reader = cls.payroll_user(cls, 'run_reader', ['hr.payroll.read', 'hr.employees.read'])
        cls.hr_manager = cls.payroll_user(cls, 'run_hr_mgr', [])
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.hr_manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id, 'company_id': cls.env.company.id,
        }])
        cls.worker = cls.make_employee(cls, 'Run Worker')
        cls.set_compensation(
            cls, cls.worker, 10000, 2500, 1000, iban=VALID_IBAN, gosi_registration_date=date(2020, 1, 1),
        )

    def _login(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')

    def _create(self, month=MONTH):
        self._login(self.officer)
        return self.api('POST', RUNS, json={'month': month})

    def _created_run(self, month=MONTH):
        res = self._create(month)
        self.assertEqual(res.status_code, 201, res.text)
        return res.json()

    def _post(self, user, run_id, action):
        self._login(user)
        return self.api('POST', f'{RUNS}/{run_id}/{action}')

    def _rows(self, run_id, user=None):
        self._login(user or self.reader)
        res = self.api('GET', f'{RUNS}/{run_id}/payslips')
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def _patch_inputs(self, run_id, slip_id, body):
        self._login(self.officer)
        return self.api('PATCH', f'{RUNS}/{run_id}/payslips/{slip_id}/inputs', json=body)

    def _computed_run_with_deduction(self, amount):
        run = self._created_run()
        slip_id = self._rows(run['id'])['items'][0]['id']
        res = self._patch_inputs(run['id'], slip_id, {'deduction_amount': amount})
        self.assertEqual(res.status_code, 200, res.text)
        res = self._post(self.officer, run['id'], 'compute')
        self.assertEqual(res.status_code, 200, res.text)
        return run['id']

    def test_a_non_employee_relationship_never_blocks_compute_or_approval(self):
        self.env['webvue.hr.compensation'].search([]).write({'relationship_type': 'independent_contractor'})
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        res = self._post(self.approver, run['id'], 'approve')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state'], 'approved')

    def test_run_state_machine(self):
        run = self._created_run()
        self.assertEqual(run['state'], 'draft')
        self.assertEqual(run['month'], MONTH)
        self.assertEqual(run['employee_count'], 1)
        slip_id = self._rows(run['id'])['items'][0]['id']

        res = self._patch_inputs(run['id'], slip_id, {'bonus_amount': 500})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['inputs']['bonus_amount'], 500)

        res = self._post(self.officer, run['id'], 'compute')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['state'], 'computed')
        self.assertEqual(res.json()['allowed_actions'], ['compute', 'cancel', 'edit_inputs'])

        res = self._patch_inputs(run['id'], slip_id, {'bonus_amount': 800})
        self.assertEqual(res.status_code, 200, res.text)
        self._login(self.reader)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").json()['state'], 'draft')

        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        res = self._post(self.approver, run['id'], 'approve')
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body['state'], 'approved')
        self.assertEqual(body['approved_by']['id'], self.approver.id)
        self.assertTrue(body['approved_at'])
        self.assertEqual(self.env['hr.payslip.run'].browse(run['id']).state, 'close')

        res = self._patch_inputs(run['id'], slip_id, {'bonus_amount': 1})
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'transition_forbidden')
        self.assertEqual(res.json()['details'], {'reason': 'not_editable'})
        res = self._post(self.officer, run['id'], 'compute')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))
        self._login(self.officer)
        res = self.api('DELETE', f"{RUNS}/{run['id']}")
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))

    def test_approve_requires_a_computed_run(self):
        run = self._created_run()
        res = self._post(self.approver, run['id'], 'approve')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'transition_forbidden'))

    def test_one_run_per_company_month(self):
        self._created_run()
        res = self._create()
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'duplicate')
        self.assertEqual(res.json()['field'], 'month')

    def test_invalid_month_is_refused(self):
        for month in ('2026-13', '2026-1', 'nov', None, 202611):
            res = self._create(month)
            self.assertEqual(res.status_code, 422, (month, res.text))
            self.assertEqual(res.json()['field'], 'month')

    def test_approver_cannot_approve_run_with_own_payslip(self):
        own = self.make_employee('Approver Staff', user=self.approver)
        self.set_compensation(own, 8000, 2000, 500, gosi_registration_date=date(2020, 1, 1))
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        res = self._post(self.approver, run['id'], 'approve')
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(res.json()['code'], 'transition_forbidden')
        self.assertEqual(res.json()['field'], 'employee_id')

    def test_approve_refuses_negative_net(self):
        run_id = self._computed_run_with_deduction(20000)
        res = self._post(self.approver, run_id, 'approve')
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'negative_net')
        self.assertEqual(res.json()['details'], {'employee_ids': [self.worker.id]})
        self.assertEqual(self.env['hr.payslip.run'].browse(run_id).webvue_state, 'computed')

    def test_zero_net_payslip_is_approvable(self):
        run_id = self._computed_run_with_deduction(12281.25)
        res = self._post(self.approver, run_id, 'approve')
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['totals']['net'], 0)
        self.assertEqual(self._rows(run_id)['items'][0]['net'], 0)

    def test_manager_cannot_approve_and_hr_manager_cannot_read(self):
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        res = self._post(self.officer, run['id'], 'approve')
        self.assertEqual((res.status_code, res.json()['code']), (403, 'forbidden'))
        self._login(self.hr_manager)
        self.assertEqual(self.api('GET', RUNS).status_code, 403)
        self._login(self.reader)
        res = self.api('POST', RUNS, json={'month': '2026-12'})
        self.assertEqual(res.status_code, 403, res.text)
        res = self.api('DELETE', f"{RUNS}/{run['id']}")
        self.assertEqual(res.status_code, 403, res.text)

    def test_cancel_frees_the_month(self):
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        self._login(self.officer)
        self.assertEqual(self.api('DELETE', f"{RUNS}/{run['id']}").status_code, 204)
        self.assertFalse(self.env['hr.payslip'].search([('employee_id', '=', self.worker.id)]))
        self.assertEqual(self._create().status_code, 201)
        self._login(self.reader)
        self.assertEqual(self.api('GET', f"{RUNS}/{run['id']}").status_code, 404)

    def test_run_list_envelope_and_detail_keys(self):
        second = self.make_employee('Run Second')
        self.set_compensation(second, 6000, 1500, 0, gosi_registration_date=date(2020, 1, 1))
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        self._login(self.reader)
        res = self.api('GET', f'{RUNS}?year=2026&state=computed')
        self.assertEqual(res.status_code, 200, res.text)
        listing = res.json()
        self.assertEqual(set(listing), {'items', 'total'})
        self.assertEqual(listing['total'], 1)
        self.assertEqual(set(listing['items'][0]), SUMMARY_KEYS)
        self.assertEqual(set(listing['items'][0]['totals']), TOTALS_KEYS)
        self.assertEqual(self.api('GET', f'{RUNS}?year=2025').json()['total'], 0)
        self.assertEqual(self.api('GET', f'{RUNS}?state=approved').json()['total'], 0)
        self.assertEqual(self.api('GET', f'{RUNS}?state=bogus').status_code, 422)

        detail = self.api('GET', f"{RUNS}/{run['id']}").json()
        self.assertEqual(set(detail), RUN_KEYS)
        self.assertEqual(set(detail['totals']), TOTALS_KEYS)
        self.assertIsNone(detail['finance'])
        self.assertEqual(detail['allowed_actions'], [])
        self._login(self.officer)
        self.assertEqual(
            self.api('GET', f"{RUNS}/{run['id']}").json()['allowed_actions'], ['compute', 'cancel', 'edit_inputs'],
        )

        rows = self._rows(run['id'])
        self.assertEqual(rows['total'], 2)
        for row in rows['items']:
            self.assertEqual(set(row), ROW_KEYS)
            self.assertEqual(set(row['inputs']), INPUT_KEYS)
            self.assertEqual(row['state'], 'verify')
            self.assertEqual(row['paid_days'], 30)
        by_name = {row['employee']['name']: row for row in rows['items']}
        self.assertEqual(by_name['Run Worker']['net'], 12281.25)
        self.assertFalse(by_name['Run Worker']['iban_missing'])
        self.assertTrue(by_name['Run Second']['iban_missing'])
        self.assertEqual(round(sum(row['net'] for row in rows['items']), 2), detail['totals']['net'])
        self.assertEqual(round(sum(row['gross'] for row in rows['items']), 2), detail['totals']['gross'])
        self.assertEqual(by_name['Run Worker']['gross'], 13500)
        self.assertEqual(by_name['Run Worker']['deductions'], 1218.75)
        self.assertEqual(detail['totals']['gosi_employer'] > 0, True)
        filtered = self.api('GET', f"{RUNS}/{run['id']}/payslips?q=second").json()
        self.assertEqual([row['employee']['name'] for row in filtered['items']], ['Run Second'])
        self.assertEqual(filtered['total'], 1)

    def test_inputs_are_validated(self):
        run = self._created_run()
        slip_id = self._rows(run['id'])['items'][0]['id']
        for body in ({}, {'bonus_amount': -1}, {'bonus_amount': '5'}, {'bonus_amount': True}, {'salary': 1}):
            res = self._patch_inputs(run['id'], slip_id, body)
            self.assertEqual(res.status_code, 422, (body, res.text))
            self.assertEqual(res.json()['code'], 'invalid')
        res = self._patch_inputs(run['id'], slip_id, {'absence_days': 2, 'advance_recovery_amount': 100})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()['inputs']['absence_days'], 2)
        self.assertEqual(res.json()['inputs']['advance_recovery_amount'], 100)
        self.assertEqual(self._patch_inputs(run['id'], slip_id + 999, {'bonus_amount': 1}).status_code, 404)

    def test_compensation_missing_warning(self):
        bare = self.make_employee('No Compensation')
        no_iban = self.make_employee('No Iban')
        self.set_compensation(no_iban, 7000, gosi_registration_date=date(2020, 1, 1))
        run = self._created_run()
        self._login(self.reader)
        warnings = self.api('GET', f"{RUNS}/{run['id']}").json()['warnings']
        self.assertIn({'code': 'compensation_missing', 'employee': {'id': bare.id, 'name': bare.name}}, warnings)
        self.assertIn({'code': 'missing_iban', 'employee': {'id': no_iban.id, 'name': no_iban.name}}, warnings)
        self.assertNotIn(self.worker.id, [item['employee']['id'] for item in warnings])
        names = [row['employee']['name'] for row in self._rows(run['id'])['items']]
        self.assertNotIn('No Compensation', names)

    def test_compute_needs_the_payroll_structure(self):
        self.env['webvue.hr.payroll.settings']._webvue_save(self.env.company, {'structure_id': False})
        res = self._create()
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual(res.json()['code'], 'structure_missing')

    def test_new_compensation_joins_the_run_on_compute(self):
        run = self._created_run()
        late = self.make_employee('Late Comp')
        self.set_compensation(late, 5000, gosi_registration_date=date(2020, 1, 1))
        self.assertEqual(self._rows(run['id'])['total'], 1)
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        self.assertEqual(self._rows(run['id'])['total'], 2)
        self.env['webvue.hr.compensation'].search([('employee_id', '=', late.id)]).unlink()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        self.assertEqual(self._rows(run['id'])['total'], 1)

    def test_a_run_without_payslips_cannot_be_approved(self):
        self.env['webvue.hr.compensation'].search([]).unlink()
        run = self._created_run()
        self.assertEqual(run['employee_count'], 0)
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        res = self._post(self.approver, run['id'], 'approve')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'run_empty'))
        self.assertEqual(self.env['hr.payslip.run'].browse(run['id']).webvue_state, 'computed')

    def test_a_compensation_changed_after_compute_makes_the_run_stale(self):
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        self.env['webvue.hr.compensation'].search([('employee_id', '=', self.worker.id)]).basic_wage = 12000
        res = self._post(self.approver, run['id'], 'approve')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'run_stale'))
        self.assertEqual(res.json()['details'], {'employee_ids': [self.worker.id]})
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        self.assertEqual(self._post(self.approver, run['id'], 'approve').status_code, 200)

    def test_an_employee_who_became_due_after_compute_makes_the_run_stale(self):
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        late = self.make_employee('Run Late Joiner')
        self.set_compensation(late, 5000, gosi_registration_date=date(2020, 1, 1))
        res = self._post(self.approver, run['id'], 'approve')
        self.assertEqual((res.status_code, res.json()['code']), (422, 'run_stale'))
        self.assertEqual(res.json()['details'], {'employee_ids': [late.id]})

    def test_an_unchanged_computed_run_is_approved(self):
        run = self._created_run()
        self.assertEqual(self._post(self.officer, run['id'], 'compute').status_code, 200)
        self.assertEqual(self._post(self.approver, run['id'], 'approve').status_code, 200)
