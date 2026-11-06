# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestPrivateTaskPercent(LiwanPmoCase):
    def setUp(self):
        super().setUp()
        self.env['liwan.pmo.settings'].set_values({'evm_progress_method': 'manual'})
        self.private = self.env['project.project'].create({
            'name': 'Private percent project', 'company_id': self.env.company.id,
            'user_id': self.manager.id, 'privacy_visibility': 'followers',
        })
        self.assigned = self.env['project.task'].create({
            'name': 'Assigned private task', 'project_id': self.private.id,
            'user_ids': [(4, self.employee.id)],
        })
        self.as_employee = self.assigned.with_user(self.employee)
        self.assertFalse(self.private.with_user(self.employee).has_access('read'))
        self.assertTrue(self.as_employee._liwan_can_write())

    def test_advertised_private_task_percent_saves_without_project_read(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        project_path = f'/api/v1/projects/{self.private.id}'
        task_path = f'/api/v1/tasks/{self.assigned.id}'
        self.assertEqual(self.api('GET', project_path).status_code, 404)
        # The cold request must not need a preceding DTO read to warm project fields.
        updated = self.api('PATCH', task_path, {'percent_complete': 24})
        self.assertEqual(updated.status_code, 200, updated.text)
        detail = self.api('GET', task_path)
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertIn('write_percent', detail.json()['allowed_actions'])
        updated = self.api('PATCH', task_path, {'percent_complete': 35})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['percent_complete'], 35)
        self.assertEqual(self.api('GET', project_path).status_code, 404)
        self.assertFalse(self.private.with_user(self.employee).has_access('read'))

    def test_direct_task_percent_write_keeps_assignee_authorization(self):
        self.env.invalidate_all()
        self.assertFalse(self.as_employee._liwan_can_approve())
        self.as_employee.write({'liwan_percent_complete': 46})
        self.assertEqual(self.assigned.liwan_percent_complete, 46)
        self.as_employee.write({'name': 'Ordinary task update'})
        self.assertEqual(self.assigned.name, 'Ordinary task update')
        self.assertFalse(self.private.with_user(self.employee).has_access('read'))
        self.private.write({'user_id': self.employee.id})
        self.env.invalidate_all()
        self.assertTrue(self.as_employee._liwan_can_approve(), 'the assigned project manager retains the contextual grant')

    def test_optional_preferences_and_disabled_tools_remain_enforced(self):
        settings = self.env['liwan.pmo.settings']
        settings.set_values({'planning_tool_policy': 'optional', 'finance_tool_policy': 'optional'})
        self.private.write({'liwan_planning_enabled': True, 'liwan_finance_enabled': True})
        self.as_employee.write({'liwan_percent_complete': 57})
        self.assertEqual(self.assigned.liwan_percent_complete, 57)
        self.authenticate('api_emp', 'api_emp_pass_123')
        for key in ('planning', 'finance'):
            field = f'liwan_{key}_enabled'
            self.private.write({field: False})
            with self.assertRaises(AccessError):
                self.as_employee.write({'liwan_percent_complete': 64})
            response = self.api('PATCH', f'/api/v1/tasks/{self.assigned.id}', {'percent_complete': 64})
            self.assertEqual(response.status_code, 403, response.text)
            self.private.write({field: True})
        for key in ('planning', 'finance'):
            settings.set_values({f'{key}_tool_policy': 'disabled'})
            with self.assertRaises(AccessError):
                self.as_employee.write({'liwan_percent_complete': 64})
            response = self.api('PATCH', f'/api/v1/tasks/{self.assigned.id}', {'percent_complete': 64})
            self.assertEqual(response.status_code, 403, response.text)
            settings.set_values({f'{key}_tool_policy': 'enabled'})
        self.assertEqual(self.assigned.liwan_percent_complete, 57)

    def test_task_scope_archive_and_readonly_tenant_are_not_bypassed(self):
        foreign_company = self.env['res.company'].create({'name': 'Other percent company'})
        foreign_project = self.env['project.project'].create({'name': 'Foreign percent project', 'company_id': foreign_company.id})
        foreign_task = self.env['project.task'].create({
            'name': 'Foreign assigned task', 'project_id': foreign_project.id,
            'company_id': foreign_company.id, 'user_ids': [(4, self.employee.id)],
        })
        with self.assertRaises(AccessError):
            foreign_task.with_user(self.employee).write({'liwan_percent_complete': 22})
        self.private.write({'active': False})
        with self.assertRaises(AccessError):
            self.as_employee.write({'liwan_percent_complete': 22})
        self.private.write({'active': True})
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'pmo.evm': False}})
        with self.assertRaises(AccessError):
            self.as_employee.write({'liwan_percent_complete': 22})
        self.assertEqual(self.assigned.liwan_percent_complete, 0)
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'pmo.evm': True}, 'valid_until': '2000-01-01',
        })
        with self.assertRaises(AccessError) as readonly:
            self.as_employee.write({'liwan_percent_complete': 22})
        self.assertEqual(readonly.exception.code, 'tenant_read_only')

    def test_private_task_percent_does_not_open_manager_only_planning_writes(self):
        personal = self.env['project.task'].create({
            'name': 'Personal task without project', 'project_id': False, 'user_ids': [(4, self.employee.id)],
        })
        with self.assertRaises(AccessError):
            personal.with_user(self.employee).write({'liwan_percent_complete': 12})
        with self.assertRaises(AccessError):
            self.as_employee.write({'milestone_id': False, 'liwan_percent_complete': 12})
        with self.assertRaises(AccessError):
            self.as_employee._liwan_set_dependencies([])
