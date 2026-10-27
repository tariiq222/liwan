# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestTenantQuotas(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('webvue_platform.tenant_profile')
        cls.record._webvue_initialize_legacy_policy(
            cls.env['webvue.feature.registry']._webvue_installed_module_ids(),
        )
        cls.service = cls.env['webvue.entitlement.service'].sudo()
        cls.employee = new_test_user(cls.env, login='quota_employee', groups='webvue_core.group_employee')

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def test_user_limit_blocks_additional_internal_account(self):
        current = self.service._webvue_count_users()
        self._operator().write({'features': {**self.record.features, 'users.limit': current}})
        with self.assertRaises(WebVueAccessRule) as error:
            new_test_user(self.env, login='quota_blocked_user', groups='webvue_core.group_employee')
        self.assertEqual(error.exception.details['limit_key'], 'users.limit')
        self.assertEqual(self.service._webvue_count_users(), current)

    def test_usage_counter_counts_users_and_leaves_unknown_limits_at_zero(self):
        self.assertEqual(self.service._webvue_count_usage('users.limit'), self.service._webvue_count_users())
        self.assertEqual(self.service._webvue_count_usage('unknown.limit'), 0)

    def test_storage_limit_blocks_binary_attachment(self):
        self._operator().write({'features': {**self.record.features, 'storage.limit_mb': 0}})
        with self.assertRaises(WebVueAccessRule):
            self.env['ir.attachment'].create({
                'name': 'too-big.txt',
                'raw': b'x' * 100,
                'mimetype': 'text/plain',
            })

    def test_storage_usage_is_counted_in_whole_mebibytes(self):
        self.env['ir.attachment'].create({'name': 'counted.txt', 'raw': b'x' * 10, 'mimetype': 'text/plain'})
        used = int(self.service._webvue_count_storage_bytes())
        self.assertEqual(self.service._webvue_count_usage('storage.limit_mb'), -(-used // 1048576))
        self.assertGreaterEqual(self.service._webvue_count_usage('storage.limit_mb'), 1)

    def test_branch_usage_counts_active_branches(self):
        active = self.env['webvue.tenant.branch'].search_count([('state', '=', 'active')])
        self.assertEqual(self.service._webvue_count_usage('branches.extra_limit'), active)

    def test_ordinary_user_attachment_moves_the_storage_quota_unelevated(self):
        """The attachment hooks call the entitlement service in the caller's environment; the
        service elevates its own tenant-profile read, so an employee still claims and releases storage."""
        revision = self.record.quota_revision
        attachment = self.env['ir.attachment'].with_user(self.employee).create({
            'name': 'employee.txt', 'raw': b'x' * 10, 'mimetype': 'text/plain',
        })
        self.assertGreater(self.record.quota_revision, revision)
        revision = self.record.quota_revision
        attachment.write({'raw': b'y' * 20})
        self.assertGreater(self.record.quota_revision, revision)
        revision = self.record.quota_revision
        attachment.unlink()
        self.assertGreater(self.record.quota_revision, revision)
        self._operator().write({'features': {**self.record.features, 'storage.limit_mb': 0}})
        with self.assertRaises(WebVueAccessRule) as error:
            self.env['ir.attachment'].with_user(self.employee).create({
                'name': 'refused.txt', 'raw': b'x' * 10, 'mimetype': 'text/plain',
            })
        self.assertEqual(error.exception.details['limit_key'], 'storage.limit_mb')
