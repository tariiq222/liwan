# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, UserError, ValidationError
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
        scoped = svc.with_context(webvue_capability_scope=((('probe.items.read',), 'all'),))
        self.assertIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'read'))
        self.writer.active = False
        self.assertNotIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'read'))
        self.writer.active = True
        self.assertIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'read'))
        updated = svc._webvue_branch_policy()
        svc._webvue_update_branch_policy(updated['version'], 'inherited', [
            {'id': self.branch.id, 'inherit': False, 'role_ids': [self.writer.id]},
        ])
        self.assertFalse(svc._webvue_has_capability(self.user, 'probe.items.manage', record=self.record))
        self.assertNotIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'read'))

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

    def test_local_capability_keeps_its_native_internal_group_implication(self):
        self.env['ir.model.access'].search([('name', '=', 'branch probe reader')]).unlink()
        self.read_group.implied_ids = [Command.link(self.env.ref('base.group_user').id)]
        self.grant(self.reader)
        scoped = self.record.with_env(self.service.env).with_context(
            webvue_capability_scope=((('probe.items.read',), 'all'),),
        )
        self.assertTrue(scoped.has_access('read'), 'a locally implied native group keeps its native read ACL')
        self.assertFalse(scoped.has_access('write'), 'the parent writer group must still not reach this branch')

    def test_repeated_native_scope_is_bounded_and_mutations_revoke_immediately(self):
        assignment = self.grant(self.reader)
        service = self.service.with_context(webvue_capability_scope=((('probe.items.read',), 'all'),))
        self.assertIn(self.branch.id, service._webvue_model_company_ids('res.partner', 'read'))
        before = self.env.cr.sql_log_count
        for _index in range(10):
            self.assertIn(self.branch.id, service._webvue_model_company_ids('res.partner', 'read'))
        self.assertLess(self.env.cr.sql_log_count - before, 30)
        assignment.unlink()
        self.assertNotIn(self.branch.id, service._webvue_model_company_ids('res.partner', 'read'))
        self.grant(self.reader)
        self.assertIn(self.branch.id, service._webvue_model_company_ids('res.partner', 'read'))
        self.reader.permission_ids = [Command.clear()]
        self.assertNotIn(self.branch.id, service._webvue_model_company_ids('res.partner', 'read'))

    def test_transaction_memo_observes_assignment_move_and_native_definition_changes(self):
        assignment = self.grant(self.reader)
        scoped = self.service.with_context(webvue_capability_scope=((('probe.items.read',), 'all'),))

        def allowed():
            return scoped._webvue_model_company_ids('res.partner', 'read')

        self.assertIn(self.branch.id, allowed())
        assignment.write({'company_id': self.other.id})
        self.assertNotIn(self.branch.id, allowed())
        assignment.write({'company_id': self.branch.id})
        self.assertIn(self.branch.id, allowed())
        assignment.write({'role_id': self.writer.id})
        self.assertIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'write'))
        assignment.write({'role_id': self.reader.id})
        self.assertNotIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'write'))
        acl = self.env['ir.model.access'].search([('name', '=', 'branch probe reader')])
        acl.write({'perm_read': False})
        self.assertNotIn(self.branch.id, allowed())
        self.read_group.write({'implied_ids': [Command.link(self.env.ref('base.group_user').id)]})
        self.assertIn(self.branch.id, allowed())
        self.read_group.write({'implied_ids': [Command.clear()]})
        self.assertNotIn(self.branch.id, allowed())

    def test_transaction_memo_observes_membership_hierarchy_and_scope_context(self):
        self.grant(self.reader)
        scoped = self.service.with_context(allowed_company_ids=[self.parent.id],
                                           webvue_capability_scope=((('probe.items.read',), 'all'),))

        def allowed(service=scoped):
            return service._webvue_model_company_ids('res.partner', 'read')

        self.assertIn(self.branch.id, allowed())
        self.assertNotIn(self.branch.id, allowed(self.service))
        self.assertNotIn(self.branch.id, allowed(scoped.with_context(
            webvue_capability_scope=((('probe.items.read', 'probe.items.manage'), 'all'),))))
        self.assertIn(self.branch.id, allowed(scoped.with_context(
            webvue_capability_scope=((('probe.items.read', 'probe.items.manage'), 'any'),))))
        self.assertEqual(allowed(scoped.with_company(self.branch)), [self.branch.id])
        self.user.write({'company_ids': [Command.unlink(self.branch.id)]})
        self.assertNotIn(self.branch.id, allowed())
        self.user.write({'company_ids': [Command.link(self.branch.id)]})
        self.assertIn(self.branch.id, allowed())
        with self.assertRaises(UserError):
            self.branch.write({'parent_id': False})
        self.assertIn(self.branch.id, allowed(), 'native Odoo rejects hierarchy mutation')
        self.parent.write({'webvue_branch_access_mode': 'isolated'})
        self.assertNotIn(self.branch.id, allowed())

    def test_protected_user_create_reuses_home_contact_without_lending_business_create(self):
        admin = new_test_user(self.env, login='existing_contact_admin', groups='webvue_core.group_access_admin',
                              company_id=self.parent.id, company_ids=[self.parent.id])
        home, foreign = self.env['res.partner'].create([
            {'name': 'Home account contact', 'company_id': self.parent.id},
            {'name': 'Foreign account contact', 'company_id': self.other.id},
        ])
        Users = self.env['res.users'].with_user(admin).with_context(allowed_company_ids=[self.parent.id])
        values = {'name': 'Existing contact account', 'login': 'existing.contact@example.test',
                  'company_id': self.parent.id, 'company_ids': [Command.set([self.parent.id])],
                  'group_ids': [Command.set([self.env.ref('base.group_user').id])], 'partner_id': home.id}
        user = Users._webvue_access_create(values)
        self.assertEqual(user.partner_id.id, home.id)
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            Users._webvue_access_create({**values, 'login': 'foreign.contact@example.test', 'partner_id': foreign.id})
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            self.env['res.partner'].with_user(admin).create({'name': 'Ordinary denied contact'})

    def test_native_internal_identity_read_does_not_grant_business_or_attachment_access(self):
        identity = new_test_user(self.env, login='foreign_identity_reference', groups='base.group_user',
                                 company_id=self.other.id).partner_id
        identity.company_id = self.other
        business = self.env['res.partner'].create({'name': 'Foreign business', 'company_id': self.other.id})
        attachment = self.env['ir.attachment'].create({
            'name': 'Identity private attachment', 'raw': b'private', 'type': 'binary',
            'res_model': 'res.partner', 'res_id': identity.id, 'company_id': self.other.id,
        })
        actor_identity = identity.with_env(self.service.env)
        self.assertTrue(actor_identity.has_access('read'), 'native internal identity references remain readable')
        self.assertFalse(actor_identity.has_access('write'))
        self.assertFalse(actor_identity.has_access('unlink'))
        self.assertFalse(business.with_env(self.service.env).has_access('read'))
        self.assertFalse(business.with_env(self.service.env).has_access('write'))
        self.assertFalse(attachment.with_env(self.service.env).has_access('read'), 'identity refs do not authorize files')
        self.env['ir.rule'].create({
            'name': 'Private identity native rule', 'model_id': self.env['ir.model']._get_id('res.partner'),
            'domain_force': repr([('id', '!=', identity.id)]),
        })
        self.assertFalse(actor_identity.has_access('read'), 'the original native domain still intersects')

    def test_transaction_memo_cannot_keep_a_rolled_back_grant(self):
        scoped = self.service.with_context(webvue_capability_scope=((('probe.items.read',), 'all'),))
        self.assertNotIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'read'))
        with self.assertRaisesRegex(ValidationError, 'rollback_probe'), self.env.cr.savepoint():
            self.grant(self.reader)
            self.assertIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'read'))
            message = 'rollback_probe'
            raise ValidationError(message)
        self.assertNotIn(self.branch.id, scoped._webvue_model_company_ids('res.partner', 'read'))


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


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestBranchRoleLifecycle(TransactionCase):
    def test_assigned_inactive_branch_role_is_visible_retainable_and_revocable(self):
        service = self.env['webvue.access.service']
        parent = self.env.company
        branch = self.env['res.company'].create({'name': 'Disabled role branch', 'parent_id': parent.id})
        user = new_test_user(self.env, login='disabled_branch_role_target', groups='base.group_user',
                             company_ids=[Command.set((parent | branch).ids)])
        self.env['webvue.access.assignment'].create({
            'user_id': user.id, 'company_id': parent.id, 'role_id': self.env.ref('webvue_core.role_system_admin').id,
        })
        actor_service = service.with_user(user)
        disabled = self.env['webvue.access.role'].with_company(branch).create({'name_ar': 'Disabled branch role'})
        self.env['webvue.access.assignment'].create({'user_id': user.id, 'company_id': branch.id, 'role_id': disabled.id})
        disabled.write({'active': False})
        state = actor_service._webvue_user_branch_access(user)
        self.assertIn(disabled.id, [role['id'] for role in state['roles']])
        self.assertFalse(next(role for role in state['roles'] if role['id'] == disabled.id)['active'])
        employee = self.env.ref('webvue_core.role_employee')
        updated = actor_service._webvue_update_user_branch_access(user, state['version'], [
            {'id': branch.id, 'role_ids': [disabled.id, employee.id]},
        ])
        self.assertEqual(set(updated['branches'][0]['role_ids']), {disabled.id, employee.id})
        revoked = actor_service._webvue_update_user_branch_access(user, updated['version'], [
            {'id': branch.id, 'role_ids': [employee.id]},
        ])
        self.assertNotIn(disabled.id, [role['id'] for role in revoked['roles']])
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            actor_service._webvue_update_user_branch_access(user, revoked['version'], [
                {'id': branch.id, 'role_ids': [disabled.id]},
            ])

    def test_inactive_global_role_cannot_be_added_to_another_branch(self):
        parent = self.env.company
        branches = self.env['res.company'].create([
            {'name': 'Inactive grant branch A', 'parent_id': parent.id},
            {'name': 'Inactive grant branch B', 'parent_id': parent.id},
        ])
        user = new_test_user(self.env, login='inactive_global_branch_target', groups='base.group_user',
                             company_ids=[Command.set((parent | branches).ids)])
        Assignment = self.env['webvue.access.assignment']
        Assignment.create({'user_id': user.id, 'company_id': parent.id,
                           'role_id': self.env.ref('webvue_core.role_system_admin').id})
        role = self.env['webvue.access.role'].create({'key': 'inactive_global_branch', 'name_ar': 'Inactive global', 'type': 'built_in'})
        Assignment.create({'user_id': user.id, 'company_id': branches[0].id, 'role_id': role.id})
        role.write({'active': False})
        service = self.env['webvue.access.service'].with_user(user)
        state = service._webvue_user_branch_access(user)
        self.assertIn(role.id, [item['id'] for item in state['roles']])
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            service._webvue_update_user_branch_access(user, state['version'], [
                {'id': branches[1].id, 'role_ids': [role.id]},
            ])
        policy = service._webvue_branch_policy()
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            service._webvue_update_branch_policy(policy['version'], 'inherited', [
                {'id': branches[1].id, 'inherit': True, 'role_ids': [role.id]},
            ])

    def test_configured_inactive_inherited_role_remains_visible_for_removal(self):
        parent = self.env.company
        branches = self.env['res.company'].create([
            {'name': 'Disabled inheritance A', 'parent_id': parent.id},
            {'name': 'Disabled inheritance B', 'parent_id': parent.id},
        ])
        user = new_test_user(self.env, login='inactive_inheritance_actor', groups='base.group_user',
                             company_ids=[Command.set((parent | branches).ids)])
        self.env['webvue.access.assignment'].create({'user_id': user.id, 'company_id': parent.id,
                                                   'role_id': self.env.ref('webvue_core.role_system_admin').id})
        role = self.env['webvue.access.role'].create({'key': 'inactive_inheritance', 'name_ar': 'Disabled inheritance', 'type': 'built_in'})
        service = self.env['webvue.access.service'].with_user(user)
        state = service._webvue_branch_policy()
        service._webvue_update_branch_policy(state['version'], 'inherited', [
            {'id': branches[0].id, 'inherit': True, 'role_ids': [role.id]},
        ])
        role.write({'active': False})
        state = service._webvue_branch_policy()
        self.assertIn(role.id, [item['id'] for item in state['roles']])
        self.assertFalse(next(item for item in state['roles'] if item['id'] == role.id)['active'])
        updated = service._webvue_update_branch_policy(state['version'], 'inherited', [
            {'id': branches[0].id, 'inherit': False, 'role_ids': [role.id]},
        ])
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            service._webvue_update_branch_policy(updated['version'], 'inherited', [
                {'id': branches[1].id, 'inherit': True, 'role_ids': [role.id]},
            ])
        removed = service._webvue_update_branch_policy(updated['version'], 'inherited', [
            {'id': branches[0].id, 'inherit': False, 'role_ids': []},
        ])
        self.assertNotIn(role.id, [item['id'] for item in removed['roles']])
