# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_pmo.tests.common import LiwanPmoCase

FEATURE = 'pmo.enabled'


@tagged('post_install', '-at_install', 'liwan')
class TestPmoFeatureLock(LiwanPmoCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_probe_feature(cls, key=FEATURE, enabled=True)
        cls.service = cls.env['liwan.access.service']
        reviewer_role = cls.env.ref('liwan_operations.role_operations_reviewer')
        manager_role = cls.env.ref('liwan_operations.role_operations_manager')
        pmo_role = cls.env.ref('liwan_pmo.role_pmo_manager')
        company = cls.env.company.id
        cls.service._liwan_replace_assignments(cls.manager, [{'role_id': role.id, 'company_id': company} for role in (pmo_role, reviewer_role, manager_role)])
        cls.service._liwan_replace_assignments(cls.employee, [{'role_id': cls.env.ref('liwan_core.role_employee').id, 'company_id': company}])
        cls.project = cls.env['project.project'].create({'name': 'Lock project', 'user_id': cls.manager.id, 'liwan_completion_approval': 'project_manager', 'company_id': company})
        cls.process = cls.env['liwan.operation.process'].with_user(cls.manager).create({'name': 'Complete a task'})
        cls.process.with_user(cls.manager).action_configure(0, 'Complete a task', '', 'pmo_completion', [{'name': 'PMO approval', 'reviewer_ids': [cls.manager.id]}])
        cls.process.with_user(cls.manager).action_publish(1)
        cls.task = cls.env['project.task'].create({'name': 'Lock task', 'project_id': cls.project.id, 'company_id': company, 'user_ids': [(4, cls.employee.id)]})
        cls.request = cls.env['liwan.operation.request'].with_user(cls.employee).create({'name': 'Lock request', 'process_id': cls.process.id, 'target_id': cls.task.id})

    def _assert_feature_refused(self, error):
        self.assertEqual((error.exception.code, error.exception.status, error.exception.details), ('feature_not_included', 403, {'reason': 'feature', 'feature': FEATURE}))

    def _assert_untouched(self):
        self.request.invalidate_recordset()
        self.task.invalidate_recordset()
        self.assertEqual((self.request.state, self.request.execution_count), ('draft', 0))
        self.assertFalse(self.task.liwan_completion_pending)
        self.assertNotEqual(self.task.state, '1_done')

    def _targets(self):
        return self.process.with_user(self.employee)._operations_targets('')

    def _task(self):
        return self.env['liwan.operation.request'].with_user(self.employee)._operations_task(self.task.id)

    def _kinds(self):
        return [kind['key'] for kind in self.env['liwan.operation.process']._operations_execution_kinds()]

    def _prepare(self):
        return self.request.with_user(self.employee)._operations_prepare_submission(self.process)

    def _execute(self):
        return self.request.with_user(self.manager)._execute_approved()

    def test_targets_are_refused_when_pmo_is_closed(self):
        self.assertIn(self.task.id, [target['id'] for target in self._targets()])
        set_probe_feature(self, key=FEATURE, enabled=False)
        with self.assertRaises(LiwanAccessRule) as error:
            self._targets()
        self._assert_feature_refused(error)

    def test_task_lookup_is_refused_when_pmo_is_closed(self):
        self.assertEqual(self._task(), self.task)
        set_probe_feature(self, key=FEATURE, enabled=False)
        with self.assertRaises(LiwanAccessRule) as error:
            self._task()
        self._assert_feature_refused(error)

    def test_submission_is_refused_and_changes_nothing_when_pmo_is_closed(self):
        set_probe_feature(self, key=FEATURE, enabled=False)
        with self.assertRaises(LiwanAccessRule) as error:
            self._prepare()
        self._assert_feature_refused(error)
        self._assert_untouched()

    def test_execution_is_refused_and_changes_nothing_when_pmo_is_closed(self):
        set_probe_feature(self, key=FEATURE, enabled=False)
        with self.assertRaises(LiwanAccessRule) as error:
            self._execute()
        self._assert_feature_refused(error)
        self._assert_untouched()

    def test_retained_reads_stay_open_while_writes_are_refused(self):
        set_probe_feature(self, key=FEATURE, enabled=False, retained=True)
        self.assertIn(self.task.id, [target['id'] for target in self._targets()])
        self.assertEqual(self._task(), self.task)
        for call in (self._prepare, self._execute):
            with self.subTest(call=call.__name__), self.assertRaises(LiwanAccessRule) as error:
                call()
            self._assert_feature_refused(error)
        self._assert_untouched()

    def test_closed_pmo_hides_the_completion_kind(self):
        self.assertIn('pmo_completion', self._kinds())
        set_probe_feature(self, key=FEATURE, enabled=False, retained=True)
        self.assertNotIn('pmo_completion', self._kinds())
