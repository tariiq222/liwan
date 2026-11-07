# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanPmoCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestProjectToolPaths(LiwanPmoCase):
    project_tool_policies = {'planning': 'optional', 'governance': 'optional', 'finance': 'optional'}

    def setUp(self):
        super().setUp()
        self.manager.group_ids = [(4, self.env.ref('base.group_allow_export').id)]
        self.project.write({'user_id': self.manager.id})
        self.task_overdue.write({'liwan_percent_complete': 73})
        self.plan_task = self.env['project.task'].create({
            'name': 'Scheduled export', 'project_id': self.project.id,
            'liwan_planned_start': '2030-01-03', 'date_deadline': '2030-01-05',
        })

    def test_nested_export_checks_leaf_model_tools_and_keeps_core_exports(self):
        settings = self.env['liwan.pmo.settings']
        project = self.project.with_user(self.manager)
        settings.set_values({'planning_tool_policy': 'enabled', 'finance_tool_policy': 'enabled'})
        self.assertTrue(project.export_data(['task_ids/liwan_percent_complete'])['datas'])
        self.assertTrue(project.export_data(['task_ids/liwan_planned_start'])['datas'])
        settings.set_values({'finance_tool_policy': 'disabled'})
        for path in ('task_ids/liwan_percent_complete', 'task_ids/liwan_percent_complete/', 'task_ids/liwan_percent_complete/.id'):
            with self.assertRaises(AccessError):
                project.export_data([path])
        self.assertTrue(project.export_data(['task_ids/name', 'task_ids/date_deadline'])['datas'])
        settings.set_values({'planning_tool_policy': 'disabled', 'finance_tool_policy': 'enabled'})
        with self.assertRaises(AccessError):
            project.export_data(['task_ids/liwan_planned_start'])
        with self.assertRaises(AccessError):
            project.export_data(['task_ids/liwan_percent_complete'])
        self.assertTrue(project.export_data(['task_ids/name', 'task_ids/date_deadline'])['datas'])

    def test_nested_domain_uses_comodel_tools(self):
        self.env['liwan.pmo.settings'].set_values({'planning_tool_policy': 'enabled', 'finance_tool_policy': 'disabled'})
        project = self.project.with_user(self.manager)
        self.assertFalse(project.search([('id', '=', project.id), ('task_ids.liwan_percent_complete', '=', 73)]))
        self.assertFalse(project.search([('id', '=', project.id), ('task_ids', 'any', [('liwan_percent_complete', '=', 73)])]))

    def test_nested_export_checks_explicit_evm_entitlement(self):
        self.env['liwan.pmo.settings'].set_values({'planning_tool_policy': 'enabled', 'finance_tool_policy': 'enabled'})
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'pmo.evm': False},
            'retained_read_features': [key for key in profile.retained_read_features if key != 'pmo.evm'],
        })
        with self.assertRaises(AccessError):
            self.project.with_user(self.manager).export_data(['task_ids/liwan_percent_complete'])
        self.assertTrue(self.project.with_user(self.manager).export_data(['task_ids/name'])['datas'])

    def test_relational_export_uses_target_project_policy(self):
        target = self.env['project.project'].create({
            'name': 'Related target', 'user_id': self.manager.id,
            'liwan_finance_enabled': False, 'liwan_budget_state': 'estimate', 'liwan_budget_amount': 913,
        })
        parent = self.env['project.task'].create({'name': 'Other project parent', 'project_id': target.id})
        task = self.env['project.task'].create({'name': 'Source child', 'project_id': self.project.id, 'parent_id': parent.id})
        self.project.write({'liwan_finance_enabled': True})
        exported = task.with_user(self.manager)
        with self.assertRaises(AccessError):
            exported.export_data(['parent_id/project_id/liwan_budget_amount'])
        target.write({'liwan_finance_enabled': True})
        self.project.write({'liwan_finance_enabled': False})
        self.assertTrue(exported.export_data(['parent_id/project_id/liwan_budget_amount'])['datas'])
        self.assertTrue(exported.search([('id', '=', task.id), ('parent_id.project_id.liwan_budget_amount', '=', 913)]))

    def test_dynamic_relational_property_export_keeps_target_tool_gates(self):
        self.project.write({'task_properties_definition': [{
            'name': 'linked_task', 'string': 'Linked task', 'type': 'many2one', 'comodel': 'project.task',
        }]})
        self.plan_task.write({'task_properties': {'linked_task': self.task_overdue.id}})
        self.env['liwan.pmo.settings'].set_values({'planning_tool_policy': 'enabled', 'finance_tool_policy': 'disabled'})
        task = self.plan_task.with_user(self.manager)
        with self.assertRaises(AccessError):
            task.export_data(['task_properties.linked_task/liwan_percent_complete'])
        self.assertTrue(task.export_data(['task_properties.linked_task/name'])['datas'])

    def test_native_database_id_export_still_checks_advanced_model_gate(self):
        milestone = self.env['project.milestone'].create({'name': 'Hidden milestone id', 'project_id': self.project.id})
        with self.assertRaises(AccessError):
            milestone.with_user(self.manager).export_data(['.id'])
