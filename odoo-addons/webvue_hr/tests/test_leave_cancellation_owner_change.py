# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .leave_cancellation_case import LeaveCancellationCase
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_hr.serializers.hr_leave import dump_leave


@tagged('post_install', '-at_install', 'webvue')
class TestLeaveCancellationOwnerChange(LeaveCancellationCase):
    def _change_owner(self, leave, change_employee=False):
        replacement = self._user_with_leave_role(
            'cancel_replacement', 'Replacement employee',
            ['hr.leave.read', 'hr.leave.request', 'hr.employees.read'],
        )
        if change_employee:
            employee = self.env['hr.employee'].create({
                'name': 'Replacement employee', 'user_id': replacement.id, 'company_id': self.env.company.id,
            })
            leave.action_refuse()
            leave.employee_id = employee
            leave.action_approve()
        else:
            self.staff.user_id = replacement
        self.env.flush_all()
        return replacement

    def _assert_manager_can_refuse_changed_owner(self, change_employee=False):
        leave = self._approved_leave()
        aggregate = self._model().action_request(leave.id, 'Original private reason')
        original_requester, original_initiator = aggregate.requester_id, aggregate.initiator_id
        replacement = self._change_owner(leave, change_employee=change_employee)
        manager_row = aggregate.with_user(self.manager)
        with self.assertRaises(AccessError):
            manager_row.action_approve(1, 'Approval must stay closed')
        result = manager_row.action_refuse(1, 'Ownership changed; request closed')
        self.assertEqual((result.state, result.revision, leave.state), ('refused', 2, 'validate'))
        self.assertEqual((result.requester_id, result.initiator_id), (original_requester, original_initiator))
        self.assertEqual((result.reason, result.review_reason), ('Original private reason', 'Ownership changed; request closed'))
        self.assertEqual(result.reviewer_id, self.manager)
        self.assertIn('Original private reason', ' '.join(result.message_ids.mapped('body')))
        self.assertFalse(self._model(replacement).search([('leave_id', '=', leave.id)]))
        with self.assertRaises(AccessError):
            aggregate.with_user(replacement).read(['reason', 'requester_id'])
        with self.assertRaises(ApiError) as error:
            manager_row.action_refuse(1, 'Replay')
        self.assertEqual(error.exception.status, 409)

    def test_manager_refuses_after_employee_account_reassignment_without_rebinding_history(self):
        self._assert_manager_can_refuse_changed_owner()

    def test_manager_refuses_after_native_leave_employee_reassignment_without_rebinding_history(self):
        self._assert_manager_can_refuse_changed_owner(change_employee=True)

    def test_changed_owner_has_refusal_but_no_approval_flag(self):
        leave = self._approved_leave()
        self._model().action_request(leave.id)
        self._change_owner(leave)
        data = dump_leave(leave.with_user(self.manager))
        self.assertFalse(data['can_approve_cancellation'])
        self.assertTrue(data['can_refuse_cancellation'])

    def test_neither_original_requester_nor_current_owner_may_review_after_reassignment(self):
        leave = self._approved_leave()
        aggregate = self._model().action_request(leave.id)
        replacement = self._change_owner(leave)
        for user in (self.employee, replacement):
            self.env['webvue.access.service']._webvue_replace_assignments(user, [{
                'role_id': self.env.ref('webvue_hr.role_hr_manager').id, 'company_id': self.env.company.id,
            }])
            with self.assertRaises(AccessError):
                aggregate.with_user(user).action_refuse(1, 'Self decision')
        self.assertEqual(aggregate.with_user(self.manager).state, 'pending')

    def test_changed_owner_refusal_keeps_company_and_revoked_capability_fences(self):
        leave = self._approved_leave()
        aggregate = self._model().action_request(leave.id)
        self._change_owner(leave)
        foreign = self.env['res.company'].create({'name': 'Other cancellation company'})
        self.manager.company_ids = [(4, foreign.id)]
        with self.assertRaises(AccessError):
            aggregate.with_user(self.manager).with_context(allowed_company_ids=foreign.ids).action_refuse(1, 'Wrong company')
        self.env['webvue.access.service']._webvue_replace_assignments(self.manager, [])
        with self.assertRaises(AccessError):
            aggregate.with_user(self.manager).action_refuse(1, 'Revoked approver')
        self.assertEqual(self.env['webvue.hr.leave.cancellation'].browse(aggregate.id).state, 'pending')
