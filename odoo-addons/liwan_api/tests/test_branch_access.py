# Part of Odoo. See LICENSE file for full copyright and licensing details.
from types import SimpleNamespace
from unittest import mock

from odoo import api
from odoo.fields import Command
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_api.controllers import common
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    require_capabilities,
    requires_capability,
)
from odoo.addons.liwan_api.tests.common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan')
class TestBranchAccessApi(LiwanApiCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'API shared branch', 'parent_id': cls.company.id})
        cls.foreign = cls.env['res.company'].create({'name': 'API unrelated company'})
        cls.admin = new_test_user(cls.env, login='branch_api_admin', password='branch_api_password',
                                  groups='base.group_user', company_id=cls.company.id,
                                  company_ids=[Command.set((cls.company | cls.branch | cls.foreign).ids)])
        cls.employee.company_ids = [Command.link(cls.branch.id)]
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.admin.id, 'role_id': cls.env.ref('liwan_core.role_system_admin').id,
            'company_id': cls.company.id,
        })

    def test_settings_policy_concurrency_authorization_and_audit(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/admin/access/branches').status_code, 403)
        self.authenticate('branch_api_admin', 'branch_api_password')
        state = self.api('GET', '/api/v1/admin/access/branches')
        self.assertEqual(state.status_code, 200, state.text)
        policy = state.json()
        self.assertEqual([branch['id'] for branch in policy['branches']], [self.branch.id])
        self.assertTrue(all(role['company_id'] is None for role in policy['roles']))
        payload = {'expected_version': policy['version'], 'mode': 'isolated', 'branches': []}
        updated = self.api('PATCH', '/api/v1/admin/access/branches', json=payload)
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(self.api('PATCH', '/api/v1/admin/access/branches', json=payload).status_code, 409)
        foreign = self.api('PATCH', '/api/v1/admin/access/branches', json={
            'expected_version': updated.json()['version'], 'mode': 'inherited',
            'branches': [{'id': self.foreign.id, 'inherit': True, 'role_ids': []}],
        })
        self.assertEqual(foreign.status_code, 422, foreign.text)
        self.assertTrue(self.env['liwan.access.audit'].search([('action', '=', 'branch.policy_changed')]))

    def test_preset_is_read_and_applied_through_the_protected_operation(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('PATCH', '/api/v1/admin/access/branches/preset',
                                  json={'expected_version': 'x', 'preset': 'central_branches'}).status_code, 403)
        self.authenticate('branch_api_admin', 'branch_api_password')
        path = '/api/v1/admin/access/branches/preset'
        policy = self.api('GET', '/api/v1/admin/access/branches').json()
        self.assertEqual(policy['preset'], 'independent_branches')
        applied = self.api('PATCH', path, json={'expected_version': policy['version'], 'preset': 'central_branches'})
        self.assertEqual(applied.status_code, 200, applied.text)
        self.assertEqual((applied.json()['mode'], applied.json()['preset']), ('inherited', 'central_branches'))
        self.assertEqual(self.api('PATCH', path, json={'expected_version': policy['version'],
                                                      'preset': 'group_of_companies'}).status_code, 409)
        version = applied.json()['version']
        for bad in ({'preset': []}, {'preset': {}}, {'preset': 'custom'}, {'preset': 'single_company'}, {'preset': 'central_branches', 'mode': 'isolated'}):
            self.assertEqual(self.api('PATCH', path, json={'expected_version': version, **bad}).status_code, 422)

    def test_user_delegation_roundtrip_and_membership_fence(self):
        self.authenticate('branch_api_admin', 'branch_api_password')
        path = f'/api/v1/admin/users/{self.employee.id}/branches'
        state = self.api('GET', path)
        self.assertEqual(state.status_code, 200, state.text)
        self.assertEqual([branch['id'] for branch in state.json()['branches']], [self.branch.id])
        role_id = self.env.ref('liwan_core.role_employee').id
        updated = self.api('PATCH', path, json={'expected_version': state.json()['version'],
                                               'branches': [{'id': self.branch.id, 'role_ids': [role_id]}]})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['branches'][0]['role_ids'], [role_id])
        self.assertEqual(self.api('PATCH', path, json={'expected_version': updated.json()['version'],
                                                      'branches': [{'id': self.foreign.id, 'role_ids': [role_id]}]}).status_code, 422)


@tagged('post_install', '-at_install', 'liwan')
class TestBranchGateScope(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.branch = cls.env['res.company'].create({'name': 'Scope branch', 'parent_id': cls.company.id})
        cls.user = new_test_user(cls.env, login='branch_gate_actor', groups='base.group_user',
                                 company_ids=[Command.set((cls.company | cls.branch).ids)])
        # Separate groups: the user has one capability in the parent and the other in the branch.
        for company, role in ((cls.company, cls.env.ref('liwan_core.role_system_admin')),
                              (cls.branch, cls.env.ref('liwan_core.role_employee'))):
            cls.env['liwan.access.assignment'].create({'user_id': cls.user.id, 'company_id': company.id, 'role_id': role.id})

    def test_all_and_any_do_not_combine_company_capabilities(self):
        user = new_test_user(self.env, login='branch_split_gate', groups='base.group_user',
                             company_ids=[Command.set((self.company | self.branch).ids)])
        for index, (company, key) in enumerate(((self.company, 'settings.company.read'),
                                               (self.branch, 'access.roles.read'))):
            permission = self.env['liwan.access.permission'].search([('key', '=', key)])
            role = self.env['liwan.access.role'].create({
                'key': f'gate_split_{index}', 'type': 'built_in', 'name_ar': key,
                'permission_ids': [Command.set(permission.ids)],
            })
            self.env['liwan.access.assignment'].create({'user_id': user.id, 'company_id': company.id, 'role_id': role.id})
        req = self.request()
        req.env = req.env(user=user)
        with mock.patch.object(common, 'request', req):
            with self.assertRaises(ApiError):
                require_capabilities('settings.company.read', 'access.roles.read', match='all')
        req = self.request()
        req.env = req.env(user=user)
        with mock.patch.object(common, 'request', req):
            require_capabilities('settings.company.read', 'access.roles.read', match='any')
            self.assertEqual(set(req.env['liwan.access.service']._liwan_scoped_company_ids()),
                             {self.company.id, self.branch.id})
            # The branch's access-role capability grants no native partner ACL.
            partner = self.env['res.partner'].create({'name': 'Unrelated app record', 'company_id': self.branch.id})
            self.assertFalse(partner.with_env(req.env).has_access('read'))
            require_capabilities('settings.company.read')
            self.assertEqual(req.env['liwan.access.service']._liwan_scoped_company_ids(), [self.company.id])
        req = self.request()
        req.env = req.env(user=user)
        with mock.patch.object(common, 'request', req):
            require_capabilities('access.roles.read')
            self.assertEqual(req.env['liwan.access.service']._liwan_scoped_company_ids(), [self.branch.id])

    def request(self):
        request = SimpleNamespace(env=api.Environment(self.env.cr, self.user.id, {'allowed_company_ids': [self.company.id]}))

        def update_context(**values):
            request.env = request.env(context={**request.env.context, **values})
        request.update_context = update_context
        return request

    def test_imperative_and_decorator_have_identical_scopes(self):
        req = self.request()
        with mock.patch.object(common, 'request', req):
            require_capabilities('settings.company.read')
            imperative = req.env['liwan.access.service']._liwan_scoped_company_ids()
        req = self.request()

        @requires_capability('settings.company.read')
        def handler():
            return req.env['liwan.access.service']._liwan_scoped_company_ids()
        with mock.patch.object(common, 'request', req):
            self.assertEqual(handler(), imperative)
            self.assertEqual(handler(), [self.company.id])
            require_capabilities('settings.company.read', 'access.roles.read', match='any')
            self.assertEqual(req.env['liwan.access.service']._liwan_scoped_company_ids(), [self.company.id])

    def test_undeclared_pin_ignores_client_company_injection(self):
        req = self.request()
        req.update_context(allowed_company_ids=[self.branch.id], liwan_pinned_company_ids=[self.branch.id],
                           liwan_capability_scope=((('settings.company.read',), 'any'),))
        with mock.patch.object(common, 'request', req):
            common._pin_current_company()
            self.assertEqual(req.env.companies.ids, [self.company.id])
            self.assertEqual(req.env['liwan.access.service']._liwan_pinned_company_ids(), [self.company.id])

    def test_sequential_gate_cannot_widen_an_existing_operation(self):
        req = self.request()
        with mock.patch.object(common, 'request', req):
            require_capabilities('settings.company.read')
            with self.assertRaises(ApiError):
                require_capabilities('unknown.read', match='any')
            self.assertEqual(req.env['liwan.access.service']._liwan_scoped_company_ids(), [])

    def test_contextual_read_scope_preserves_home_and_requires_branch_operation(self):
        user = new_test_user(self.env, login='contextual_branch_actor', groups='base.group_user',
                             company_id=self.company.id,
                             company_ids=[Command.set((self.company | self.branch).ids)])
        permission = self.env['liwan.access.permission'].search([('key', '=', 'settings.company.read')])
        role = self.env['liwan.access.role'].create({
            'key': 'contextual_read_probe', 'type': 'built_in', 'name_ar': 'probe',
            'permission_ids': [Command.set(permission.ids)],
        })
        self.env['ir.model.access'].create({
            'name': 'contextual native writer', 'model_id': self.env['ir.model']._get_id('res.partner'),
            'group_id': self.env.ref(permission.group_xmlid).id, 'perm_read': True, 'perm_write': True,
        })
        home, branch = self.env['res.partner'].create([
            {'name': 'Contextual home', 'company_id': self.company.id},
            {'name': 'Contextual branch', 'company_id': self.branch.id},
        ])
        req = self.request()
        req.env = req.env(user=user)
        req.httprequest = SimpleNamespace(method='GET')
        with mock.patch.object(common, 'request', req):
            common.declare_read_capability_scope('settings.company.read')
            self.assertFalse(req.env['liwan.access.service']._liwan_has_capability(user, 'settings.company.read'))
            self.assertTrue(home.with_env(req.env).has_access('read'), 'contextual home baseline remains')
            self.assertFalse(branch.with_env(req.env).has_access('read'), 'membership alone grants nothing')
            assignment = self.env['liwan.access.assignment'].create({
                'user_id': user.id, 'company_id': self.branch.id, 'role_id': role.id,
            })
            # Re-pin as a real new request would: the earlier membership-only scope never widens itself.
            common._pin_current_company()
            common.declare_read_capability_scope('settings.company.read')
            self.assertTrue(branch.with_env(req.env).has_access('read'))
            self.assertFalse(branch.with_env(req.env).has_access('write'), 'read declaration cannot lend native writer ACL')
            self.env['ir.rule'].create({
                'name': 'private contextual probe', 'model_id': self.env['ir.model']._get_id('res.partner'),
                'domain_force': repr([('id', '!=', branch.id)]),
            })
            self.assertFalse(branch.with_env(req.env).has_access('read'), 'downstream private record rule still applies')
            assignment.unlink()
            self.assertNotIn(self.branch.id, req.env['liwan.access.service']._liwan_scoped_company_ids())

    def test_contextual_read_scope_intersects_prior_gates_and_resets(self):
        req = self.request()
        req.httprequest = SimpleNamespace(method='GET')
        with mock.patch.object(common, 'request', req):
            require_capabilities('access.roles.read')
            common.declare_read_capability_scope('settings.company.read', 'access.roles.read', match='any')
            self.assertEqual(req.env['liwan.access.service']._liwan_scoped_company_ids(), [self.company.id])
            with self.assertRaises(ValueError):
                common.declare_read_capability_scope('unknown.read')
            req.httprequest.method = 'POST'
            with self.assertRaises(ValueError):
                common.declare_read_capability_scope('settings.company.read')
            common._pin_current_company()
            self.assertFalse(req.env.context.get('liwan_capability_scope'))
            self.assertEqual(req.env.companies.ids, [self.company.id])
