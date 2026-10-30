# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .leave_cancellation_case import LeaveCancellationCase
from odoo.addons.liwan_api.controllers.common import ApiError


@tagged('post_install', '-at_install', 'liwan')
class TestLeaveCancellationModel(LeaveCancellationCase):
    def test_pending_retains_state_balance_and_work_entries(self):
        leave = self._approved_leave()
        resources = self.env['resource.calendar.leaves'].search([('holiday_id', '=', leave.id)])
        request = self._model().action_request(leave.id, 'Plans changed')
        self.assertEqual((request.state, request.revision, leave.state), ('pending', 1, 'validate'))
        self.assertEqual(self._model().action_request(leave.id, 'duplicate'), request)
        self.assertEqual(self.env['resource.calendar.leaves'].search([('holiday_id', '=', leave.id)]), resources)

    def test_aggregate_orm_cannot_forge_decision(self):
        leave = self._approved_leave()
        model = self._model()
        with self.assertRaises(AccessError):
            model.create({'leave_id': leave.id, 'state': 'approved', 'reviewer_id': self.manager.id})
        request = model.action_request(leave.id, 'First')
        for vals in ({'state': 'approved'}, {'reviewer_id': self.manager.id}, {'revision': 20}, {'company_id': self.env.company.id}, {'requester_id': self.manager.id}, {'leave_version': leave.write_date}):
            with self.assertRaises(AccessError):
                request.write(vals)
        with self.assertRaises(AccessError):
            request.unlink()

    def test_refusal_resubmission_preserves_events(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id, 'Repeated reason')
        request.with_user(self.manager).action_refuse(request.revision, 'Staff shortage')
        self.assertEqual(leave.state, 'validate')
        self.assertEqual(self._model().action_request(leave.id, 'Repeated reason'), request)
        self.assertEqual(request.state, 'pending')
        bodies = ' '.join(request.message_ids.mapped('body'))
        self.assertGreaterEqual(bodies.count('Repeated reason'), 2)
        self.assertIn('Staff shortage', bodies)
        self.assertFalse(request.reviewer_id)

    def test_no_self_decision_or_balance_manager_authority(self):
        leave = self._approved_leave(self.manager_employee)
        request = self._model(self.manager).action_request(leave.id)
        with self.assertRaises(AccessError):
            request.with_user(self.manager).action_approve(request.revision)
        user = self._user_with_leave_role('leave_balance_only', 'Balance only', ['hr.leave.manage', 'hr.leave.read', 'hr.employees.read'])
        with self.assertRaises(AccessError):
            request.with_user(user).action_refuse(request.revision, 'No')

    def test_stale_approval_can_be_refused_and_resubmitted(self):
        leave = self._approved_leave()
        request = self._model().action_request(leave.id, 'First')
        # Odoo uses a transaction timestamp; force a different valid persisted version.
        leave.write({'notes': 'Edited externally'})
        self.env.flush_all()
        request._liwan_write({'leave_version': '2000-01-01 00:00:00'})
        with self.assertRaises(ApiError) as error:
            request.with_user(self.manager).action_approve(request.revision)
        self.assertEqual(error.exception.status, 409)
        request.with_user(self.manager).action_refuse(request.revision, 'Reload request')
        self.assertEqual(self._model().action_request(leave.id, 'Fresh').leave_version, leave.write_date)
