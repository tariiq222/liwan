# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestLiwanAccessMigration(TransactionCase):

    def test_builtin_role_repair_is_additive_and_idempotent(self):
        service = self.env['liwan.access.service']
        grants = service._liwan_builtin_role_grants()
        audit = self.env['liwan.access.permission'].search([('key', '=', 'access.audit.read')])
        roles = {role_xmlid: self.env.ref(role_xmlid) for role_xmlid in grants}

        # Recreate a database installed before access.audit.read was seeded.
        for role_xmlid in ('liwan_core.role_system_admin', 'liwan_core.role_vendor_support'):
            roles[role_xmlid].write({'permission_ids': [Command.unlink(audit.id)]})
        before = {
            role_xmlid: set(role.permission_ids.mapped('key'))
            for role_xmlid, role in roles.items()
        }
        custom = self.env['liwan.access.role'].create({
            'name_ar': 'دور اختبار الإصلاح',
            'name_en': 'Repair test role',
            'type': 'custom',
            'company_id': self.env.company.id,
            'permission_ids': [Command.link(audit.id)],
        })
        custom_keys = set(custom.permission_ids.mapped('key'))
        custom_version = custom.version

        self.assertTrue(service._liwan_repair_builtin_role_grants())

        for role_xmlid, role in roles.items():
            keys = set(role.permission_ids.mapped('key'))
            self.assertTrue(grants[role_xmlid] <= keys, role_xmlid)
            self.assertEqual(keys - before[role_xmlid], grants[role_xmlid] - before[role_xmlid], role_xmlid)
        self.assertIn('access.audit.read', roles['liwan_core.role_system_admin'].permission_ids.mapped('key'))
        self.assertIn('access.audit.read', roles['liwan_core.role_vendor_support'].permission_ids.mapped('key'))
        self.assertEqual(set(custom.permission_ids.mapped('key')), custom_keys)
        self.assertEqual(custom.version, custom_version)

        versions = {role_xmlid: role.version for role_xmlid, role in roles.items()}
        self.assertTrue(service._liwan_repair_builtin_role_grants())
        self.assertEqual({role_xmlid: role.version for role_xmlid, role in roles.items()}, versions)

    def test_builtin_role_repair_requires_superuser(self):
        user = new_test_user(
            self.env, login='role_repair_non_superuser', groups='base.group_user',
        )
        with self.assertRaisesRegex(AccessError, 'requires superuser'):
            self.env['liwan.access.service'].with_user(user)._liwan_repair_builtin_role_grants()

    def test_builtin_role_repair_refuses_an_unknown_permission(self):
        service_class = type(self.env['liwan.access.service'])
        with patch.object(
            service_class, '_liwan_builtin_role_grants',
            return_value={'liwan_core.role_employee': {'missing.capability.key'}},
        ), self.assertRaisesRegex(ValidationError, 'missing.capability.key'):
            self.env['liwan.access.service']._liwan_repair_builtin_role_grants()

    def test_dependencies_are_written_from_the_composed_map(self):
        service = self.env['liwan.access.service']
        Permission = self.env['liwan.access.permission']
        for key, required in service._liwan_permission_dependencies().items():
            permission = Permission.search([('key', '=', key)])
            self.assertEqual(set(permission.dependency_ids.mapped('key')), required, key)
        grant = Permission.search([('key', '=', 'access.users.grant')])
        grant.write({'dependency_ids': [Command.clear()]})
        self.assertTrue(service._liwan_configure_permission_dependencies())
        self.assertEqual(
            set(grant.dependency_ids.mapped('key')), {'access.users.read', 'access.roles.read'},
        )
        service_class = type(service)
        with patch.object(
            service_class, '_liwan_permission_dependencies',
            return_value={'access.users.grant': {'missing.capability.key'}},
        ), self.assertRaisesRegex(ValidationError, 'missing.capability.key'):
            service._liwan_configure_permission_dependencies()

    def test_legacy_admin_preservation_is_idempotent_and_excludes_vendor(self):
        legacy = new_test_user(
            self.env, login='legacy_admin_direct',
            groups='liwan_core.group_customer_admin',
        )
        inherited_group = self.env['res.groups'].create({
            'name': 'Legacy inheritor',
            'implied_ids': [(4, self.env.ref('liwan_core.group_customer_admin').id)],
        })
        inherited = new_test_user(
            self.env, login='legacy_admin_inherited', groups='base.group_user',
        )
        inherited.write({'group_ids': [(4, inherited_group.id)]})
        vendor = new_test_user(
            self.env, login='legacy_vendor', groups='liwan_core.group_vendor_support',
        )
        inactive = new_test_user(
            self.env, login='legacy_admin_inactive',
            groups='liwan_core.group_customer_admin',
        )
        inactive.write({'active': False})

        service = self.env['liwan.access.service']
        expected_roles = set(service._liwan_legacy_admin_roles())
        self.assertIn('system_admin', expected_roles)
        candidate_ids = service._liwan_capture_legacy_admin_ids()
        self.assertIn(legacy.id, candidate_ids)
        self.assertIn(inherited.id, candidate_ids)
        self.assertIn(inactive.id, candidate_ids)
        self.assertNotIn(vendor.id, candidate_ids)
        service._liwan_migrate_legacy_admins(candidate_ids)
        service._liwan_migrate_legacy_admins(candidate_ids)

        for user in (legacy, inherited, inactive):
            keys = set(self.env['liwan.access.assignment'].search([
                ('user_id', '=', user.id),
            ]).role_id.mapped('key'))
            self.assertEqual(keys, expected_roles)
            self.assertEqual(self.env['liwan.access.audit'].search_count([
                ('action', '=', 'migration.legacy_admin_preserved'),
                ('target_id', '=', user.id),
            ]), 1)

    def test_completed_upgrade_never_regrants_roles_removed_later(self):
        params = self.env['ir.config_parameter']
        params.set_param('liwan_core.access_migration_v1_done', '0')
        legacy = new_test_user(
            self.env, login='legacy_admin_one_time',
            groups='liwan_core.group_customer_admin',
        )
        service = self.env['liwan.access.service']
        params.set_param('liwan_core.legacy_access_admin_ids', '[%s]' % legacy.id)
        service._liwan_apply_legacy_admin_snapshot()
        system_role = self.env.ref('liwan_core.role_system_admin')
        self.env['liwan.access.assignment'].search([
            ('user_id', '=', legacy.id),
            ('role_id', '=', system_role.id),
        ]).unlink()

        service._liwan_snapshot_legacy_admins()
        service._liwan_apply_legacy_admin_snapshot()

        self.assertFalse(self.env['liwan.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
            ('role_id', '=', system_role.id),
        ]))

    def test_failed_migration_rolls_back_and_can_be_retried(self):
        legacy = new_test_user(
            self.env, login='legacy_admin_rollback',
            groups='liwan_core.group_customer_admin',
        )
        params = self.env['ir.config_parameter']
        params.set_param('liwan_core.access_migration_v1_done', '0')
        params.set_param(
            'liwan_core.legacy_access_admin_ids', '[%s]' % legacy.id,
        )
        service = self.env['liwan.access.service']
        audit_model = type(self.env['liwan.access.audit'])

        with self.assertRaisesRegex(RuntimeError, 'migration audit injection'):
            with self.env.cr.savepoint():
                with patch.object(
                    audit_model, '_liwan_log',
                    side_effect=RuntimeError('migration audit injection'),
                ):
                    service._liwan_apply_legacy_admin_snapshot()

        self.env.invalidate_all()
        self.assertFalse(self.env['liwan.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
        ]))
        self.assertFalse(self.env['liwan.access.audit'].search_count([
            ('action', '=', 'migration.legacy_admin_preserved'),
            ('target_id', '=', legacy.id),
        ]))
        self.assertEqual(
            params.get_param('liwan_core.access_migration_v1_done'), '0',
        )
        self.assertEqual(
            params.get_param('liwan_core.legacy_access_admin_ids'),
            '[%s]' % legacy.id,
        )

        service._liwan_apply_legacy_admin_snapshot()
        self.assertEqual(self.env['liwan.access.assignment'].search_count([
            ('user_id', '=', legacy.id),
        ]), len(service._liwan_legacy_admin_roles()))
        self.assertEqual(self.env['liwan.access.audit'].search_count([
            ('action', '=', 'migration.legacy_admin_preserved'),
            ('target_id', '=', legacy.id),
        ]), 1)
        self.assertEqual(
            params.get_param('liwan_core.access_migration_v1_done'), '1',
        )
        self.assertEqual(
            params.get_param('liwan_core.legacy_access_admin_ids'), '[]',
        )

    def test_existing_custom_roles_gain_new_dependencies(self):
        # A custom role saved before access.users.read depended on access.roles.read (#173).
        Permission = self.env['liwan.access.permission']
        users_read = Permission.search([('key', '=', 'access.users.read')])
        roles_read = Permission.search([('key', '=', 'access.roles.read')])
        role = self.env['liwan.access.role'].create({
            'name_ar': 'قارئ قديم', 'type': 'custom', 'company_id': self.env.company.id,
            'permission_ids': [Command.set((users_read | roles_read).ids)],
        })
        # The saved state of an older release: the constraint now refuses it, so it is written directly.
        self.env.cr.execute(
            'DELETE FROM liwan_access_role_permission_rel WHERE role_id = %s AND permission_id = %s',
            [role.id, roles_read.id],
        )
        role.invalidate_recordset(['permission_ids'])
        self.assertNotIn(roles_read, role.permission_ids)
        user = new_test_user(self.env, login='old_users_reader', groups='base.group_user')
        self.env['liwan.access.assignment'].create({'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id})
        self.env['liwan.access.service']._liwan_configure_permission_dependencies()
        self.assertIn(roles_read, role.permission_ids)
        self.assertTrue(user.has_group(roles_read.group_xmlid))
