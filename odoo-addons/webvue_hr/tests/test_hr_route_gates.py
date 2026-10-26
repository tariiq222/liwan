# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Named success and linked 403 for routes whose gate was only asserted inside a loop or a neighbour.

Each test names one route, proves a holder of exactly the required capability gets a real 2xx envelope,
and proves a caller holding a neighbouring capability (never none at all) gets 403 ``forbidden``.
"""
from odoo.tests import tagged

from .payroll_common import PayrollCase

LIST_KEYS = {'items', 'total'}


@tagged('post_install', '-at_install', 'webvue')
class TestHrRouteGates(PayrollCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # Every caller below holds hr.employees.read (the neighbour) and nothing that opens the route under test.
        cls.neighbour = cls.payroll_user(cls, 'gate_neighbour', ['hr.employees.read'])
        cls.nothing = cls.payroll_user(cls, 'gate_nothing', [])
        cls.assets_reader = cls.payroll_user(cls, 'gate_assets', ['hr.assets.read', 'hr.employees.read'])
        cls.manager = cls.payroll_user(cls, 'gate_manager', [])
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id, 'company_id': cls.env.company.id,
        }])
        cls.dept_reader = cls.payroll_user(cls, 'gate_dept', ['hr.departments.read', 'hr.employees.read'])
        cls.leave_reader = cls.payroll_user(cls, 'gate_leave_read', ['hr.leave.read', 'hr.employees.read'])
        cls.leave_approver = cls.payroll_user(cls, 'gate_leave_approve', ['hr.leave.read', 'hr.leave.approve', 'hr.employees.read'])
        cls.offboarding_reader = cls.payroll_user(cls, 'gate_offb', ['hr.offboarding.read', 'hr.employees.read'])
        cls.payroll_reader = cls.payroll_user(cls, 'gate_payroll', ['hr.payroll.read', 'hr.employees.read'])
        cls.recruitment_reader = cls.payroll_user(cls, 'gate_recruit', ['hr.recruitment.read', 'hr.employees.read'])
        cls.shift_employee_user = cls.payroll_user(cls, 'gate_shift_me', ['hr.employees.read'])
        cls.make_employee(cls, 'Gate Shift Me', user=cls.shift_employee_user)

    def _get(self, user, path):
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self.api('GET', path)

    def assert_forbidden(self, response, path):
        self.assertEqual(response.status_code, 403, f'{path}: {response.text[:200]}')
        self.assertEqual(response.json()['code'], 'forbidden', path)

    def assert_list_ok(self, response, path):
        self.assertEqual(response.status_code, 200, f'{path}: {response.text[:200]}')
        body = response.json()
        self.assertEqual(set(body), LIST_KEYS, path)
        self.assertEqual(body['total'], len(body['items']), path)
        return body

    # --- F5: assets catalogue -------------------------------------------------------------------------

    def test_asset_categories_200_for_assets_reader_403_for_employee_reader(self):
        path = '/api/v1/hr/assets/categories'
        self.env['maintenance.equipment.category'].create({'name': 'Gate Category'})
        body = self.assert_list_ok(self._get(self.assets_reader, path), path)
        self.assertIn('Gate Category', [item['name'] for item in body['items']])
        self.assert_forbidden(self._get(self.neighbour, path), path)

    # --- F6: saudization report -----------------------------------------------------------------------

    def test_saudization_200_for_hr_manager_403_for_employee_reader(self):
        path = '/api/v1/hr/saudization'
        body = self._get(self.manager, path)
        self.assertEqual(body.status_code, 200, body.text)
        self.assertEqual(set(body.json()), LIST_KEYS | {'overall'})
        self.assert_forbidden(self._get(self.neighbour, path), path)

    # --- F7: success without a linked refusal ---------------------------------------------------------

    def test_departments_list_200_for_department_reader_403_without_the_capability(self):
        path = '/api/v1/hr/departments'
        department = self.env['hr.department'].create({'name': 'Gate Dept'})
        body = self.assert_list_ok(self._get(self.dept_reader, path), path)
        self.assertIn(department.id, [item['id'] for item in body['items']])
        self.assert_forbidden(self._get(self.neighbour, path), path)

    def test_leave_types_200_for_leave_reader_403_for_employee_reader(self):
        path = '/api/v1/hr/leave/types'
        self.assert_list_ok(self._get(self.leave_reader, path), path)
        self.assert_forbidden(self._get(self.neighbour, path), path)

    def test_leave_refuse_403_without_approve_and_the_request_stays_pending(self):
        employee = self.make_employee('Gate Leave Owner')
        leave_type = self.env['hr.leave.type'].create({'name': 'Gate Leave', 'requires_allocation': False})
        leave = self.env['hr.leave'].create({
            'employee_id': employee.id, 'holiday_status_id': leave_type.id,
            'request_date_from': '2026-05-04', 'request_date_to': '2026-05-05',
        })
        before = leave.state
        path = f'/api/v1/hr/leave/requests/{leave.id}/refuse'
        self.authenticate(self.leave_reader.login, f'{self.leave_reader.login}_pass_123')
        self.assert_forbidden(self.api('POST', path, json={}), path)
        self.assertEqual(leave.state, before)
        self.authenticate(self.leave_approver.login, f'{self.leave_approver.login}_pass_123')
        refused = self.api('POST', path, json={})
        self.assertEqual(refused.status_code, 200, refused.text)
        self.assertEqual(refused.json()['state'], 'refuse')

    def test_offboarding_runs_list_200_for_reader_403_for_employee_reader(self):
        path = '/api/v1/hr/offboarding/runs'
        self.assert_list_ok(self._get(self.offboarding_reader, path), path)
        self.assert_forbidden(self._get(self.neighbour, path), path)

    def test_payroll_settings_200_for_payroll_reader_403_for_employee_reader(self):
        path = '/api/v1/hr/payroll/settings'
        res = self._get(self.payroll_reader, path)
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIn('revision', res.json())
        self.assert_forbidden(self._get(self.neighbour, path), path)

    # --- F8 (and the F15 loops): named status per route -------------------------------------------------

    def test_recruitment_stages_200_for_reader_403_without(self):
        path = '/api/v1/hr/recruitment/stages'
        self.assert_list_ok(self._get(self.recruitment_reader, path), path)
        self.assert_forbidden(self._get(self.neighbour, path), path)

    def test_recruitment_refuse_reasons_200_for_reader_403_without(self):
        path = '/api/v1/hr/recruitment/refuse-reasons'
        self.assert_list_ok(self._get(self.recruitment_reader, path), path)
        self.assert_forbidden(self._get(self.nothing, path), path)

    def test_my_shifts_200_for_an_employee_403_without_read_and_422_without_a_record(self):
        path = '/api/v1/hr/shifts/me'
        self.assert_list_ok(self._get(self.shift_employee_user, path), path)
        self.assert_forbidden(self._get(self.nothing, path), path)
        no_record = self._get(self.neighbour, path)
        self.assertEqual((no_record.status_code, no_record.json()['code']), (422, 'invalid'))
