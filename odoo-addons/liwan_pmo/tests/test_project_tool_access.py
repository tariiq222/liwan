# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestProjectToolAccess(LiwanPmoCase):
    project_tool_policies = {'planning': 'optional', 'governance': 'optional', 'finance': 'optional'}

    def test_disabled_tool_routes_and_nonexistent_project(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'user_id': self.manager.id})
        families = {
            'planning': ['schedule', 'milestones', 'baselines'],
            'governance': ['stakeholders', 'raci', 'register', 'changes'],
            'finance': ['finance/summary'],
        }
        for key, paths in families.items():
            for suffix in paths:
                response = self.api('GET', f'/api/v1/projects/{self.project.id}/{suffix}')
                self.assertEqual(response.status_code, 403, (suffix, response.text))
                response = self.api('GET', f'/api/v1/projects/999999/{suffix}')
                self.assertEqual(response.status_code, 404, (suffix, response.text))

    def test_preference_strict_live_policy_and_stale_token(self):
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.project.write({'user_id': self.manager.id})
        path = f'/api/v1/projects/{self.project.id}'
        body = self.api('GET', path).json()
        response = self.api('PATCH', path, {'expected_updated_at': body['updated_at'], 'tool_preferences': {'planning': True}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['tools']['planning']['enabled'])
        self.env['liwan.pmo.settings'].set_values({'planning_tool_policy': 'disabled'})
        response = self.api('PATCH', path, {'expected_updated_at': response.json()['updated_at'], 'tool_preferences': {'planning': False}})
        self.assertEqual(response.status_code, 403, response.text)

    def test_raw_orm_advanced_records_and_field_exports_are_gated(self):
        settings = self.env['liwan.pmo.settings']
        settings.set_values({'planning_tool_policy': 'enabled', 'finance_tool_policy': 'enabled', 'governance_tool_policy': 'enabled'})
        self.project.write({'user_id': self.manager.id, 'liwan_budget_state': 'estimate', 'liwan_budget_amount': 1000})
        milestone = self.env['project.milestone'].create({'name': 'Hidden plan', 'project_id': self.project.id})
        budget = self.env['liwan.project.finance.entry'].create({'project_id': self.project.id, 'kind': 'budget', 'title': 'Private budget', 'amount': 100})
        stakeholder = self.env['liwan.project.stakeholder'].create({'project_id': self.project.id, 'name': 'Private sponsor'})
        baseline = self.env['liwan.project.baseline'].create({'project_id': self.project.id})
        settings.set_values({'planning_tool_policy': 'disabled', 'finance_tool_policy': 'disabled', 'governance_tool_policy': 'disabled'})
        for row in (milestone, budget, stakeholder, baseline):
            candidate = row.with_user(self.manager)
            self.assertFalse(candidate.search([('id', '=', row.id)]))
            with self.assertRaises(AccessError):
                candidate.read(['id'])
        project = self.project.with_user(self.manager)
        with self.assertRaises(AccessError):
            project.read(['liwan_budget_amount'])
        with self.assertRaises(AccessError):
            project.export_data(['liwan_scope'])
        self.assertEqual(project.read(['name'])[0]['name'], self.project.name)

    def test_baseline_cost_redaction_and_finance_reports(self):
        settings = self.env['liwan.pmo.settings']
        settings.set_values({'planning_tool_policy': 'enabled', 'finance_tool_policy': 'enabled'})
        self.project.write({'user_id': self.manager.id, 'liwan_budget_state': 'estimate', 'liwan_budget_amount': 1000})
        baseline = self.env['liwan.project.baseline'].create({'project_id': self.project.id})
        settings.set_values({'finance_tool_policy': 'disabled'})
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('GET', f'/api/v1/projects/{self.project.id}/baselines/{baseline.number}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['budget_total'])
        self.assertIsNone(response.json()['currency'])
        with self.assertRaises(AccessError):
            baseline.with_user(self.manager).read(['budget_total'])
        analytics = self.api('GET', '/api/v1/reports/projects/analytics')
        self.assertEqual(analytics.status_code, 200, analytics.text)
        self.assertEqual(analytics.json()['totals'], [])
        for row in analytics.json()['projects']:
            self.assertIsNone(row['finance'])

    def test_private_project_assignee_sees_only_authorized_task_scalars(self):
        private = self.env['project.project'].create({
            'name': 'Private project', 'privacy_visibility': 'followers',
            'liwan_scope': 'Hidden charter', 'liwan_budget_state': 'estimate', 'liwan_budget_amount': 999,
        })
        task = self.env['project.task'].create({
            'name': 'Assigned task', 'project_id': private.id, 'user_ids': [(4, self.employee.id)],
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', f'/api/v1/projects/{private.id}').status_code, 404)
        response = self.api('GET', f'/api/v1/tasks/{task.id}')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['project'], {'id': private.id, 'name': 'Private project'})
        self.assertFalse(body['planning_enabled'])
        self.assertEqual(body['depends_on'], [])
        self.assertIsNone(body['milestone'])
        self.assertIsNone(body['planned_start'])
        self.assertIsNone(body['percent_complete'])
        self.assertNotIn('999', response.text)
        self.assertNotIn('Hidden charter', response.text)
        company_b = self.env['res.company'].create({'name': 'Foreign company'})
        foreign = self.env['project.project'].create({'name': 'Foreign project', 'company_id': company_b.id})
        foreign_task = self.env['project.task'].create({
            'name': 'Foreign assigned task', 'project_id': foreign.id, 'company_id': company_b.id,
            'user_ids': [(4, self.employee.id)],
        })
        self.assertEqual(self.api('GET', f'/api/v1/tasks/{foreign_task.id}').status_code, 404)

    def test_fixed_policy_member_and_archived_preferences_are_refused(self):
        self.project.write({'user_id': self.manager.id})
        for key in ('planning', 'governance', 'finance'):
            self.authenticate('api_emp', 'api_emp_pass_123')
            path = f'/api/v1/projects/{self.project.id}'
            body = self.api('GET', path).json()
            response = self.api('PATCH', path, {'expected_updated_at': body['updated_at'], 'tool_preferences': {key: True}})
            self.assertEqual(response.status_code, 403, response.text)
            self.authenticate('api_mgr', 'api_mgr_pass_123')
            self.env['liwan.pmo.settings'].set_values({f'{key}_tool_policy': 'enabled'})
            body = self.api('GET', path).json()
            self.assertFalse(body['tools'][key]['can_toggle'])
            response = self.api('PATCH', path, {'expected_updated_at': body['updated_at'], 'tool_preferences': {key: False}})
            self.assertEqual(response.status_code, 403, response.text)
        self.project.write({'active': False})
        body = self.api('GET', path).json()
        response = self.api('PATCH', path, {'expected_updated_at': body['updated_at'], 'tool_preferences': {'planning': False}})
        self.assertEqual(response.status_code, 422, response.text)

    def test_policy_domain_and_grouping_do_not_infer_hidden_values(self):
        self.project.write({'user_id': self.manager.id, 'liwan_budget_state': 'estimate', 'liwan_budget_amount': 1000})
        project = self.project.with_user(self.manager)
        self.assertFalse(project.search([('id', '=', self.project.id), ('liwan_budget_amount', '>', 0)]))
        grouped = project.formatted_read_group([('id', '=', self.project.id)], [], ['liwan_budget_amount:sum'])
        self.assertFalse(grouped[0]['liwan_budget_amount:sum'])
        self.assertFalse(project.formatted_read_group(
            [('id', '=', self.project.id)], ['name'], ['id:count'],
            having=[('liwan_budget_amount:sum', '>', 0)],
        ))
        self.assertFalse(self.task_other.with_user(self.manager).search([
            ('project_id', 'any', [('liwan_budget_amount', '>', 0)]),
        ]))

    def test_raw_percent_requires_evm_entitlement(self):

        self.env['liwan.pmo.settings'].set_values({'planning_tool_policy': 'enabled', 'finance_tool_policy': 'enabled'})
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'pmo.evm': False},
            'retained_read_features': [key for key in profile.retained_read_features if key != 'pmo.evm'],
        })
        task = self.task_overdue.with_user(self.manager)
        with self.assertRaises(AccessError):
            task.read(['liwan_percent_complete'])
        with self.assertRaises(AccessError):
            task.export_data(['liwan_percent_complete'])
        grouped = task.formatted_read_group([('id', '=', task.id)], [], ['liwan_percent_complete:sum'])
        self.assertFalse(grouped[0]['liwan_percent_complete:sum'])
        self.assertFalse(task.search([('liwan_percent_complete', '>=', 0)]))

    def test_raw_milestone_creation_keeps_exact_current_company_write_scope(self):
        company_b = self.env['res.company'].create({'name': 'Milestone other company'})
        self.manager.company_ids = [(4, company_b.id)]
        self.env['liwan.pmo.settings'].with_company(company_b).set_values({'planning_tool_policy': 'enabled'})
        foreign_project = self.env['project.project'].with_company(company_b).create({'name': 'Other project', 'company_id': company_b.id})
        Milestone = self.env['project.milestone'].with_user(self.manager).with_context(allowed_company_ids=[self.env.company.id, company_b.id])
        with self.assertRaises(AccessError):
            Milestone.create({'name': 'Cross-company write', 'project_id': foreign_project.id})
