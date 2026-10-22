# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestBranchAccess(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Member branch', 'parent_id': cls.parent.id})
        cls.other = cls.env['res.company'].create({'name': 'Unrelated member'})
        cls.user = new_test_user(cls.env, login='branch_actor', groups='base.group_user,base.group_allow_export',
                                 company_id=cls.parent.id,
                                 company_ids=[Command.set((cls.parent | cls.branch | cls.other).ids)])
        cls.read_group, cls.write_group = cls.env['res.groups'].create([
            {'name': 'Branch probe read'}, {'name': 'Branch probe write'},
        ])
        for group, key in ((cls.read_group, 'probe.items.read'), (cls.write_group, 'probe.items.manage')):
            cls.env['ir.model.data'].create({'module': 'webvue_core', 'name': f'branch_probe_{group.id}',
                                              'model': 'res.groups', 'res_id': group.id})
            cls.env['webvue.access.permission'].create({
                'key': key, 'name_ar': key, 'name_en': key, 'domain': 'probe',
                'group_xmlid': f'webvue_core.branch_probe_{group.id}', 'custom_role_allowed': True,
                'resource': 'items', 'action': key.rsplit('.', 1)[1], 'description_ar': key,
            })
        permissions = cls.env['webvue.access.permission'].search([('key', 'like', 'probe.items.')])
        cls.reader, cls.writer = cls.env['webvue.access.role'].create([
            {'key': 'branch_probe_reader', 'type': 'built_in', 'name_ar': 'reader',
             'permission_ids': [Command.set(permissions.filtered(lambda p: p.key.endswith('.read')).ids)]},
            {'key': 'branch_probe_writer', 'type': 'built_in', 'name_ar': 'writer',
             'permission_ids': [Command.set(permissions.ids)]},
        ])
        cls.env['ir.model.access'].create({
            'name': 'branch probe reader', 'model_id': cls.env['ir.model']._get_id('res.partner'),
            'group_id': cls.read_group.id, 'perm_read': True,
        })
        cls.env['ir.model.access'].create({
            'name': 'branch probe writer', 'model_id': cls.env['ir.model']._get_id('res.partner'),
            'group_id': cls.write_group.id, 'perm_read': True, 'perm_write': True,
        })
        cls.env['webvue.access.assignment'].create({
            'user_id': cls.user.id, 'role_id': cls.writer.id, 'company_id': cls.parent.id,
        })
        cls.record = cls.env['res.partner'].create({'name': 'Branch secret', 'company_id': cls.branch.id})
        cls.service = cls.env['webvue.access.service'].with_user(cls.user).with_context(
            allowed_company_ids=[cls.parent.id, cls.branch.id, cls.other.id],
        )

    def grant(self, role, company=None):
        return self.env['webvue.access.assignment'].create({
            'user_id': self.user.id, 'role_id': role.id, 'company_id': (company or self.branch).id,
        })

    def test_parent_capability_does_not_authorize_branch_record(self):
        self.assertFalse(self.service._webvue_has_capability(self.user, 'probe.items.read', record=self.record))
        self.grant(self.reader)
        self.assertTrue(self.service._webvue_has_capability(self.user, 'probe.items.read', record=self.record))
        self.assertFalse(self.service._webvue_has_capability(self.user, 'probe.items.manage', record=self.record))

    def test_delegated_default_and_capability_company_scope(self):
        self.assertEqual(self.parent.webvue_branch_access_mode, 'delegated')
        self.assertEqual(self.service._webvue_capability_company_ids(('probe.items.read',)), [self.parent.id])
        self.grant(self.reader)
        self.assertEqual(set(self.service._webvue_capability_company_ids(('probe.items.read',))),
                         {self.parent.id, self.branch.id})
        self.assertEqual(self.service._webvue_capability_company_ids(('probe.items.manage',)), [self.parent.id])

    def test_raw_stock_access_and_export_do_not_widen_from_membership(self):
        actor_record = self.record.with_env(self.service.env)
        self.assertFalse(actor_record.has_access('read'))
        with self.assertRaises(AccessError):
            actor_record.export_data(['name'])
        self.grant(self.reader)
        self.assertFalse(actor_record.has_access('read'), 'plain ORM stays current-only')
        scoped = actor_record.with_context(webvue_capability_scope=((('probe.items.read',), 'all'),))
        self.assertTrue(scoped.has_access('read'))
        self.assertFalse(scoped.has_access('write'), 'parent write ACL cannot mutate branch read grant')

    def test_inheritance_is_selected_and_revokes_without_cache(self):
        admin = self.env.ref('webvue_core.role_system_admin')
        self.grant(admin, self.parent)
        svc = self.service
        policy = svc._webvue_branch_policy()
        updated = svc._webvue_update_branch_policy(policy['version'], 'inherited', [
            {'id': self.branch.id, 'inherit': True, 'role_ids': [self.writer.id]},
        ])
        self.assertTrue(svc._webvue_has_capability(self.user, 'probe.items.manage', record=self.record))
        svc._webvue_update_branch_policy(updated['version'], 'inherited', [
            {'id': self.branch.id, 'inherit': False, 'role_ids': [self.writer.id]},
        ])
        self.assertFalse(svc._webvue_has_capability(self.user, 'probe.items.manage', record=self.record))

    def test_policy_rejects_stale_foreign_and_unauthorized_mutation(self):
        with self.assertRaises(AccessError):
            self.service._webvue_branch_policy()
        self.grant(self.env.ref('webvue_core.role_system_admin'), self.parent)
        policy = self.service._webvue_branch_policy()
        updated = self.service._webvue_update_branch_policy(policy['version'], 'isolated', [])
        with self.assertRaisesRegex(ValidationError, 'conflict'):
            self.service._webvue_update_branch_policy(policy['version'], 'delegated', [])
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            self.service._webvue_update_branch_policy(updated['version'], 'delegated', [
                {'id': self.other.id, 'inherit': True, 'role_ids': []},
            ])

    def test_custom_branch_delegation_preserves_parent_roles_and_revokes(self):
        self.grant(self.env.ref('webvue_core.role_system_admin'), self.parent)
        custom = self.env['webvue.access.role'].with_company(self.branch).create({
            'name_ar': 'Branch reader',
            'permission_ids': [Command.set(self.reader.permission_ids.ids)],
        })
        before_parent = set(self.env['webvue.access.assignment'].search([
            ('user_id', '=', self.user.id), ('company_id', '=', self.parent.id),
        ]).role_id.ids)
        state = self.service._webvue_user_branch_access(self.user)
        self.assertIn(custom.id, [role['id'] for role in state['roles']])
        updated = self.service._webvue_update_user_branch_access(self.user, state['version'], [
            {'id': self.branch.id, 'role_ids': [custom.id]},
        ])
        self.assertTrue(self.service._webvue_has_capability(self.user, 'probe.items.read', record=self.record))
        self.assertFalse(self.service._webvue_has_capability(self.user, 'probe.items.manage', record=self.record))
        self.service._webvue_update_user_branch_access(self.user, updated['version'], [
            {'id': self.branch.id, 'role_ids': []},
        ])
        self.assertFalse(self.service._webvue_has_capability(self.user, 'probe.items.read', record=self.record))
        self.assertEqual(before_parent, set(self.env['webvue.access.assignment'].search([
            ('user_id', '=', self.user.id), ('company_id', '=', self.parent.id),
        ]).role_id.ids))

    def test_attachment_target_checks_follow_operation_scope(self):
        attachment = self.env['ir.attachment'].create({
            'name': 'Branch attachment', 'datas': 'aGVsbG8=',
            'res_model': 'res.partner', 'res_id': self.record.id,
            'company_id': self.branch.id,
        })
        actor = attachment.with_env(self.service.env)
        self.assertFalse(actor.has_access('read'))
        self.grant(self.reader)
        scoped = actor.with_context(webvue_capability_scope=((('probe.items.read',), 'all'),))
        self.assertTrue(scoped.has_access('read'))
        self.assertFalse(scoped.has_access('write'))

    def test_isolated_policy_denies_even_explicit_branch_grants(self):
        self.grant(self.reader)
        self.parent.webvue_branch_access_mode = 'isolated'
        self.assertFalse(self.service._webvue_has_capability(self.user, 'probe.items.read', record=self.record))
        self.assertNotIn(self.branch.id, self.service._webvue_capability_company_ids(('probe.items.read',)))

    def test_last_branch_administrator_survives_delegation_changes(self):
        system_admin = self.env.ref('webvue_core.role_system_admin')
        self.grant(system_admin, self.parent)
        self.grant(system_admin)
        state = self.service._webvue_user_branch_access(self.user)
        with self.assertRaisesRegex(ValidationError, 'last_access_admin'):
            self.service._webvue_update_user_branch_access(self.user, state['version'], [
                {'id': self.branch.id, 'role_ids': []},
            ])
        second = new_test_user(self.env, login='branch_second_admin', groups='base.group_user',
                               company_ids=[Command.set((self.parent | self.branch).ids)])
        self.env['webvue.access.assignment'].create({
            'user_id': second.id, 'role_id': system_admin.id, 'company_id': self.branch.id,
        })
        state = self.service._webvue_user_branch_access(self.user)
        self.service._webvue_update_user_branch_access(self.user, state['version'], [
            {'id': self.branch.id, 'role_ids': []},
        ])
        self.assertFalse(self.service._webvue_has_capability(self.user, 'access.users.assign_roles', company=self.branch))

    def test_custom_role_cannot_cross_branches_or_enter_inheritance(self):
        self.grant(self.env.ref('webvue_core.role_system_admin'), self.parent)
        other_branch = self.env['res.company'].create({'name': 'Second member branch', 'parent_id': self.parent.id})
        self.user.company_ids = [Command.link(other_branch.id)]
        role = self.env['webvue.access.role'].with_company(other_branch).create({
            'name_ar': 'Second branch only', 'permission_ids': [Command.set(self.reader.permission_ids.ids)],
        })
        state = self.service._webvue_user_branch_access(self.user)
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            self.service._webvue_update_user_branch_access(self.user, state['version'], [
                {'id': self.branch.id, 'role_ids': [role.id]},
            ])
        policy = self.service._webvue_branch_policy()
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            self.service._webvue_update_branch_policy(policy['version'], 'inherited', [
                {'id': other_branch.id, 'inherit': True, 'role_ids': [role.id]},
            ])

    def test_isolated_mode_keeps_last_branch_administrator_guard(self):
        admin_role = self.env.ref('webvue_core.role_system_admin')
        self.grant(admin_role, self.parent)
        self.grant(admin_role)
        self.parent.webvue_branch_access_mode = 'isolated'
        state = self.service._webvue_user_branch_access(self.user)
        with self.assertRaisesRegex(ValidationError, 'last_access_admin'):
            self.service._webvue_update_user_branch_access(self.user, state['version'], [
                {'id': self.branch.id, 'role_ids': []},
            ])
        second = new_test_user(self.env, login='isolated_branch_second_admin', groups='base.group_user',
                               company_ids=[Command.set((self.parent | self.branch).ids)])
        self.env['webvue.access.assignment'].create({
            'user_id': second.id, 'role_id': admin_role.id, 'company_id': self.branch.id,
        })
        state = self.service._webvue_user_branch_access(self.user)
        result = self.service._webvue_update_user_branch_access(self.user, state['version'], [
            {'id': self.branch.id, 'role_ids': []},
        ])
        self.assertEqual(result['branches'][0]['role_ids'], [])


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestLegacyNativeBranchAccess(TransactionCase):
    def test_unmanaged_native_home_grants_are_preserved_only_at_home(self):
        parent = self.env.company
        branch = self.env['res.company'].create({'name': 'Legacy native member branch', 'parent_id': parent.id})
        user = new_test_user(self.env, login='legacy_native_partner_manager',
                             groups='base.group_user,base.group_partner_manager', company_id=parent.id,
                             company_ids=[Command.set((parent | branch).ids)])
        actor = self.env['res.partner'].with_user(user).with_context(allowed_company_ids=[parent.id])
        self.assertIn(parent.id, actor.env['webvue.access.service']._webvue_model_company_ids('res.partner', 'create'))
        contact = actor.create({'name': 'Authorized legacy home contact', 'company_id': parent.id})
        contact.write({'name': 'Updated legacy home contact'})
        foreign = self.env['res.partner'].create({'name': 'Forbidden branch contact', 'company_id': branch.id})
        self.assertFalse(foreign.with_env(actor.env).has_access('write'))
        branch_actor = actor.with_context(allowed_company_ids=[branch.id])
        self.assertFalse(foreign.with_env(branch_actor.env).has_access('write'),
                         'legacy home group must not lend its native write ACL to a member branch')

    def test_managed_identity_does_not_reuse_unscoped_native_groups(self):
        user = new_test_user(self.env, login='managed_native_partner_manager',
                             groups='base.group_user,base.group_partner_manager')
        self.env['webvue.access.assignment'].create({
            'user_id': user.id, 'role_id': self.env.ref('webvue_core.role_employee').id,
            'company_id': self.env.company.id,
        })
        actor = self.env['res.partner'].with_user(user)
        self.assertNotIn(self.env.company.id, actor.env['webvue.access.service']._webvue_model_company_ids('res.partner', 'create'))
