# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests.common import TransactionCase, tagged


@tagged('webvue', 'webvue_access', 'webvue_tasks')
class TestTasksAccess(TransactionCase):
    def test_capabilities_registered(self):
        keys = {c['key'] for c in self.env['webvue.access.service']._webvue_capability_definitions()}
        self.assertTrue({'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'} <= keys)

    def test_dependencies(self):
        deps = self.env['webvue.access.service']._webvue_permission_dependencies()
        self.assertEqual(deps['tasks.tasks.create'], {'tasks.tasks.read'})
        self.assertEqual(deps['tasks.tasks.write'], {'tasks.tasks.read'})

    def test_employee_role_has_all_three_and_admin_none(self):
        grants = self.env['webvue.access.service']._webvue_builtin_role_grants()
        self.assertTrue({'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'}
                        <= set(grants['webvue_core.role_employee']))
        for role in ('webvue_core.role_system_admin', 'webvue_core.role_vendor_support'):
            self.assertFalse({k for k in grants.get(role, ()) if k.startswith('tasks.')}, role)

    def test_feature_registered(self):
        definitions = self.env['webvue.feature.registry']._webvue_feature_definitions()
        feature = next(f for f in definitions if f['key'] == 'tasks.enabled')
        self.assertEqual((feature['type'], feature['owner']), ('boolean', 'webvue_tasks'))
