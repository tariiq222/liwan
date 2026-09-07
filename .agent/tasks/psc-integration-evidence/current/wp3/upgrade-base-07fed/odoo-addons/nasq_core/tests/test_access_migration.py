# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('nasq', 'nasq_access')
class TestNasqAccessMigration(TransactionCase):

    def test_legacy_admin_preservation_is_idempotent_and_excludes_vendor(self):
        legacy = new_test_user(
            self.env, login='legacy_admin_direct',
            groups='nasq_core.group_customer_admin',
        )
        inherited_group = self.env['res.groups'].create({
            'name': 'Legacy inheritor',
            'implied_ids': [(4, self.env.ref('nasq_core.group_customer_admin').id)],
        })
        inherited = new_test_user(
            self.env, login='legacy_admin_inherited', groups='base.group_user',
        )
        inherited.write({'group_ids': [(4, inherited_group.id)]})
        vendor = new_test_user(
            self.env, login='legacy_vendor', groups='nasq_core.group_vendor_support',
        )
        inactive = new_test_user(
            self.env, login='legacy_admin_inactive',
            groups='nasq_core.group_customer_admin',
        )
        inactive.write({'active': False})

        service = self.env['nasq.access.service']
        candidate_ids = service._nasq_capture_legacy_admin_ids()
        self.assertIn(legacy.id, candidate_ids)
        self.assertIn(inherited.id, candidate_ids)
        self.assertIn(inactive.id, candidate_ids)
        self.assertNotIn(vendor.id, candidate_ids)
        service._nasq_migrate_legacy_admins(candidate_ids)
        service._nasq_migrate_legacy_admins(candidate_ids)

        for user in (legacy, inherited, inactive):
            keys = set(self.env['nasq.access.assignment'].search([
                ('user_id', '=', user.id),
            ]).role_id.mapped('key'))
            self.assertEqual(keys, {'system_admin', 'hr_manager', 'pmo_manager'})
            self.assertEqual(self.env['nasq.access.audit'].search_count([
                ('action', '=', 'migration.legacy_admin_preserved'),
                ('target_id', '=', user.id),
            ]), 1)

    def test_completed_upgrade_never_regrants_roles_removed_later(self):
        params = self.env['ir.config_parameter']
        params.set_param('nasq_core.access_migration_v1_done', '0')
        legacy = new_test_user(
            self.env, login='legacy_admin_one_time',
            groups='nasq_core.group_customer_admin',
        )
        service = self.env['nasq.access.service']
        params.set_param('nasq_core.legacy_access_admin_ids', '[%s]' % legacy.id)
        service._nasq_apply_legacy_admin_snapshot()
        self.env['nasq.access.assignment'].search([
            ('user_id', '=', legacy.id),
            ('role_id', '=', self.env.ref('nasq_core.role_hr_manager').id),
        ]).unlink()

        service._nasq_snapshot_legacy_admins()
        service._nasq_apply_legacy_admin_snapshot()

        self.assertFalse(self.env['nasq.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
            ('role_id', '=', self.env.ref('nasq_core.role_hr_manager').id),
        ]))

    def test_failed_migration_rolls_back_and_can_be_retried(self):
        legacy = new_test_user(
            self.env, login='legacy_admin_rollback',
            groups='nasq_core.group_customer_admin',
        )
        params = self.env['ir.config_parameter']
        params.set_param('nasq_core.access_migration_v1_done', '0')
        params.set_param(
            'nasq_core.legacy_access_admin_ids', '[%s]' % legacy.id,
        )
        service = self.env['nasq.access.service']
        audit_model = type(self.env['nasq.access.audit'])

        with self.assertRaisesRegex(RuntimeError, 'migration audit injection'):
            with self.env.cr.savepoint():
                with patch.object(
                    audit_model, '_nasq_log',
                    side_effect=RuntimeError('migration audit injection'),
                ):
                    service._nasq_apply_legacy_admin_snapshot()

        self.env.invalidate_all()
        self.assertFalse(self.env['nasq.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
        ]))
        self.assertFalse(self.env['nasq.access.audit'].search_count([
            ('action', '=', 'migration.legacy_admin_preserved'),
            ('target_id', '=', legacy.id),
        ]))
        self.assertEqual(
            params.get_param('nasq_core.access_migration_v1_done'), '0',
        )
        self.assertEqual(
            params.get_param('nasq_core.legacy_access_admin_ids'),
            '[%s]' % legacy.id,
        )

        service._nasq_apply_legacy_admin_snapshot()
        self.assertEqual(self.env['nasq.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
        ]), 3)
        self.assertEqual(self.env['nasq.access.audit'].search_count([
            ('action', '=', 'migration.legacy_admin_preserved'),
            ('target_id', '=', legacy.id),
        ]), 1)
        self.assertEqual(
            params.get_param('nasq_core.access_migration_v1_done'), '1',
        )
        self.assertEqual(
            params.get_param('nasq_core.legacy_access_admin_ids'), '[]',
        )
