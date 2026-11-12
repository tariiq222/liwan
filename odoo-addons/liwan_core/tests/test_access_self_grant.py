# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

PROBE_KEY = 'probe_payroll.salaries.manage'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestSelfGrantPolicy(TransactionCase):
    """An administrator granting themselves beyond system administration, restricted or allowed per company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.service = cls.env['liwan.access.service']
        cls.company = cls.env.company
        group = cls.env['res.groups'].create({'name': 'Self grant probe'})
        cls.env['ir.model.data'].create({
            'module': 'liwan_core', 'name': f'self_grant_probe_{group.id}', 'model': 'res.groups', 'res_id': group.id,
        })
        cls.probe = cls.env['liwan.access.permission'].create({
            'key': PROBE_KEY, 'name_ar': PROBE_KEY, 'name_en': PROBE_KEY, 'domain': 'probe_payroll',
            'group_xmlid': f'liwan_core.self_grant_probe_{group.id}', 'custom_role_allowed': True,
            'resource': 'salaries', 'action': 'manage', 'description_ar': PROBE_KEY,
        })
        Role = cls.env['liwan.access.role']
        cls.payroll_like = Role._liwan_access_create({
            'name_ar': 'دور رواتب تجريبي', 'permission_ids': [Command.set(cls.probe.ids)],
        })
        cls.system_role = cls.env.ref('liwan_core.role_system_admin')
        cls.employee_role = cls.env.ref('liwan_core.role_employee')
        cls.admin_a = new_test_user(cls.env, login='self_grant_admin_a', groups='base.group_user')
        cls.admin_b = new_test_user(cls.env, login='self_grant_admin_b', groups='base.group_user')
        for user in (cls.admin_a, cls.admin_b):
            cls.service._liwan_replace_assignments(
                user, [{'role_id': cls.system_role.id, 'company_id': cls.company.id}],
            )
        cls.as_a = cls.service.with_user(cls.admin_a)
        cls.as_b = cls.service.with_user(cls.admin_b)

    def assign(self, service, user, *roles):
        service._liwan_replace_assignments(
            user, [{'role_id': role.id, 'company_id': self.company.id} for role in roles],
        )

    def allow_self_grant(self):
        policy = self.as_a._liwan_access_policy()
        self.as_a._liwan_set_self_grant_policy(policy['version'], 'allowed')

    def assert_refused(self, call):
        with self.assertRaises(LiwanAccessRule) as caught:
            call()
        self.assertEqual(caught.exception.code, 'self_grant_restricted')
        self.assertEqual(caught.exception.status, 403)
        self.assertEqual(caught.exception.details['permissions'], [PROBE_KEY])
        return caught.exception

    def test_default_is_restricted(self):
        self.assertEqual(self.company.liwan_self_grant_policy, 'restricted')
        self.assertEqual(self.as_a._liwan_access_policy()['self_grant'], 'restricted')

    def test_restricted_refuses_self_adding_an_elevating_role(self):
        error = self.assert_refused(lambda: self.assign(self.as_a, self.admin_a, self.system_role, self.payroll_like))
        self.assertEqual(error.details['roles'], [self.payroll_like.key])
        self.assertNotIn(PROBE_KEY, self.service._liwan_capability_keys(self.admin_a))

    def test_restricted_refuses_direct_assignment_create_and_role_rewrite(self):
        Assignment = self.env['liwan.access.assignment'].with_user(self.admin_a)
        self.assert_refused(lambda: Assignment._liwan_access_create({
            'user_id': self.admin_a.id, 'role_id': self.payroll_like.id, 'company_id': self.company.id,
        }))
        held = self.env['liwan.access.assignment'].search([
            ('user_id', '=', self.admin_a.id), ('role_id', '=', self.system_role.id),
        ])
        self.assert_refused(lambda: held.with_user(self.admin_a)._liwan_access_write({'role_id': self.payroll_like.id}))

    def test_restricted_refuses_self_branch_role_assignment(self):
        branch = self.env['res.company'].create({'name': 'Self grant branch', 'parent_id': self.company.id})
        self.admin_a.write({'company_ids': [Command.link(branch.id)]})
        role = self.env['liwan.access.role'].with_company(branch)._liwan_access_create({
            'name_ar': 'دور فرع تجريبي', 'permission_ids': [Command.set(self.probe.ids)],
        })
        service = self.as_a.with_context(allowed_company_ids=[self.company.id, branch.id])
        version = service._liwan_user_branch_version(self.admin_a)
        self.assert_refused(lambda: service._liwan_update_user_branch_access(
            self.admin_a, version, [{'id': branch.id, 'role_ids': [role.id]}],
        ))
        self.assertFalse(self.env['liwan.access.assignment'].search([('user_id', '=', self.admin_a.id), ('company_id', '=', branch.id)]))

    def test_restricted_refuses_adding_a_permission_to_a_held_custom_role(self):
        reading = self.env['liwan.access.permission'].search([('key', '=', 'access.roles.read')])
        held = self.env['liwan.access.role']._liwan_access_create({
            'name_ar': 'دور قراءة الأدوار', 'permission_ids': [Command.set(reading.ids)],
        })
        self.assign(self.as_b, self.admin_a, self.system_role, held)
        self.assert_refused(lambda: held.with_user(self.admin_a)._liwan_access_write({
            'permission_ids': [Command.set((reading | self.probe).ids)],
        }))
        self.assertEqual(held.permission_ids, reading)

    def test_restricted_allows_resaving_removing_employee_and_granting_others(self):
        self.assign(self.as_b, self.admin_a, self.system_role, self.payroll_like)
        self.assertIn(PROBE_KEY, self.service._liwan_capability_keys(self.admin_a))
        # Re-saving a role already held is not an elevation.
        self.assign(self.as_a, self.admin_a, self.system_role, self.payroll_like)
        # Editing a held role keeps working when it adds nothing new.
        self.payroll_like.with_user(self.admin_a)._liwan_access_write({'description': 'edited'})
        # Removing is always allowed.
        self.assign(self.as_a, self.admin_a, self.system_role)
        self.assertNotIn(PROBE_KEY, self.service._liwan_capability_keys(self.admin_a))
        # Granting the elevating role to another user is not a self-grant.
        self.assign(self.as_a, self.admin_b, self.system_role, self.payroll_like)
        self.assertIn(PROBE_KEY, self.service._liwan_capability_keys(self.admin_b))

    def test_restricted_never_counts_the_employee_role_as_elevation(self):
        original = type(self.service)._liwan_builtin_role_grants
        self.patch(type(self.service), '_liwan_builtin_role_grants', lambda model: {
            **original(model), 'liwan_core.role_employee': {PROBE_KEY},
        })
        self.employee_role._liwan_do_write({'permission_ids': [Command.set(self.probe.ids)]})
        self.assign(self.as_a, self.admin_a, self.system_role, self.employee_role)
        self.assertIn(PROBE_KEY, self.service._liwan_capability_keys(self.admin_a))

    def test_allowed_permits_every_self_grant_path(self):
        self.allow_self_grant()
        self.assign(self.as_a, self.admin_a, self.system_role, self.payroll_like)
        self.assertIn(PROBE_KEY, self.service._liwan_capability_keys(self.admin_a))
        reading = self.env['liwan.access.permission'].search([('key', '=', 'access.roles.read')])
        held = self.env['liwan.access.role']._liwan_access_create({
            'name_ar': 'دور قراءة الأدوار', 'permission_ids': [Command.set(reading.ids)],
        })
        self.assign(self.as_a, self.admin_a, self.system_role, self.payroll_like, held)
        held.with_user(self.admin_a)._liwan_access_write({'permission_ids': [Command.set((reading | self.probe).ids)]})
        self.assertEqual(held.permission_ids, reading | self.probe)

    def test_superuser_and_other_targets_are_exempt(self):
        self.service._liwan_assert_self_grant(self.env.user, self.company, set(), {PROBE_KEY})
        self.as_a._liwan_assert_self_grant(self.admin_b, self.company, set(), {PROBE_KEY})
        self.assert_refused(lambda: self.as_a._liwan_assert_self_grant(self.admin_a, self.company, set(), {PROBE_KEY}))

    def test_policy_change_needs_both_capabilities_and_a_current_version(self):
        reading = self.env['liwan.access.permission'].search([('key', 'in', [
            'access.users.read', 'access.roles.read', 'access.users.assign_roles',
        ])])
        partial = self.env['liwan.access.role'].create({
            'key': 'self_grant_partial', 'type': 'built_in', 'name_ar': 'دور تعيين فقط',
            'permission_ids': [Command.set(reading.ids)],
        })
        manager = new_test_user(self.env, login='self_grant_partial', groups='base.group_user')
        self.assign(self.service, manager, partial)
        as_manager = self.service.with_user(manager)
        version = as_manager._liwan_access_policy()['version']
        with self.assertRaises(AccessError):
            as_manager._liwan_set_self_grant_policy(version, 'allowed')
        self.assertEqual(self.company.liwan_self_grant_policy, 'restricted')
        with self.assertRaises(LiwanAccessRule) as caught:
            self.as_a._liwan_set_self_grant_policy('p0-v0', 'allowed')
        self.assertEqual((caught.exception.code, caught.exception.status), ('conflict', 409))
        with self.assertRaises(LiwanAccessRule) as caught:
            self.as_a._liwan_set_self_grant_policy(version, 'sometimes')
        self.assertEqual((caught.exception.code, caught.exception.status), ('invalid', 422))

    def test_policy_change_is_audited_and_bumps_the_version(self):
        before = self.as_a._liwan_access_policy()
        after = self.as_a._liwan_set_self_grant_policy(before['version'], 'allowed')
        self.assertEqual(after['self_grant'], 'allowed')
        self.assertNotEqual(after['version'], before['version'])
        audit = self.env['liwan.access.audit'].search([('action', '=', 'access.policy_changed')])
        self.assertEqual(len(audit), 1)
        self.assertEqual((audit.target_type, audit.target_id, audit.actor_id), ('company', self.company.id, self.admin_a))
        self.assertEqual((audit.before, audit.after), ({'self_grant': 'restricted'}, {'self_grant': 'allowed'}))
        with self.assertRaises(LiwanAccessRule):
            self.as_a._liwan_set_self_grant_policy(before['version'], 'restricted')

    def test_a_branch_follows_its_root_company_policy(self):
        branch = self.env['res.company'].create({'name': 'Policy branch', 'parent_id': self.company.id})
        branch_admin = new_test_user(self.env, login='self_grant_branch_reader', groups='base.group_user',
                                     company_id=branch.id, company_ids=[Command.set([self.company.id, branch.id])])
        self.service._liwan_replace_assignments(branch_admin, [{'role_id': self.system_role.id, 'company_id': branch.id}])
        from_branch = self.service.with_user(branch_admin).with_company(branch)
        self.assertEqual(from_branch._liwan_access_policy(), self.as_a._liwan_access_policy())
        self.allow_self_grant()
        self.assertEqual((self.company.liwan_self_grant_policy, branch.liwan_self_grant_policy), ('allowed', 'restricted'))
        self.assertEqual(from_branch._liwan_access_policy()['self_grant'], 'allowed')

    def test_a_branch_administrator_cannot_change_the_root_company_policy(self):
        branch = self.env['res.company'].create({'name': 'Branch only', 'parent_id': self.company.id})
        branch_admin = new_test_user(self.env, login='self_grant_branch_admin', groups='base.group_user',
                                     company_id=branch.id, company_ids=[Command.set([self.company.id, branch.id])])
        self.service._liwan_replace_assignments(branch_admin, [{'role_id': self.system_role.id, 'company_id': branch.id}])
        from_branch = self.service.with_user(branch_admin).with_company(branch)
        version = self.as_a._liwan_access_policy()['version']
        with self.assertRaises(AccessError):
            from_branch._liwan_set_self_grant_policy(version, 'allowed')
        self.assertEqual(self.company.liwan_self_grant_policy, 'restricted')

    def test_the_policy_field_is_not_writable_outside_the_operation(self):
        with self.assertRaises(AccessError):
            self.company.with_user(self.admin_a).write({'liwan_self_grant_policy': 'allowed'})
