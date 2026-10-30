# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase

READ = 'finance.invoices.read'


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceBranchStrictness(WebVueApiCase):
    """«Stricter than the general policy» for finance: explicit delegation only."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Strict finance branch', 'parent_id': cls.parent.id})
        cls.role = cls.env.ref('webvue_finance.role_finance_manager')
        cls.manager = new_test_user(
            cls.env, login='strict_finance_manager', password='strict_finance_manager_pw', groups='base.group_user',
            company_id=cls.parent.id, company_ids=[Command.set((cls.parent | cls.branch).ids)])
        # The branch policy itself is edited by an access administrator; its role is not inherited below.
        for role in (cls.role, cls.env.ref('webvue_core.role_system_admin')):
            cls.env['webvue.access.assignment'].create({
                'user_id': cls.manager.id, 'company_id': cls.parent.id, 'role_id': role.id})
        cls.service = cls.env['webvue.access.service'].with_user(cls.manager).with_context(
            allowed_company_ids=[cls.parent.id, cls.branch.id])
        policy = cls.service._webvue_branch_policy()
        cls.service._webvue_update_branch_policy(policy['version'], 'inherited', [
            {'id': cls.branch.id, 'inherit': True, 'role_ids': [cls.role.id]}])

    def scoped_companies(self):
        """The companies a finance list, export or document route reads, as its capability gate scopes them."""
        return self.service._webvue_capability_company_ids((READ,))

    def test_off_the_branch_is_inherited(self):
        self.assertIn(self.branch.id, self.scoped_companies())

    def test_on_keeps_finance_out_of_the_branch_and_off_restores_it(self):
        self.service._webvue_set_branch_strict('finance', True)
        self.assertEqual(self.scoped_companies(), [self.parent.id])
        self.assertFalse(self.service._webvue_has_capability(self.manager, 'finance.setup.manage', company=self.branch))
        self.assertTrue(self.service._webvue_has_capability(self.manager, 'finance.setup.manage'))
        self.service._webvue_set_branch_strict('finance', False)
        self.assertIn(self.branch.id, self.scoped_companies())

    def test_explicit_delegation_opens_the_branch(self):
        self.service._webvue_set_branch_strict('finance', True)
        self.env['webvue.access.assignment'].create({
            'user_id': self.manager.id, 'company_id': self.branch.id, 'role_id': self.role.id})
        self.assertIn(self.branch.id, self.scoped_companies())

    def test_route_reads_and_writes_the_switch_with_its_own_capability(self):
        path = '/api/v1/finance/branch-strictness'
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', path).status_code, 403)
        self.assertEqual(self.api('PATCH', path, json={'enabled': True}).status_code, 403)
        self.authenticate('strict_finance_manager', 'strict_finance_manager_pw')
        self.assertEqual(self.api('GET', path).json(), {'scope': 'finance', 'enabled': False})
        self.assertEqual(self.api('PATCH', path, json={'enabled': True}).json(), {'scope': 'finance', 'enabled': True})
        self.assertEqual(self.api('PATCH', path, json={'enabled': 1}).status_code, 422)
        self.assertEqual(self.api('PATCH', path, json={'enabled': False}).json(), {'scope': 'finance', 'enabled': False})
