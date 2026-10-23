# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged

from .leave_cancellation_case import LeaveCancellationCase
from odoo.addons.webvue_api.controllers.common import ApiError


@tagged('post_install', '-at_install', 'webvue')
class TestLeaveCancellationNative(LeaveCancellationCase):
    def test_manager_approval_runs_owner_wizard_and_real_manager_audit(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id, 'Employee reason')
        wizard_class = type(self.env['hr.holidays.cancel.leave'])
        original = wizard_class.action_cancel_leave
        actors = []

        def observe(wizard):
            actors.append((wizard.env.uid, wizard.env.is_superuser(), wizard.env.context['allowed_company_ids']))
            return original(wizard)
        with patch.object(wizard_class, 'action_cancel_leave', observe):
            request.with_user(self.manager).action_approve(request.revision, 'Manager reason')
        self.assertEqual(actors, [(self.employee.id, False, [self.env.company.id])])
        self.assertEqual(leave.state, 'cancel')
        self.assertEqual(request.reviewer_id, self.manager)
        self.assertEqual(request.initiator_id, self.employee)
        self.assertFalse(self.env['resource.calendar.leaves'].search([('holiday_id', '=', leave.id)]))
        bodies = ' '.join(leave.message_ids.mapped('body'))
        for text in ('Employee reason', 'Manager reason', self.manager.name, str(self.manager.id)):
            self.assertIn(text, bodies)
        with self.assertRaises(ApiError) as error:
            request.with_user(self.manager).action_approve(request.revision)
        self.assertEqual(error.exception.status, 409)

    def test_native_wizard_and_raw_write_cannot_bypass_policy(self):
        leave = self._approved_leave().with_user(self.employee)
        for context in ({}, {'leave_fast_create': True, 'webvue_cancellation_approved': True}):
            with self.assertRaises(AccessError):
                leave.with_context(**context).write({'state': 'cancel'})
            with self.assertRaises(AccessError):
                self.env['hr.holidays.cancel.leave'].with_user(self.employee).with_context(**context).create({'leave_id': leave.id}).action_cancel_leave()
        request = self._model().action_request(leave.id)
        self.env['webvue.hr.leave.settings'].with_user(self.manager).action_save('direct_employee', 0)
        with self.assertRaises(AccessError):
            self.env['hr.holidays.cancel.leave'].with_user(self.employee).create({'leave_id': leave.id}).action_cancel_leave()
        self.assertEqual(request.state, 'pending')

    def test_native_failure_rolls_back_approval_and_chatter(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        before = request.message_ids
        with patch.object(type(self.env['hr.holidays.cancel.leave']), 'action_cancel_leave', side_effect=ValidationError('Native veto')):
            with self.assertRaises(ValidationError):
                request.with_user(self.manager).action_approve(request.revision)
        self.assertEqual((request.state, request.revision, leave.state), ('pending', 1, 'validate'))
        self.assertEqual(request.message_ids, before)

    def test_manager_only_direct_has_real_initiator(self):
        self.env['webvue.hr.leave.settings'].with_user(self.manager).action_save('manager_only', 0)
        leave = self._approved_leave()
        with self.assertRaises(AccessError):
            self._model().action_request(leave.id)
        request = self._model(self.manager).action_direct_cancel(leave.id, 'Manager initiated')
        self.assertEqual((request.state, leave.state), ('approved', 'cancel'))
        self.assertEqual(request.initiator_id, self.manager)
        self.assertEqual(request.reviewer_id, self.manager)

    def test_owner_role_company_or_active_revocation_blocks_execution(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        self.env['webvue.access.service']._webvue_replace_assignments(self.employee, [])
        with self.assertRaises(AccessError):
            request.with_user(self.manager).action_approve(request.revision)
        self.assertEqual((request.state, leave.state), ('pending', 'validate'))

    def test_direct_employee_policy_uses_native_owner(self):
        self.env['webvue.hr.leave.settings'].with_user(self.manager).action_save('direct_employee', 0)
        leave = self._approved_leave()
        self.env['hr.holidays.cancel.leave'].with_user(self.employee).create({'leave_id': leave.id, 'reason': 'Direct'}).action_cancel_leave()
        self.assertEqual(leave.state, 'cancel')

    def test_historical_approval_and_context_cannot_issue_marker(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        # Privileged fixture builds a historical decision without issuing the transaction marker.
        request._webvue_write({'state': 'approved', 'revision': 2, 'reviewer_id': self.manager.id})
        for context in ({'cancellation_id': request.id, 'revision': 2}, {'webvue_cancellation_approved': True, 'leave_fast_create': True}):
            with self.assertRaises(AccessError):
                self.env['hr.holidays.cancel.leave'].with_user(self.employee).with_context(**context).create({'leave_id': leave.id}).action_cancel_leave()
        self.assertEqual(leave.state, 'validate')

    def test_manager_direct_resolves_pending_with_revision(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        with self.assertRaises(ApiError) as error:
            self._model(self.manager).action_direct_cancel(leave.id)
        self.assertEqual(error.exception.status, 422)
        result = self._model(self.manager).action_direct_cancel(leave.id, 'Direct decision', request.revision)
        self.assertEqual(result, request)
        self.assertEqual((result.state, leave.state), ('approved', 'cancel'))
        self.assertFalse(self._model(self.manager).search([('state', '=', 'pending')]))

    def test_balance_manager_cannot_direct_cancel(self):
        leave = self._approved_leave()
        user = self._user_with_leave_role('cancel_balance_manager', 'Balance manager', ['hr.leave.manage', 'hr.leave.read', 'hr.employees.read'])
        with self.assertRaises(AccessError):
            self._model(user).action_direct_cancel(leave.id, 'Not authorized')
        self.assertEqual(leave.state, 'validate')

    def test_inactive_owner_and_reassigned_account_block_execution(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        self.employee.active = False
        with self.assertRaises(AccessError):
            request.with_user(self.manager).action_approve(request.revision)
        self.employee.active = True
        reassigned = self._user_with_leave_role('cancellation_reassigned', 'Reassigned user', ['hr.leave.read', 'hr.leave.request', 'hr.employees.read'])
        self.staff.user_id = reassigned
        with self.assertRaises(AccessError):
            request.read(['reason'])
        with self.assertRaises(AccessError):
            request.with_user(self.manager).action_approve(request.revision)

    def test_past_date_and_validated_work_entry_veto_remain_native(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        # Actual installed hr_work_entry_holidays veto, no patched can_cancel value.
        entry = self.env['hr.work.entry'].create({
            'employee_id': self.staff.id, 'version_id': self.staff.version_id.id, 'date': self.monday,
            'duration': 8, 'work_entry_type_id': self.kind.work_entry_type_id.id, 'leave_id': leave.id,
        })
        entry.action_validate()
        self.assertEqual(entry.state, 'validated')
        with self.assertRaises(ValidationError):
            request.with_user(self.manager).action_approve(request.revision)
        self.assertEqual((request.state, leave.state, entry.state, entry.active), ('pending', 'validate', 'validated', True))
        entry.write({'state': 'draft'})
        leave.invalidate_recordset(['can_cancel'])
        self.assertTrue(leave.with_user(self.employee).can_cancel)
        with patch.object(fields.Date, 'today', return_value=self.monday + timedelta(days=1)):
            leave.invalidate_recordset(['can_cancel'])
            with self.assertRaises(ValidationError):
                request.with_user(self.manager).action_approve(request.revision)
        self.assertEqual((request.state, leave.state), ('pending', 'validate'))

    def test_native_cancellation_archives_leave_entry_and_regenerates_attendance_once(self):
        self.staff.version_id.contract_date_start = fields.Date.today()
        leave = self._approved_leave()
        entry = self.env['hr.work.entry'].create({
            'employee_id': self.staff.id, 'version_id': self.staff.version_id.id, 'date': self.monday,
            'duration': 8, 'work_entry_type_id': self.kind.work_entry_type_id.id, 'leave_id': leave.id,
        })
        request = self._model().action_request(leave.id)
        request.with_user(self.manager).action_approve(request.revision)
        self.assertFalse(entry.active)
        attendance = self.env['hr.work.entry'].search([('employee_id', '=', self.staff.id), ('date', '=', self.monday), ('active', '=', True)])
        self.assertTrue(attendance)
        self.assertFalse(attendance.mapped('leave_id'))
        self.assertEqual(len(attendance), 1)
        self.assertEqual(leave.state, 'cancel')

    def test_owner_company_access_revocation_fails_closed(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        foreign = self.env['res.company'].create({'name': 'Owner reassigned company'})
        self.employee.write({'company_id': foreign.id, 'company_ids': [(6, 0, foreign.ids)]})
        with self.assertRaises(AccessError):
            request.with_user(self.manager).action_approve(request.revision)
        self.assertEqual((request.with_user(self.manager).state, leave.state), ('pending', 'validate'))

    def test_raw_company_and_revoked_approver_access_is_rechecked(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id)
        self.env['webvue.access.service']._webvue_replace_assignments(self.manager, [])
        with self.assertRaises(AccessError):
            request.with_user(self.manager).action_approve(request.revision)
        with self.assertRaises(AccessError):
            request.with_user(self.manager).read(['reason'])
        foreign = self.env['res.company'].create({'name': 'Cancellation other company'})
        model = self._model().with_context(allowed_company_ids=foreign.ids)
        with self.assertRaises(AccessError):
            model.action_request(leave.id)

    def test_privileged_owner_cannot_be_native_execution_principal(self):
        owner = self.env.ref('base.user_root')
        employee = self.env['hr.employee'].search([('user_id', '=', owner.id), ('company_id', '=', self.env.company.id)], limit=1)
        if not employee:
            employee = self.env['hr.employee'].create({'name': 'Operator employee fixture', 'user_id': owner.id, 'company_id': self.env.company.id})
        leave = self._approved_leave(employee)
        with self.assertRaises(AccessError):
            self._model(self.manager).action_direct_cancel(leave.id, 'Ordinary account required')
        self.assertEqual(leave.state, 'validate')
        self.assertFalse(self._model(self.manager).search([('leave_id', '=', leave.id)]))
