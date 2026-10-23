# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .leave_cancellation_case import LeaveCancellationCase
from odoo.addons.webvue_api.controllers.common import ApiError


@tagged('post_install', '-at_install', 'webvue')
class TestLeaveSettings(LeaveCancellationCase):
    def test_default_policy_does_not_create_row(self):
        model = self.env['webvue.hr.leave.settings'].with_user(self.employee)
        self.assertEqual(model._webvue_effective_policy(self.env.company), 'manager_approval')
        self.assertFalse(model.search([]))

    def test_config_only_role_has_no_hr_reads(self):
        user = self._user_with_leave_role('leave_config_only', 'Leave config', ['hr.leave.config'])
        model = self.env['webvue.hr.leave.settings'].with_user(user)
        row = model.action_save('direct_employee', 0)
        self.assertEqual(row.revision, 1)
        self.assertFalse(self.env['webvue.access.service']._webvue_has_capability(user, 'hr.employees.read'))
        self.authenticate(user.login, user.login + '_pass_123')
        result = self.api('GET', '/api/v1/hr/leave/settings')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), {'cancellation_policy': 'direct_employee', 'revision': 1})
        self.assertEqual(self.api('GET', '/api/v1/hr/leave/balances').status_code, 403)

    def test_policy_company_and_revision_fences(self):
        model = self.env['webvue.hr.leave.settings'].with_user(self.manager)
        row = model.action_save('manager_only', 0)
        with self.assertRaises(ApiError) as error:
            model.action_save('direct_employee', 0)
        self.assertEqual(error.exception.status, 409)
        with self.assertRaises(AccessError):
            row.with_user(self.employee).write({'cancellation_policy': 'direct_employee', 'revision': 1})
        self.env['webvue.access.service']._webvue_replace_assignments(self.manager, [])
        with self.assertRaises(AccessError):
            model.action_save('manager_only', 1)

    def test_existing_trusted_vendor_support_retains_configuration_access(self):
        support = new_test_user(self.env, login='leave_support_config', password='support_leave_123', groups='webvue_core.group_vendor_support')
        self.assertTrue(self.env['webvue.access.service']._webvue_has_capability(support, 'hr.leave.config'))
        self.authenticate(support.login, 'support_leave_123')
        current = self.api('GET', '/api/v1/hr/leave/settings')
        self.assertEqual(current.status_code, 200, current.text)
        saved = self.api('PATCH', '/api/v1/hr/leave/settings', {'cancellation_policy': 'manager_only', 'revision': current.json()['revision']})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(saved.json()['cancellation_policy'], 'manager_only')

    def test_system_admin_and_ordinary_custom_roles_need_explicit_config(self):
        admin = new_test_user(self.env, login='leave_system_config', groups='base.group_system')
        custom = self._user_with_leave_role('leave_read_config', 'Read only', ['hr.leave.read', 'hr.employees.read'])
        for user in (admin, custom):
            self.assertFalse(self.env['webvue.access.service']._webvue_has_capability(user, 'hr.leave.config'))
            with self.assertRaises(AccessError):
                self.env['webvue.hr.leave.settings'].with_user(user).action_save('direct_employee', 0)
