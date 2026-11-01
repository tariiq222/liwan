# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.exceptions import AccessError, UserError
from odoo.tests import tagged

from .common import LEAVES, LeaveApprovalCase
from odoo.addons.liwan_hr.tests.common import set_hr_feature
from odoo.addons.liwan_hr_operations.hooks import post_init_hook
from odoo.addons.liwan_hr_operations.models.common import APPROVER, OFFICERS
from odoo.addons.liwan_operations.models.operation_request import (
    OperationExecutionError,
)


@tagged('post_install', '-at_install', 'liwan')
class TestLeaveApproval(LeaveApprovalCase):

    def test_install_seeds_the_manager_then_hr_stages(self):
        process = self.process
        self.assertEqual((process.state, process.purpose, process.execution_kind), ('published', 'employee', 'hr_leave'))
        self.assertEqual([step.reviewer_resolver for step in process.step_ids.sorted('sequence')], [APPROVER, OFFICERS])
        self.annual._write({'leave_validation_type': 'hr'})
        self.annual.invalidate_recordset()
        post_init_hook(self.env)
        self.assertEqual(self.annual.leave_validation_type, 'both')
        self.assertEqual(self.process, process, 'the hook seeds a process only for a company that has none')

    def _late_type(self, **vals):
        return self.env['hr.leave.type'].create({'name': 'Late type', **vals})

    def test_a_type_created_after_install_keeps_the_stage_one_refusal(self):
        late = self._late_type()
        self.assertEqual(late.leave_validation_type, 'both')
        self.assertEqual(self._late_type(leave_validation_type='manager').leave_validation_type, 'both')
        late.leave_validation_type = 'hr'
        self.assertEqual(late.leave_validation_type, 'both')
        self.env['hr.leave.allocation'].create({
            'employee_id': self.staff.id, 'holiday_status_id': late.id, 'number_of_days': 10,
            'date_from': date.today().replace(month=1, day=1),
        }).action_approve()
        leave = self.file_leave(leave_type_id=late.id)
        self.reject(self.approval_request(leave), self.manager_user, 'Busy week')
        leave.invalidate_recordset()
        self.assertEqual(leave.state, 'refuse')

    def test_types_without_validation_stay_as_they_are(self):
        free = self._late_type(leave_validation_type='no_validation')
        self.assertEqual(free.leave_validation_type, 'no_validation')
        free.leave_validation_type = 'both'
        self.assertEqual(free.leave_validation_type, 'both')

    def test_manager_then_officer_validate_the_leave(self):
        leave = self.file_leave()
        record = self.approval_request(leave)
        self.assertEqual((leave.state, record.state, record.execution_kind), ('confirm', 'pending', 'hr_leave'))
        self.assertEqual(record.stage_snapshot[0]['reviewer_ids'], [self.manager_user.id])
        self.assertEqual(sorted(record.stage_snapshot[1]['reviewer_ids']), sorted([self.officer.id, self.officer_two.id]))
        self.assertEqual(record.name, f'Leave request: Sara, {leave.request_date_from} - {leave.request_date_to}')
        self.assertFalse(record.description)
        self.approve(record, self.manager_user)
        leave.invalidate_recordset()
        self.assertEqual((leave.state, record.state), ('confirm', 'pending'))
        self.approve(record, self.officer)
        leave.invalidate_recordset()
        record.invalidate_recordset()
        self.assertEqual((leave.state, record.state), ('validate', 'done'))

    def test_manager_refusal_refuses_the_leave_with_the_comment(self):
        leave = self.file_leave()
        record = self.approval_request(leave)
        self.reject(record, self.manager_user, 'Busy week')
        leave.invalidate_recordset()
        self.assertEqual((leave.state, record.state), ('refuse', 'rejected'))
        self.assertIn('Busy week', ' '.join(str(body) for body in leave.message_ids.mapped('body')))

    def test_a_manager_without_hr_rights_reads_only_the_leave_awaiting_their_decision(self):
        mine = self.file_leave()
        theirs = self.env['hr.leave'].create({
            'employee_id': self.bystander_employee.id, 'holiday_status_id': self.unbalanced.id,
            'request_date_from': mine.request_date_from, 'request_date_to': mine.request_date_to,
        })
        as_manager = self.env['hr.leave'].with_user(self.manager_user)
        self.assertEqual(as_manager.search([('id', 'in', (mine | theirs).ids)]), mine)
        self.reject(self.approval_request(mine), self.manager_user)
        self.assertFalse(as_manager.search([('id', 'in', (mine | theirs).ids)]))

    def test_a_leave_changed_elsewhere_fails_as_stale_and_rolls_back(self):
        leave = self.file_leave()
        record = self.approval_request(leave)
        self.approve(record, self.manager_user)
        leave.write({'notes': 'Changed by someone else'})
        with self.assertRaises(OperationExecutionError):
            self.approve(record, self.officer)
        record.invalidate_recordset()
        leave.invalidate_recordset()
        self.assertEqual((record.state, record.execution_count, leave.state), ('pending', 0, 'confirm'))

    def test_a_stale_leave_cannot_be_refused_either(self):
        leave = self.file_leave()
        leave.write({'notes': 'Changed by someone else'})
        with self.assertRaises(OperationExecutionError):
            self.reject(self.approval_request(leave), self.manager_user)
        self.assertEqual(leave.state, 'confirm')

    def test_hr_routes_answer_409_while_the_workflow_governs(self):
        leave = self.file_leave()
        self.login_as(self.officer)
        for action in ('approve', 'refuse'):
            response = self.api('POST', f'{LEAVES}/{leave.id}/{action}', json={})
            self.assertEqual((response.status_code, response.json()['code']), (409, 'approval_governed'), response.text)
        dumped = self.api('GET', f'{LEAVES}/{leave.id}').json()
        self.assertEqual((dumped['can_approve'], dumped['can_refuse']), (False, False))
        with self.assertRaises(UserError):
            leave.with_user(self.officer).action_approve()

    def test_the_officer_cannot_skip_the_manager_stage(self):
        """Issue #237: a two-approval type needs the manager first, then HR."""
        leave = self.file_leave()
        record = self.approval_request(leave)
        self.assertFalse(record.with_user(self.officer)._operations_allowed_actions()['approve'])
        with self.assertRaises(AccessError):
            self.approve(record, self.officer)
        self.assertTrue(record.with_user(self.manager_user)._operations_allowed_actions()['approve'])
        self.approve(record, self.manager_user)
        self.assertTrue(record.with_user(self.officer)._operations_allowed_actions()['approve'])
        leave.invalidate_recordset()
        self.assertEqual(leave.state, 'confirm')
        self.approve(record, self.officer)
        leave.invalidate_recordset()
        self.assertEqual(leave.state, 'validate')

    def test_without_a_published_process_the_hr_path_applies(self):
        self.archive_process()
        leave = self.file_leave()
        self.assertFalse(leave.liwan_approval_request_ids)
        self.login_as(self.officer)
        self.assertEqual(self.api('POST', f'{LEAVES}/{leave.id}/approve', json={}).status_code, 200)
        leave.invalidate_recordset()
        self.assertEqual(leave.state, 'validate')

    def test_with_operations_off_the_hr_path_applies_and_closes_the_open_request(self):
        approved = self.file_leave()
        refused = self.file_leave(weeks=2)
        set_hr_feature(self, 'operations.enabled', False)
        self.login_as(self.officer)
        self.assertEqual(self.api('POST', f'{LEAVES}/{approved.id}/approve', json={}).status_code, 200)
        self.assertEqual(self.api('POST', f'{LEAVES}/{refused.id}/refuse', json={'reason': 'No cover'}).status_code, 200)
        set_hr_feature(self, 'operations.enabled', True)
        for leave, state in ((approved, 'validate'), (refused, 'refuse')):
            leave.invalidate_recordset()
            record = self.approval_request(leave)
            self.assertEqual((leave.state, record.state), (state, 'withdrawn'))
            self.assertIn('closed_externally', record.event_ids.mapped('kind'))
        pending = self.env['liwan.operation.request'].with_user(self.manager_user).search([('state', '=', 'pending')])
        self.assertFalse(pending)

    def test_withdrawing_from_hr_withdraws_the_request(self):
        leave = self.file_leave()
        record = self.approval_request(leave)
        self.login_as(self.employee)
        response = self.api('POST', f'{LEAVES}/{leave.id}/cancel', json={})
        self.assertEqual(response.status_code, 200, response.text)
        record.invalidate_recordset()
        self.assertFalse(leave.exists())
        self.assertEqual(record.state, 'withdrawn')
        self.assertIn('withdrawn', record.event_ids.mapped('kind'))

    def test_a_leave_without_another_approver_is_refused_with_422(self):
        self.staff.leave_manager_id = False
        self.login_as(self.employee)
        before = self.env['hr.leave'].search_count([])
        response = self.api('POST', LEAVES, json={
            'leave_type_id': self.annual.id, 'date_from': '2030-01-07', 'date_to': '2030-01-08', 'notes': '',
        })
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.env['hr.leave'].search_count([]), before)

    def test_hr_files_a_leave_on_behalf_and_the_employee_follows_it(self):
        leave = self.file_leave(self.officer, employee_id=self.staff.id)
        record = self.approval_request(leave)
        self.assertEqual(record.requester_id, self.officer)
        self.assertEqual(record.stage_snapshot[0]['reviewer_ids'], [self.manager_user.id])
        self.assertEqual(record.stage_snapshot[1]['reviewer_ids'], [self.officer_two.id])
        self.login_as(self.employee)
        self.assertEqual(self.api('GET', f'{LEAVES}/{leave.id}/approval').status_code, 200)

    def test_the_workflow_owns_the_leave_request_actions(self):
        leave = self.file_leave()
        record = self.approval_request(leave)
        actions = record.with_user(self.employee)._operations_allowed_actions()
        self.assertEqual((actions['withdraw'], actions['edit'], actions['return']), (False, False, False))
        with self.assertRaises(AccessError):
            record.with_user(self.employee).action_withdraw(record.revision)
        with self.assertRaises(AccessError):
            self.decide_return(record)
        with self.assertRaises(AccessError):
            record.with_user(self.employee).action_update(record.revision, 'Renamed', '')
        with self.assertRaises(AccessError):
            self.env['liwan.operation.request'].with_user(self.employee).create({'name': 'Direct', 'process_id': self.process.id, 'target_id': leave.id})

    def decide_return(self, record):
        record = record.with_user(self.manager_user)
        return record.action_return(record.revision, 'Please fix')
