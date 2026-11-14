# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.tests.tenant_export_support import (
    assert_contribution,
    column,
    rows_of,
)

KEYS = ('tasks', 'task_stages', 'task_tags', 'task_projects')


@tagged('post_install', '-at_install', 'liwan')
class TestTasksTenantExport(TransactionCase):

    def test_tasks_of_every_company_are_exported_with_their_files(self):
        branch = self.env['res.company'].create({'name': 'Export task branch'})
        task = self.env['project.task'].create({'name': 'Export task', 'company_id': branch.id})
        datasets = assert_contribution(
            self, KEYS, {'tasks': ('id', 'name', 'project_id', 'stage_id', 'company_id'), 'task_projects': ('id', 'name')},
        )
        tasks = datasets['tasks']
        self.assertIn(task.id, column(tasks, rows_of(tasks), 'id'))
        self.assertTrue(tasks['attachments'])
