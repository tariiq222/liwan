# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LEAVES, PROCESS, LeaveApprovalCase

APPROVAL_KEYS = {'request_id', 'state', 'href', 'steps'}


@tagged('post_install', '-at_install', 'liwan')
class TestLeaveApprovalRoutes(LeaveApprovalCase):

    def test_approval_shows_the_stages_to_the_employee_and_to_hr(self):
        leave = self.file_leave()
        self.approve(self.approval_request(leave), self.manager_user)
        for user in (self.employee, self.officer):
            self.login_as(user)
            response = self.api('GET', f'{LEAVES}/{leave.id}/approval')
            self.assertEqual(response.status_code, 200, response.text)
            body = response.json()
            self.assertEqual(set(body), APPROVAL_KEYS)
            self.assertEqual((body['state'], [step['status'] for step in body['steps']]), ('pending', ['approved', 'pending']))
            self.assertEqual(body['steps'][0]['reviewers'][0]['user_id'], self.manager_user.id)

    def test_approval_is_404_without_a_workflow_or_outside_the_company(self):
        self.archive_process()
        leave = self.file_leave()
        self.login_as(self.officer)
        self.assertEqual(self.api('GET', f'{LEAVES}/{leave.id}/approval').status_code, 404)
        self.assertEqual(self.api('GET', f'{LEAVES}/999999999/approval').status_code, 404)

    def test_another_company_leave_is_404(self):
        other = self.env['res.company'].create({'name': 'Other leave company', 'country_id': self.env.ref('base.sa').id})
        employee = self.env['hr.employee'].create({'name': 'Elsewhere', 'company_id': other.id})
        leave = self.env['hr.leave'].with_company(other).create({
            'employee_id': employee.id, 'holiday_status_id': self.unbalanced.id,
            'request_date_from': '2030-02-03', 'request_date_to': '2030-02-04',
        })
        self.login_as(self.officer)
        self.assertEqual(self.api('GET', f'{LEAVES}/{leave.id}/approval').status_code, 404)

    def test_a_bystander_sees_no_approval(self):
        leave = self.file_leave()
        self.login_as(self.bystander)
        self.assertEqual(self.api('GET', f'{LEAVES}/{leave.id}/approval').status_code, 404)

    def test_process_route_describes_the_governing_process(self):
        config = self._config_user()
        self.login_as(config)
        response = self.api('GET', PROCESS)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), {'process', 'href', 'can_manage'})
        self.assertTrue(body['can_manage'])
        self.assertEqual([step['resolver'] for step in body['process']['steps']], ['hr_leave_approver', 'hr_leave_officers'])
        self.assertTrue(all(step['resolver_label'] for step in body['process']['steps']))
        self.login_as(self.officer)
        self.assertFalse(self.api('GET', PROCESS).json()['can_manage'])
        self.login_as(self.employee)
        self.assertEqual(self.api('GET', PROCESS).status_code, 403)

    def test_default_process_route_creates_it_once_for_process_managers(self):
        self.archive_process()
        self.login_as(self.officer)
        self.assertEqual(self.api('POST', f'{PROCESS}/default', json={}).status_code, 403)
        self.login_as(self.ops_admin)
        self.assertEqual(self.api('POST', f'{PROCESS}/default', json={'name': 'x'}).status_code, 422)
        response = self.api('POST', f'{PROCESS}/default', json={})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(len(response.json()['process']['steps']), 2)
        self.assertEqual(self.api('POST', f'{PROCESS}/default', json={}).status_code, 409)
        self.assertEqual(self.process.state, 'published')

    def test_process_route_without_a_process_points_to_the_editor(self):
        self.archive_process()
        self.login_as(self._config_user())
        body = self.api('GET', PROCESS).json()
        self.assertIsNone(body['process'])
        self.assertTrue(body['href'].endswith('/new'))

    def _config_user(self):
        return self._user('lao_cfg', 'Config', ['liwan_core.role_employee', 'liwan_hr.role_hr_manager', 'liwan_operations.role_operations_manager'])
