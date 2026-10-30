# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests.common import TransactionCase, tagged


@tagged('liwan', 'liwan_access', 'liwan_tasks')
class TestTasksAccess(TransactionCase):
    def test_capabilities_registered(self):
        keys = {c['key'] for c in self.env['liwan.access.service']._liwan_capability_definitions()}
        self.assertTrue({'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'} <= keys)

    def test_dependencies(self):
        deps = self.env['liwan.access.service']._liwan_permission_dependencies()
        self.assertEqual(deps['tasks.tasks.create'], {'tasks.tasks.read'})
        self.assertEqual(deps['tasks.tasks.write'], {'tasks.tasks.read'})

    def test_employee_role_has_all_three_and_admin_none(self):
        grants = self.env['liwan.access.service']._liwan_builtin_role_grants()
        self.assertTrue({'tasks.tasks.read', 'tasks.tasks.create', 'tasks.tasks.write'}
                        <= set(grants['liwan_core.role_employee']))
        for role in ('liwan_core.role_system_admin', 'liwan_core.role_vendor_support'):
            self.assertFalse({k for k in grants.get(role, ()) if k.startswith('tasks.')}, role)

    def test_feature_registered(self):
        definitions = self.env['liwan.feature.registry']._liwan_feature_definitions()
        feature = next(f for f in definitions if f['key'] == 'tasks.enabled')
        self.assertEqual((feature['type'], feature['owner']), ('boolean', 'liwan_tasks'))
