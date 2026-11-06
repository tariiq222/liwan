# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime

from odoo.tests import tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestProjectToolTransitions(LiwanPmoCase):
    project_tool_policies = {'planning': 'optional', 'governance': 'optional', 'finance': 'optional'}

    def test_planning_disabled_suspends_dependencies_and_bounds(self):
        settings = self.env['liwan.pmo.settings']
        settings.set_values({'planning_tool_policy': 'enabled'})
        self.project.write({'allow_task_dependencies': True})
        task = self.env['project.task'].create({'name': 'Blocked', 'project_id': self.project.id, 'depend_on_ids': [(6, 0, self.task_other.ids)]})
        self.assertTrue(task.allow_task_dependencies)
        self.task_other.write({'state': '02_changes_requested'})
        self.assertEqual(task.state, '04_waiting_normal')
        settings.set_values({'planning_tool_policy': 'disabled'})
        task.write({'state': '02_changes_requested', 'date_deadline': datetime(2035, 1, 1)})
        self.task_other.write({'state': '1_done'})
        self.assertEqual(task.state, '02_changes_requested')
        task.write({'state': '1_done'})
        settings.set_values({'planning_tool_policy': 'enabled'})
        self.task_other.write({'state': '01_in_progress'})
        self.assertEqual(task.state, '1_done')
