# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestProjectQuota(TransactionCase):
    """liwan_pmo registers the project counter that liwan_platform's limits use (ruling R-F)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('liwan_platform.tenant_profile')
        cls.record._liwan_initialize_legacy_policy(
            cls.env['liwan.feature.registry']._liwan_installed_module_ids(),
        )
        cls.service = cls.env['liwan.entitlement.service'].sudo()

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def test_usage_counter_is_registered_by_liwan_pmo(self):
        self.env['project.project'].create({'name': 'Counted project'})
        self.assertEqual(
            self.service._liwan_count_usage('projects.max_projects'),
            self.service._liwan_count_projects(),
        )
        self.assertGreaterEqual(self.service._liwan_count_projects(), 1)
        self.assertEqual(self.service._liwan_count_usage('users.limit'), self.service._liwan_count_users())

    def test_project_limit_blocks_create_and_restore(self):
        project = self.env['project.project'].create({'name': 'Quota project'})
        current = self.service._liwan_count_projects()
        self._operator().write({'features': {**self.record.features, 'projects.max_projects': current}})
        with self.assertRaises(LiwanAccessRule):
            self.env['project.project'].create({'name': 'Over quota'})
        project.write({'active': False})
        self.assertEqual(self.service._liwan_count_projects(), current - 1)
        extra = self.env['project.project'].create({'name': 'Takes freed slot'})
        self.assertEqual(self.service._liwan_count_projects(), current)
        with self.assertRaises(LiwanAccessRule):
            project.write({'active': True})
        extra.unlink()
        project.write({'active': True})
        self.assertEqual(self.service._liwan_count_projects(), current)

    def test_project_manager_claims_the_quota_unelevated(self):
        """Project create/archive/restore call the entitlement service in the caller's environment;
        the service elevates its own tenant-profile read, so a non-system manager still claims."""
        manager = new_test_user(
            self.env, login='quota_pm', groups='liwan_core.group_employee,project.group_project_manager',
        )
        self.assertFalse(manager.has_group('base.group_system'))
        Project = self.env['project.project'].with_user(manager)
        project = Project.create({'name': 'Manager quota', 'user_id': manager.id, 'date': '2030-12-31'})
        current = self.service._liwan_count_projects()
        self._operator().write({'features': {**self.record.features, 'projects.max_projects': current}})
        with self.assertRaises(LiwanAccessRule):
            Project.create({'name': 'Manager over quota', 'user_id': manager.id, 'date': '2030-12-31'})
        project.write({'active': False})
        self.assertEqual(self.service._liwan_count_projects(), current - 1)
        project.write({'active': True})
        self.assertEqual(self.service._liwan_count_projects(), current)
