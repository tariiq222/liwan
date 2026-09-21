# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_core.models.access_service import NasqAccessRule
from odoo.addons.nasq_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'nasq')
class TestTenantQuotas(TransactionCase):

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

    def test_user_limit_blocks_additional_internal_account(self):
        current = self.service._nasq_count_users()
        self._operator().write({'features': {**self.record.features, 'users.limit': current}})
        with self.assertRaises(NasqAccessRule) as error:
            new_test_user(self.env, login='quota_blocked_user', groups='nasq_core.group_employee')
        self.assertEqual(error.exception.details['limit_key'], 'users.limit')
        self.assertEqual(self.service._nasq_count_users(), current)

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

    def test_storage_limit_blocks_binary_attachment(self):
        self._operator().write({'features': {**self.record.features, 'storage.limit_mb': 0}})
        with self.assertRaises(NasqAccessRule):
            self.env['ir.attachment'].create({
                'name': 'too-big.txt',
                'raw': b'x' * 100,
                'mimetype': 'text/plain',
            })
