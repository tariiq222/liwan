# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase

READ, PAYROLL = 'hr.employees.read', 'hr.payroll.read'


@tagged('post_install', '-at_install', 'webvue')
class TestHrBranchStrictness(WebVueHrCase):
    """«Stricter than the general policy» for HR and payroll: explicit delegation only."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.parent = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Strict HR branch', 'parent_id': cls.parent.id})
        cls.hr_role = cls.env.ref('webvue_hr.role_hr_manager')
        cls.payroll_role = cls.env.ref('webvue_hr.role_payroll_manager')
        cls.manager = new_test_user(
            cls.env, login='strict_hr_manager', password='strict_hr_manager_pw', groups='base.group_user',
            company_id=cls.parent.id, company_ids=[Command.set((cls.parent | cls.branch).ids)])
        # The branch policy itself is edited by an access administrator; its role is not inherited below.
        for role in (cls.hr_role, cls.payroll_role, cls.env.ref('webvue_core.role_system_admin')):
            cls.env['webvue.access.assignment'].create({
                'user_id': cls.manager.id, 'company_id': cls.parent.id, 'role_id': role.id})
        cls.service = cls.env['webvue.access.service'].with_user(cls.manager).with_context(
            allowed_company_ids=[cls.parent.id, cls.branch.id])
        policy = cls.service._webvue_branch_policy()
        cls.service._webvue_update_branch_policy(policy['version'], 'inherited', [
            {'id': cls.branch.id, 'inherit': True, 'role_ids': [cls.hr_role.id, cls.payroll_role.id]}])
        cls.employee_record = cls.env['hr.employee'].create({'name': 'Branch person', 'company_id': cls.branch.id})
        cls.attachment = cls.env['ir.attachment'].create({
            'name': 'Branch file', 'raw': b'branch contract', 'type': 'binary', 'res_model': 'hr.version',
            'res_id': cls.employee_record.version_id.id, 'company_id': cls.branch.id})

    def has(self, key):
        return self.service._webvue_has_capability(self.manager, key, company=self.branch)

    def branch_read_access(self):
        """Read, listing and attachment access of the branch record, as the list and file routes scope it."""
        version = self.employee_record.version_id.with_user(self.manager).with_context(
            allowed_company_ids=[self.parent.id, self.branch.id],
            webvue_capability_scope=(((READ,), 'all'),))
        file = self.attachment.with_env(version.env)
        return (version.has_access('read'), bool(version._filtered_access('read')), file.has_access('read'),
                self.branch.id in self.service._webvue_capability_company_ids((READ,)))

    def test_off_both_apps_inherit_into_the_branch(self):
        self.assertTrue(self.has(READ))
        self.assertTrue(self.has(PAYROLL))
        self.assertEqual(self.branch_read_access(), (True, True, True, True))

    def test_hr_scope_keeps_hr_out_but_payroll_still_inherits(self):
        self.service._webvue_set_branch_strict('hr', True)
        self.assertFalse(self.has(READ))
        self.assertTrue(self.has(PAYROLL), 'payroll has its own switch')
        self.assertEqual(self.branch_read_access(), (False, False, False, False))
        self.service._webvue_set_branch_strict('hr', False)
        self.assertEqual(self.branch_read_access(), (True, True, True, True))

    def test_payroll_scope_keeps_payroll_out_but_hr_still_inherits(self):
        self.service._webvue_set_branch_strict('payroll', True)
        self.assertFalse(self.has(PAYROLL))
        self.assertFalse(self.has('hr.payroll.config'))
        self.assertTrue(self.has(READ))
        self.assertEqual(self.branch_read_access(), (True, True, True, True))

    def test_explicit_delegation_opens_the_branch_despite_the_switch(self):
        self.service._webvue_set_branch_strict('hr', True)
        self.service._webvue_set_branch_strict('payroll', True)
        self.assertEqual(self.branch_read_access(), (False, False, False, False))
        self.env['webvue.access.assignment'].create({
            'user_id': self.manager.id, 'company_id': self.branch.id, 'role_id': self.hr_role.id})
        self.assertTrue(self.has(READ))
        self.assertFalse(self.has(PAYROLL), 'the delegation names HR only')

    def test_routes_read_and_write_the_switches_with_their_own_capability(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        for path in ('/api/v1/hr/branch-strictness', '/api/v1/hr/payroll/branch-strictness'):
            self.assertEqual(self.api('GET', path).status_code, 403, path)
            self.assertEqual(self.api('PATCH', path, json={'enabled': True}).status_code, 403, path)
        self.authenticate('strict_hr_manager', 'strict_hr_manager_pw')
        for scope, path in (('hr', '/api/v1/hr/branch-strictness'), ('payroll', '/api/v1/hr/payroll/branch-strictness')):
            self.assertEqual(self.api('GET', path).json(), {'scope': scope, 'enabled': False})
            self.assertEqual(self.api('PATCH', path, json={'enabled': True}).json(), {'scope': scope, 'enabled': True})
            self.assertEqual(self.api('GET', path).json(), {'scope': scope, 'enabled': True})
            self.assertEqual(self.api('PATCH', path, json={'enabled': 'yes'}).status_code, 422)
            self.assertEqual(self.api('PATCH', path, json={'enabled': True, 'scope': 'x'}).status_code, 422)
            self.assertEqual(self.api('PATCH', path, json={}).status_code, 422)
            self.assertEqual(self.api('PATCH', path, json={'enabled': False}).json(), {'scope': scope, 'enabled': False})

    def test_an_application_manager_without_access_roles_switches_and_is_audited(self):
        owner = new_test_user(
            self.env, login='strict_hr_only', password='strict_hr_only_pw', groups='base.group_user',
            company_id=self.parent.id, company_ids=[Command.set((self.parent | self.branch).ids)])
        for role in (self.hr_role, self.payroll_role):
            self.env['webvue.access.assignment'].create({
                'user_id': owner.id, 'company_id': self.parent.id, 'role_id': role.id})
        self.authenticate('strict_hr_only', 'strict_hr_only_pw')
        for scope, path in (('hr', '/api/v1/hr/branch-strictness'), ('payroll', '/api/v1/hr/payroll/branch-strictness')):
            res = self.api('PATCH', path, json={'enabled': True})
            self.assertEqual((res.status_code, res.json()), (200, {'scope': scope, 'enabled': True}), res.text)
        audit = self.env['webvue.access.audit'].sudo().search(
            [('action', '=', 'branch.policy_changed'), ('actor_id', '=', owner.id)])
        self.assertEqual(len(audit), 2)
