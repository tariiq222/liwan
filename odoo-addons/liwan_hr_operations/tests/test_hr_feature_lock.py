# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Leave approval from HR is refused when the tenant does not hold the HR application."""
from odoo.tests import tagged

from .common import LEAVES, PROCESS, LeaveApprovalCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_hr_operations.controllers.leave_approval import FEATURES
from odoo.addons.liwan_hr_operations.models.common import KIND

EDITOR = f'{PROCESS}/editor'
READ_ROUTES = (
    ('GET', f'{LEAVES}/1/approval'),
    ('GET', PROCESS),
    ('GET', EDITOR),
    ('GET', f'{EDITOR}/resolvers'),
)
WRITE_ROUTES = (
    ('POST', f'{LEAVES}/1/approval'),
    ('POST', f'{PROCESS}/default'),
    ('DELETE', PROCESS),
    ('PATCH', EDITOR),
)


@tagged('post_install', '-at_install', 'liwan')
class TestLeaveApprovalNeedsHr(LeaveApprovalCase):

    def _assert_refused(self, method, path):
        response = self.api(method, path, json={} if method != 'GET' else None)
        self.assertEqual(response.status_code, 403, f'{method} {path}: {response.text}')
        self.assertEqual(response.json()['code'], 'feature_not_included', f'{method} {path}')

    def _assert_not_refused(self, method, path):
        response = self.api(method, path)
        self.assertNotEqual(response.json().get('code'), 'feature_not_included', f'{method} {path}')

    def test_every_route_is_refused_when_hr_is_closed(self):
        self.login_as(self.officer)
        for key in FEATURES:
            set_probe_feature(self, key, enabled=False)
            for method, path in READ_ROUTES + WRITE_ROUTES:
                with self.subTest(key=key, route=f'{method} {path}'):
                    self._assert_refused(method, path)

    def test_a_retained_hr_keeps_the_read_routes_and_closes_the_write_routes(self):
        leave = self.file_leave()
        self.login_as(self.officer)
        for key in FEATURES:
            set_probe_feature(self, key, enabled=False, retained=True)
            for method, path in READ_ROUTES:
                with self.subTest(key=key, route=f'{method} {path}'):
                    self._assert_not_refused(method, path.replace('/1/', f'/{leave.id}/'))
            for method, path in WRITE_ROUTES:
                with self.subTest(key=key, route=f'{method} {path}'):
                    self._assert_refused(method, path)

    def test_submission_is_refused_when_hr_is_closed(self):
        leave = self.file_leave()
        request = self.approval_request(leave)
        self.assertEqual(request.process_id.execution_kind, KIND)
        state = request.state
        set_probe_feature(self, 'hr.enabled', enabled=False)
        with self.assertRaises(LiwanAccessRule) as caught:
            request._operations_prepare_submission(request.process_id)
        self.assertEqual(caught.exception.code, 'feature_not_included')
        self.assertEqual((request.state, leave.state), (state, 'confirm'))

    def test_a_decision_is_refused_and_changes_nothing_when_hr_is_closed(self):
        leave = self.file_leave()
        request = self.approval_request(leave)
        state = request.state
        set_probe_feature(self, 'hr.enabled', enabled=False)
        for name in ('_execute_approved', '_execute_rejected'):
            with self.subTest(name=name), self.assertRaises(LiwanAccessRule) as caught:
                getattr(request, name)()
            self.assertEqual(caught.exception.code, 'feature_not_included')
        with self.assertRaises(LiwanAccessRule) as caught:
            request._hr_leave_for_decision()
        self.assertEqual(caught.exception.code, 'feature_not_included')
        leave.invalidate_recordset()
        request.invalidate_recordset()
        self.assertEqual((leave.state, request.state), ('confirm', state))
