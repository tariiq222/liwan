# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .leave_cancellation_case import LeaveCancellationCase


@tagged('post_install', '-at_install', 'liwan')
class TestLeaveCancellationHttp(LeaveCancellationCase):
    def test_default_request_and_manager_decision(self):
        leave = self._approved_leave()
        self._as_staff()
        base = f'/api/v1/hr/leave/requests/{leave.id}'
        pending = self.api('POST', base + '/cancel', {'reason': 'Plans changed'})
        self.assertEqual(pending.status_code, 200, pending.text)
        body = pending.json()
        self.assertEqual((body['state'], body['cancellation']['state']), ('validate', 'pending'))
        self.assertFalse(body['can_cancel'])
        self.assertFalse(body['can_approve_cancellation'])
        self.assertNotIn('leave_version', body['cancellation'])
        self._as_manager()
        queue = self.api('GET', '/api/v1/hr/leave/requests?cancellation_state=pending')
        self.assertEqual(queue.status_code, 200, queue.text)
        self.assertIn(leave.id, [item['id'] for item in queue.json()['items']])
        revision = body['cancellation']['revision']
        approved = self.api('POST', base + '/cancellation/approve', {'revision': revision})
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()['state'], 'cancel')
        self.assertEqual(self.api('POST', base + '/cancellation/approve', {'revision': revision}).status_code, 409)

    def test_strict_actions_and_filters(self):
        leave = self._approved_leave()
        self._as_staff()
        base = f'/api/v1/hr/leave/requests/{leave.id}'
        self.assertEqual(self.api('POST', base + '/cancel', {'state': 'cancel'}).status_code, 422)
        pending = self.api('POST', base + '/cancel', {}).json()
        self.assertEqual(self.api('POST', base + '/cancellation/approve', {'revision': pending['cancellation']['revision']}).status_code, 403)
        self._as_manager()
        for payload in ({}, {'revision': True}, {'revision': 1, 'reviewer_id': self.manager.id}):
            self.assertEqual(self.api('POST', base + '/cancellation/approve', payload).status_code, 422)
        self.assertEqual(self.api('POST', base + '/cancellation/refuse', {'revision': 1, 'reason': '  '}).status_code, 422)
        self.assertEqual(self.api('GET', '/api/v1/hr/leave/requests?cancellation_state=bogus').status_code, 422)

    def test_all_three_policy_responses_and_pending_survives_change(self):
        leave = self._approved_leave()
        settings = self.env['liwan.hr.leave.settings'].with_user(self.manager)
        self._as_staff()
        base = f'/api/v1/hr/leave/requests/{leave.id}'
        pending = self.api('POST', base + '/cancel', {}).json()['cancellation']
        settings.action_save('manager_only', 0)
        self.assertEqual(self.api('GET', base).json()['cancellation']['state'], 'pending')
        self._as_manager()
        refused = self.api('POST', base + '/cancellation/refuse', {'revision': pending['revision'], 'reason': 'Not now'})
        self.assertEqual(refused.status_code, 200, refused.text)
        self._as_staff()
        self.assertEqual(self.api('POST', base + '/cancel', {}).status_code, 403)
        row = settings._liwan_current()
        settings.action_save('direct_employee', row.revision)
        direct = self.api('POST', base + '/cancel', {'reason': 'Direct'})
        self.assertEqual(direct.status_code, 200, direct.text)
        self.assertEqual(direct.json()['state'], 'cancel')
