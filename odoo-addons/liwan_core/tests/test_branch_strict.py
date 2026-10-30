# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest import mock

from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

SCOPE = 'probe'
KEY = 'access.roles.read'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestBranchStrict(TransactionCase):
    """The core mechanism; each application registers its own scope definitions."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Strict branch', 'parent_id': cls.parent.id})
        cls.admin_role = cls.env.ref('liwan_core.role_system_admin')
        cls.user = new_test_user(
            cls.env, login='strict_parent_user', groups='base.group_user', company_id=cls.parent.id,
            company_ids=[Command.set((cls.parent | cls.branch).ids)])
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.user.id, 'company_id': cls.parent.id, 'role_id': cls.admin_role.id})
        cls.service = cls.env['liwan.access.service'].with_user(cls.user).with_context(
            allowed_company_ids=[cls.parent.id, cls.branch.id])

    def setUp(self):
        super().setUp()
        definitions = type(self.service)._liwan_branch_strict_definitions
        patcher = mock.patch.object(
            type(self.service), '_liwan_branch_strict_definitions',
            lambda model: {**definitions(model), SCOPE: ('access.roles.', ())})
        patcher.start()
        self.addCleanup(patcher.stop)
        policy = self.service._liwan_branch_policy()
        self.service._liwan_update_branch_policy(policy['version'], 'inherited', [
            {'id': self.branch.id, 'inherit': True, 'role_ids': [self.admin_role.id]}])

    def sees_branch(self):
        return self.service._liwan_has_capability(self.user, KEY, company=self.branch)

    def test_off_by_default_so_inheritance_is_unchanged(self):
        self.assertTrue(self.sees_branch())
        self.assertEqual(self.service._liwan_branch_policy()['strict_scopes'], [])

    def test_on_keeps_the_scope_out_of_inheritance_and_off_restores_it(self):
        state = self.service._liwan_set_branch_strict(SCOPE, True)
        self.assertEqual(state, {'scope': SCOPE, 'enabled': True})
        self.assertFalse(self.sees_branch())
        self.assertEqual(self.service._liwan_branch_policy()['strict_scopes'], [SCOPE])
        self.assertTrue(self.service._liwan_has_capability(self.user, KEY), 'the parent keeps its own grant')
        self.assertTrue(self.service._liwan_has_capability(self.user, 'settings.company.read', company=self.branch),
                        'other scopes keep inheriting')
        self.service._liwan_set_branch_strict(SCOPE, False)
        self.assertTrue(self.sees_branch())

    def test_explicit_delegation_still_opens_the_branch(self):
        self.service._liwan_set_branch_strict(SCOPE, True)
        self.assertFalse(self.sees_branch())
        assignment = self.env['liwan.access.assignment'].create({
            'user_id': self.user.id, 'company_id': self.branch.id, 'role_id': self.admin_role.id})
        self.assertTrue(self.sees_branch())
        assignment.unlink()
        self.assertFalse(self.sees_branch())

    def test_the_switch_is_a_protected_operation_that_bumps_the_policy_version_and_audits(self):
        before = self.service._liwan_branch_policy_version()
        self.service._liwan_set_branch_strict(SCOPE, True)
        self.assertNotEqual(before, self.service._liwan_branch_policy_version())
        self.service._liwan_set_branch_strict(SCOPE, True)
        self.assertEqual(self.env['liwan.access.branch.strict'].search_count([('scope', '=', SCOPE)]), 1)
        with self.assertRaises(AccessError):
            self.env['liwan.access.branch.strict'].with_user(self.user).create({
                'company_id': self.parent.id, 'scope': SCOPE})
        self.assertTrue(self.env['liwan.access.audit'].search([('action', '=', 'branch.policy_changed')]))

    def test_unknown_scope_and_non_boolean_values_are_rejected(self):
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            self.service._liwan_set_branch_strict('missing', True)
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            self.service._liwan_set_branch_strict(SCOPE, 'yes')
