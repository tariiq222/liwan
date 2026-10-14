# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.nasq_api.tests.common import set_probe_feature
from odoo.addons.nasq_operations.models.operation_request import OperationExecutionError
from odoo.addons.nasq_pmo.tests.common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestOperationsCompletion(NasqPmoCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_probe_feature(cls, key='pmo.enabled', enabled=True)
        cls.service = cls.env['nasq.access.service']
        reviewer_role = cls.env.ref('nasq_operations.role_operations_reviewer')
        manager_role = cls.env.ref('nasq_operations.role_operations_manager')
        pmo_role = cls.env.ref('nasq_pmo.role_pmo_manager')
        cls.service._nasq_replace_assignments(cls.manager, [{'role_id': pmo_role.id, 'company_id': cls.env.company.id}, {'role_id': reviewer_role.id, 'company_id': cls.env.company.id}, {'role_id': manager_role.id, 'company_id': cls.env.company.id}])
        cls.service._nasq_replace_assignments(cls.employee, [{'role_id': cls.env.ref('nasq_core.role_employee').id, 'company_id': cls.env.company.id}])
        cls.project = cls.env['project.project'].create({'name': 'Bridge project', 'user_id': cls.manager.id, 'nasq_completion_approval': 'project_manager', 'company_id': cls.env.company.id})
        cls.process = cls.env['nasq.operation.process'].with_user(cls.manager).create({'name': 'Complete a task'})
        cls.process.with_user(cls.manager).action_configure(0, 'Complete a task', '', 'pmo_completion', [{'name': 'PMO approval', 'reviewer_ids': [cls.manager.id]}])
        cls.process.with_user(cls.manager).action_publish(1)

    def _operation(self):
        task = self.env['project.task'].create({'name': 'Complete with operations', 'project_id': self.project.id, 'company_id': self.env.company.id, 'user_ids': [(4, self.employee.id)]})
        record = self.env['nasq.operation.request'].with_user(self.employee).create({'name': 'Completion request', 'process_id': self.process.id, 'target_id': task.id})
        record.action_submit(0)
        return record, task

    def test_completion_uses_original_pmo_policy_once(self):
        record, task = self._operation()
        self.assertTrue(task.nasq_completion_pending)
        self.assertNotEqual(task.state, '1_done')
        record.with_user(self.manager).action_approve(1)
        self.assertEqual((record.state, record.execution_count, task.state), ('done', 1, '1_done'))
        self.assertFalse(task.nasq_completion_pending)

    def test_an_independent_pmo_decision_makes_operation_stale(self):
        record, task = self._operation()
        task.with_user(self.manager)._nasq_accept_completion(task.nasq_completion_revision)
        with self.assertRaises(OperationExecutionError):
            record.with_user(self.manager).action_approve(1)
        record.invalidate_recordset()
        self.assertEqual((record.state, record.execution_count), ('pending', 0))
        self.assertEqual(task.state, '1_done')

    def test_other_company_or_hidden_target_is_not_allowed(self):
        other_project = self.env['project.project'].create({'name': 'Private project', 'user_id': self.manager.id, 'company_id': self.env.company.id, 'nasq_completion_approval': 'project_manager'})
        task = self.env['project.task'].create({'name': 'Private task', 'project_id': other_project.id, 'company_id': self.env.company.id})
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            self.env['nasq.operation.request'].with_user(self.employee).create({'name': 'Foreign target', 'process_id': self.process.id, 'target_id': task.id})

    def test_older_assigned_target_is_not_hidden_by_newer_ineligible_tasks(self):
        older = self.env['project.task'].create({'name': 'Older eligible task', 'project_id': self.project.id, 'company_id': self.env.company.id, 'user_ids': [(4, self.employee.id)]})
        self.env['project.task'].create([{'name': f'Newer other task {i}', 'project_id': self.project.id, 'company_id': self.env.company.id, 'user_ids': [(4, self.manager.id)]} for i in range(51)])
        targets = self.process.with_user(self.employee)._operations_targets('')
        self.assertIn(older.id, [target['id'] for target in targets])
