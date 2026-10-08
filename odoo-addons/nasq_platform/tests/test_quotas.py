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

    def test_usage_counter_counts_users_and_leaves_unknown_limits_at_zero(self):
        self.assertEqual(self.service._nasq_count_usage('users.limit'), self.service._nasq_count_users())
        self.assertEqual(self.service._nasq_count_usage('unknown.limit'), 0)

    def test_storage_limit_blocks_binary_attachment(self):
        self._operator().write({'features': {**self.record.features, 'storage.limit_mb': 0}})
        with self.assertRaises(NasqAccessRule):
            self.env['ir.attachment'].create({
                'name': 'too-big.txt',
                'raw': b'x' * 100,
                'mimetype': 'text/plain',
            })

    def test_storage_usage_is_counted_in_whole_mebibytes(self):
        self.env['ir.attachment'].create({'name': 'counted.txt', 'raw': b'x' * 10, 'mimetype': 'text/plain'})
        used = int(self.service._nasq_count_storage_bytes())
        self.assertEqual(self.service._nasq_count_usage('storage.limit_mb'), -(-used // 1048576))
        self.assertGreaterEqual(self.service._nasq_count_usage('storage.limit_mb'), 1)

    def test_branch_usage_counts_active_branches(self):
        active = self.env['nasq.tenant.branch'].search_count([('state', '=', 'active')])
        self.assertEqual(self.service._nasq_count_usage('branches.extra_limit'), active)
