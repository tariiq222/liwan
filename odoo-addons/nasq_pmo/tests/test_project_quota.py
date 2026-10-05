# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestProjectQuota(TransactionCase):
    """nasq_pmo registers the project counter that nasq_platform's limits use (ruling R-F)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('nasq_platform.tenant_profile')
        cls.record._nasq_initialize_legacy_policy(
            cls.env['nasq.feature.registry']._nasq_installed_module_ids(),
        )
        cls.service = cls.env['nasq.entitlement.service'].sudo()

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def test_usage_counter_is_registered_by_nasq_pmo(self):
        self.env['project.project'].create({'name': 'Counted project'})
        self.assertEqual(
            self.service._nasq_count_usage('projects.max_projects'),
            self.service._nasq_count_projects(),
        )
        self.assertGreaterEqual(self.service._nasq_count_projects(), 1)
        self.assertEqual(self.service._nasq_count_usage('users.limit'), self.service._nasq_count_users())

    def test_project_limit_blocks_create_and_restore(self):
        project = self.env['project.project'].create({'name': 'Quota project'})
        current = self.service._nasq_count_projects()
        self._operator().write({'features': {**self.record.features, 'projects.max_projects': current}})
        with self.assertRaises(NasqAccessRule):
            self.env['project.project'].create({'name': 'Over quota'})
        project.write({'active': False})
        self.assertEqual(self.service._nasq_count_projects(), current - 1)
        extra = self.env['project.project'].create({'name': 'Takes freed slot'})
        self.assertEqual(self.service._nasq_count_projects(), current)
        with self.assertRaises(NasqAccessRule):
            project.write({'active': True})
        extra.unlink()
        project.write({'active': True})
        self.assertEqual(self.service._nasq_count_projects(), current)
