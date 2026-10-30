# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .leave_cancellation_case import LeaveCancellationCase
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.models.leave_cancellation import PENDING_PROBE_MARKER
from odoo.addons.liwan_hr.serializers.hr_leave import dump_leave


@tagged('post_install', '-at_install', 'liwan')
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

    def test_changed_owner_cannot_bypass_hidden_pending_request_with_direct_native_wizard(self):
        leave = self._approved_leave()
        aggregate = self._model().action_request(leave.id, 'Original private reason')
        replacement = self._change_owner(leave)
        self.env['liwan.hr.leave.settings'].with_user(self.manager).action_save('direct_employee', 0)
        self.assertFalse(self._model(replacement).search([('leave_id', '=', leave.id)]))
        data = dump_leave(leave.with_user(replacement))
        self.assertIsNone(data['cancellation'])
        self.assertFalse(data['can_cancel'])
        with self.assertRaises(AccessError):
            self.env['hr.holidays.cancel.leave'].with_user(replacement).create({'leave_id': leave.id}).action_cancel_leave()
        self.assertEqual((leave.state, aggregate.with_user(self.manager).state), ('validate', 'pending'))
        self.assertFalse(self._model(replacement).search([('leave_id', '=', leave.id)]))
        with self.assertRaises(AccessError):
            aggregate.message_ids.with_user(replacement).read(['body'])

    def test_pending_probe_is_private_exact_and_does_not_leak_cached_visibility(self):
        leave = self._approved_leave()
        aggregate = self._model().action_request(leave.id, 'Original private reason')
        replacement = self._change_owner(leave)
        model = self._model(replacement)
        # Warm the ordinary denial domain before the private count, then check it
        # again after success and after a raised exception inside marked().
        self.assertFalse(model.search([('leave_id', '=', leave.id)]))
        self.assertTrue(model._liwan_has_pending_owner_cancellation(leave.with_user(replacement)))
        self.assertNotIn(PENDING_PROBE_MARKER, self.env.cr.precommit.data)
        self.assertFalse(model.search([('leave_id', '=', leave.id)]))

        def fail_probe(*args, **kwargs):
            self.assertEqual(self.env.cr.precommit.data[PENDING_PROBE_MARKER], {leave.id})
            message = 'Probe failed'
            raise RuntimeError(message)

        with self.assertRaises(RuntimeError), patch.object(type(model), 'search_count', side_effect=fail_probe):
            model._liwan_has_pending_owner_cancellation(leave.with_user(replacement))
        self.assertNotIn(PENDING_PROBE_MARKER, self.env.cr.precommit.data)
        self.assertFalse(model.search([('leave_id', '=', leave.id)]))
        forged = model.with_context(**{PENDING_PROBE_MARKER: [leave.id], 'liwan_cancellation_approved': True})
        self.assertFalse(forged.search([('leave_id', '=', leave.id)]))
        with self.assertRaises(AccessError):
            aggregate.with_user(replacement).read(['reason'])
        other_leave = self._approved_leave(self.manager_employee)
        with self.assertRaises(AccessError):
            model._liwan_has_pending_owner_cancellation(other_leave.with_user(replacement))
        with self.assertRaises(AccessError):
            self._model(self.manager)._liwan_has_pending_owner_cancellation(leave.with_user(self.manager))
        foreign = self.env['res.company'].create({'name': 'Pending probe other company'})
        replacement.company_ids = [(4, foreign.id)]
        with self.assertRaises(AccessError):
            model.with_context(allowed_company_ids=foreign.ids)._liwan_has_pending_owner_cancellation(leave.with_user(replacement))
        self.env['liwan.access.service']._liwan_replace_assignments(replacement, [])
        with self.assertRaises(AccessError):
            model._liwan_has_pending_owner_cancellation(leave.with_user(replacement))

    def test_refused_hidden_request_does_not_block_current_owner_direct_cancellation(self):
        leave = self._approved_leave()
        aggregate = self._model().action_request(leave.id, 'Original private reason')
        replacement = self._change_owner(leave)
        aggregate.with_user(self.manager).action_refuse(1, 'Ownership changed')
        self.env['liwan.hr.leave.settings'].with_user(self.manager).action_save('direct_employee', 0)
        self.assertFalse(self._model(replacement)._liwan_has_pending_owner_cancellation(leave.with_user(replacement)))
        self.env['hr.holidays.cancel.leave'].with_user(replacement).create({'leave_id': leave.id}).action_cancel_leave()
        self.assertEqual(leave.state, 'cancel')
        self.assertEqual((aggregate.with_user(self.manager).state, aggregate.requester_id), ('refused', self.employee))
        self.assertFalse(self._model(replacement).search([('leave_id', '=', leave.id)]))

    def test_neither_original_requester_nor_current_owner_may_review_after_reassignment(self):
        leave = self._approved_leave()
        aggregate = self._model().action_request(leave.id)
        replacement = self._change_owner(leave)
        for user in (self.employee, replacement):
            self.env['liwan.access.service']._liwan_replace_assignments(user, [{
                'role_id': self.env.ref('liwan_hr.role_hr_manager').id, 'company_id': self.env.company.id,
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
        self.env['liwan.access.service']._liwan_replace_assignments(self.manager, [])
        with self.assertRaises(AccessError):
            aggregate.with_user(self.manager).action_refuse(1, 'Revoked approver')
        self.assertEqual(self.env['liwan.hr.leave.cancellation'].browse(aggregate.id).state, 'pending')
