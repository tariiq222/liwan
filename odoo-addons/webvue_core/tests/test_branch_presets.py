# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import ValidationError
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

PROBE = 'access.roles.read'


@tagged('post_install', '-at_install', 'webvue', 'webvue_access')
class TestBranchPresets(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Preset branch', 'parent_id': cls.parent.id})
        cls.admin_role = cls.env.ref('webvue_core.role_system_admin')
        cls.employee_role = cls.env.ref('webvue_core.role_employee')
        cls.parent_user = new_test_user(
            cls.env, login='preset_parent_user', groups='base.group_user', company_id=cls.parent.id,
            company_ids=[Command.set((cls.parent | cls.branch).ids)])
        cls.branch_user = new_test_user(
            cls.env, login='preset_branch_user', groups='base.group_user', company_id=cls.branch.id,
            company_ids=[Command.set(cls.branch.ids)])
        Assignment = cls.env['webvue.access.assignment']
        Assignment.create({'user_id': cls.parent_user.id, 'company_id': cls.parent.id, 'role_id': cls.admin_role.id})
        Assignment.create({'user_id': cls.branch_user.id, 'company_id': cls.branch.id, 'role_id': cls.admin_role.id})
        cls.service = cls.env['webvue.access.service'].with_user(cls.parent_user).with_context(
            allowed_company_ids=[cls.parent.id, cls.branch.id])
        cls.branch_service = cls.env['webvue.access.service'].with_user(cls.branch_user).with_company(
            cls.branch).with_context(allowed_company_ids=[cls.branch.id])

    def apply(self, preset):
        policy = self.service._webvue_branch_policy()
        return self.service._webvue_apply_branch_preset(policy['version'], preset)

    def parent_sees_branch(self):
        return self.service._webvue_has_capability(self.parent_user, PROBE, company=self.branch)

    def branch_user_has_own(self):
        return self.branch_service._webvue_has_capability(self.branch_user, PROBE, company=self.branch)

    def branch_user_sees_parent(self):
        return self.branch_service._webvue_has_capability(self.branch_user, PROBE, company=self.parent)

    def delegate(self):
        return self.env['webvue.access.assignment'].create({
            'user_id': self.parent_user.id, 'company_id': self.branch.id, 'role_id': self.admin_role.id})

    def test_new_tenant_reads_independent_with_branches(self):
        policy = self.service._webvue_branch_policy()
        self.assertEqual((policy['mode'], policy['preset']), ('delegated', 'independent_branches'))

    def test_central_branches_inherit_management_roles_into_every_branch(self):
        policy = self.apply('central_branches')
        self.assertEqual((policy['mode'], policy['preset']), ('inherited', 'central_branches'))
        self.assertTrue(self.parent_sees_branch())
        self.assertNotIn(self.employee_role.id, policy['branches'][0]['role_ids'])
        self.assertTrue(self.branch_user_has_own())
        self.assertFalse(self.branch_user_sees_parent(), 'branch staff stay members of their branch only')

    def test_independent_branches_need_an_explicit_delegation(self):
        self.apply('central_branches')
        policy = self.apply('independent_branches')
        self.assertEqual((policy['mode'], policy['preset']), ('delegated', 'independent_branches'))
        self.assertTrue(all(not b['inherit'] and not b['role_ids'] for b in policy['branches']))
        self.assertFalse(self.parent_sees_branch())
        self.delegate()
        self.assertTrue(self.parent_sees_branch())
        self.assertTrue(self.branch_user_has_own())
        self.assertFalse(self.branch_user_sees_parent())

    def test_group_of_companies_isolates_parent_from_branch(self):
        policy = self.apply('group_of_companies')
        self.assertEqual((policy['mode'], policy['preset']), ('isolated', 'group_of_companies'))
        self.assertFalse(self.parent_sees_branch())
        self.delegate()
        self.assertFalse(self.parent_sees_branch(), 'isolated mode ignores a parent-side delegation')
        self.assertTrue(self.branch_user_has_own())
        self.assertFalse(self.branch_user_sees_parent())

    def test_single_company_requires_no_branches(self):
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            self.apply('single_company')
        derive = self.service._webvue_derive_branch_preset
        self.assertEqual(derive('delegated', []), 'single_company')
        self.assertEqual(derive('isolated', []), 'group_of_companies')
        self.assertEqual(derive('inherited', []), 'central_branches')

    def test_manual_edit_reads_custom_and_nothing_is_stored_twice(self):
        policy = self.apply('central_branches')
        self.assertNotIn('webvue_branch_preset', self.env['res.company']._fields)
        edited = self.service._webvue_update_branch_policy(policy['version'], 'inherited', [
            {'id': self.branch.id, 'inherit': True, 'role_ids': policy['branches'][0]['role_ids'][:-1]},
        ])
        self.assertEqual(edited['preset'], 'custom')
        self.assertEqual(self.apply('central_branches')['preset'], 'central_branches')
        policy = self.service._webvue_branch_policy()
        for mode, expected in (('delegated', 'custom'), ('isolated', 'custom')):
            policy = self.service._webvue_update_branch_policy(policy['version'], mode, [
                {'id': self.branch.id, 'inherit': True, 'role_ids': []}])
            self.assertEqual(policy['preset'], expected)

    def test_unknown_preset_is_rejected_and_audited_change_is_logged(self):
        with self.assertRaisesRegex(ValidationError, 'invalid'):
            self.apply('custom')
        self.apply('group_of_companies')
        self.assertTrue(self.env['webvue.access.audit'].search([('action', '=', 'branch.policy_changed')]))
