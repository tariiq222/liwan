# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.tests import new_test_user, tagged

from .common import (
    LEAVES,
    STAGE_MANAGER,
    STAGE_OFFICERS,
    LeaveApprovalCase,
    next_monday,
)

REQUESTS = '/api/v1/operations/requests'
OPERATIONS_REVIEWER = 'liwan_operations.role_operations_reviewer'
EMPLOYEE_ROLE = 'liwan_core.role_employee'


@tagged('post_install', '-at_install', 'liwan')
class TestLeaveDeciders(LeaveApprovalCase):
    """Who decides and who is kept out of deciding a leave request, through the operations routes."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.staff.leave_manager_id = False

    def _approve_only_user(self, login='lao_apronly', extra=()):
        """A custom role holding the leave approval capability and no operations permission at all."""
        keys = ['hr.leave.approve', 'hr.leave.read', 'hr.employees.read', *extra]
        role = self.env['liwan.access.role'].create({
            'name_ar': 'معتمد إجازات', 'type': 'custom', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        user = new_test_user(self.env, login=login, password=f'{login}_pass_123', name='Approve Only', groups='liwan_core.group_employee')
        self.service._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': self.env.company.id}])
        self.assertFalse(self.service._liwan_has_capability(user, 'operations.requests.read'))
        return user

    def _decide(self, user, record, action):
        self.login_as(user)
        return self.api('POST', f'{REQUESTS}/{record.id}/{action}', json={'revision': record.revision, 'comment': 'because'})

    def _unrelated_request(self):
        reviewer = self._user('lao_rv', 'Reviewer', [EMPLOYEE_ROLE, OPERATIONS_REVIEWER])
        process = self.env['liwan.operation.process'].with_user(self.ops_admin).create({'name': 'Plain'})
        process.action_configure(0, 'Plain', '', 'approval', [{'name': 'Review', 'reviewer_ids': [reviewer.id]}], purpose='work')
        process.action_publish(process.revision)
        record = self.env['liwan.operation.request'].with_user(self.employee).create({'name': 'Plain request', 'process_id': process.id})
        record.action_submit(record.revision)
        return record

    def _assert_decides(self, officer, *, approves=True):
        approved = self.approval_request(self.file_leave())
        self.assertIn(officer.id, approved.stage_snapshot[1]['reviewer_ids'])
        self.assertTrue(approved.with_user(officer)._operations_allowed_actions()['approve'])
        self.login_as(officer)
        self.assertEqual(self.api('GET', f'{REQUESTS}/{approved.id}').status_code, 200)
        pending = self.api('GET', f'{REQUESTS}?scope=pending').json()
        self.assertIn(approved.id, [item['id'] for item in pending['items']])
        if approves:
            response = self._decide(officer, approved, 'approve')
            self.assertEqual(response.status_code, 200, response.text)
            approved.hr_leave_id.invalidate_recordset()
            self.assertEqual(approved.hr_leave_id.state, 'validate')
        refused = self.approval_request(self.file_leave(weeks=2))
        response = self._decide(officer, refused, 'reject')
        self.assertEqual(response.status_code, 200, response.text)
        refused.invalidate_recordset()
        self.assertEqual((refused.state, refused.hr_leave_id.state), ('rejected', 'refuse'))

    def _assert_blind_to_unrelated(self, officer):
        other = self._unrelated_request()
        self.login_as(officer)
        self.assertEqual(self.api('GET', f'{REQUESTS}/{other.id}').status_code, 404)
        self.assertNotIn(other.id, [item['id'] for item in self.api('GET', f'{REQUESTS}?scope=pending').json()['items']])
        self.assertEqual(self.api('POST', f'{REQUESTS}/{other.id}/approve', json={'revision': other.revision, 'comment': ''}).status_code, 404)

    def test_a_custom_role_with_only_leave_approval_decides_through_the_operations_routes(self):
        # Approving executes the stock leave approval, which also reads employee calendars: that needs the
        # employee manage capability (the owner's 2026-10-19 rule keeps leave approval from opening those).
        officer = self._approve_only_user('lao_apronly', extra=('hr.employees.manage',))
        self._assert_decides(officer)
        self._assert_blind_to_unrelated(officer)

    def test_a_custom_role_with_only_leave_approval_sees_and_refuses_through_the_operations_routes(self):
        officer = self._approve_only_user('lao_aprref')
        self._assert_decides(officer, approves=False)
        self._assert_blind_to_unrelated(officer)

    def test_an_hr_manager_without_the_employee_role_decides_through_the_operations_routes(self):
        officer = self._user('lao_hronly2', 'HR Only', ['liwan_hr.role_hr_manager'])
        self._assert_decides(officer)
        self._assert_blind_to_unrelated(officer)

    def _named_process(self, steps):
        self.archive_process()
        return self.publish_process(steps, name='Named leave approval')

    def _named_officer(self, login, roles=(EMPLOYEE_ROLE, 'liwan_hr.role_hr_manager', OPERATIONS_REVIEWER)):
        user = self._user(login, 'Named Officer', list(roles))
        employee = self.env['hr.employee'].create({'name': 'Named Officer', 'user_id': user.id, 'company_id': self.env.company.id})
        self.env['hr.leave.allocation'].create({
            'employee_id': employee.id, 'holiday_status_id': self.annual.id, 'number_of_days': 30,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()
        return user, employee

    def _file_on_behalf(self, employee):
        self.login_as(self.officer)
        start = next_monday(0)
        return self.api('POST', LEAVES, json={
            'leave_type_id': self.annual.id, 'date_from': start.isoformat(), 'date_to': start.isoformat(),
            'notes': '', 'employee_id': employee.id,
        })

    def test_the_employee_never_reviews_their_own_leave_at_a_named_stage(self):
        own, employee = self._named_officer('lao_named1')
        other, _employee = self._named_officer('lao_named2')
        self._named_process([{'name': 'Named', 'reviewer_ids': [own.id, other.id]}, STAGE_OFFICERS])
        response = self._file_on_behalf(employee)
        self.assertEqual(response.status_code, 201, response.text)
        record = self.approval_request(self.env['hr.leave'].browse(response.json()['id']))
        self.assertEqual(record.stage_snapshot[0]['reviewer_ids'], [other.id])
        self.assertNotIn(own.id, record.stage_snapshot[1]['reviewer_ids'])

    def test_a_named_stage_whose_only_reviewer_is_the_employee_refuses_the_submission(self):
        own, employee = self._named_officer('lao_named3')
        self._named_process([STAGE_MANAGER, {'name': 'Final', 'reviewer_ids': [own.id]}])
        before = self.env['hr.leave'].search_count([])
        response = self._file_on_behalf(employee)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn('Final', response.json()['message'])
        self.assertEqual(self.env['hr.leave'].search_count([]), before)
