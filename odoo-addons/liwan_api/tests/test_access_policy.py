# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from .common import LiwanApiCase

PROBE_KEY = 'probe_payroll.salaries.manage'


@tagged('post_install', '-at_install', 'liwan', 'liwan_access')
class TestAccessPolicyRoutes(LiwanApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.admin = new_test_user(cls.env, login='policy_api_admin', password='policy_api_pass_123', groups='base.group_user')
        cls.system_role = cls.env.ref('liwan_core.role_system_admin')
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.admin.id, 'role_id': cls.system_role.id, 'company_id': cls.company.id,
        })
        group = cls.env['res.groups'].create({'name': 'Policy route probe'})
        cls.env['ir.model.data'].create({
            'module': 'liwan_core', 'name': f'policy_probe_{group.id}', 'model': 'res.groups', 'res_id': group.id,
        })
        probe = cls.env['liwan.access.permission'].create({
            'key': PROBE_KEY, 'name_ar': PROBE_KEY, 'name_en': PROBE_KEY, 'domain': 'probe_payroll',
            'group_xmlid': f'liwan_core.policy_probe_{group.id}', 'custom_role_allowed': True,
            'resource': 'salaries', 'action': 'manage', 'description_ar': PROBE_KEY,
        })
        cls.elevating = cls.env['liwan.access.role']._liwan_access_create({
            'name_ar': 'دور رواتب للمسار', 'permission_ids': [Command.set(probe.ids)],
        })

    def test_policy_is_read_and_changed_with_a_current_version(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/admin/access/policy').status_code, 403)
        self.assertEqual(self.api('PATCH', '/api/v1/admin/access/policy', json={
            'self_grant': 'allowed', 'expected_version': 'x',
        }).status_code, 403)
        self.authenticate('policy_api_admin', 'policy_api_pass_123')
        state = self.api('GET', '/api/v1/admin/access/policy')
        self.assertEqual(state.status_code, 200, state.text)
        policy = state.json()
        self.assertEqual(set(policy), {'self_grant', 'version'})
        self.assertEqual(policy['self_grant'], 'restricted')
        payload = {'self_grant': 'allowed', 'expected_version': policy['version']}
        updated = self.api('PATCH', '/api/v1/admin/access/policy', json=payload)
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['self_grant'], 'allowed')
        self.assertNotEqual(updated.json()['version'], policy['version'])
        stale = self.api('PATCH', '/api/v1/admin/access/policy', json=payload)
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        self.assertEqual(stale.json()['details']['current_version'], updated.json()['version'])
        for body in (
            {'self_grant': 'maybe', 'expected_version': updated.json()['version']},
            {'self_grant': 'restricted'},
            {'self_grant': 'restricted', 'expected_version': updated.json()['version'], 'extra': 1},
        ):
            with self.subTest(body=body):
                response = self.api('PATCH', '/api/v1/admin/access/policy', json=body)
                self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), response.text)
        self.assertTrue(self.env['liwan.access.audit'].search([('action', '=', 'access.policy_changed')]))

    def test_a_member_of_a_branch_only_reads_the_root_policy_and_cannot_change_it(self):
        branch = self.env['res.company'].create({'name': 'Policy route branch', 'parent_id': self.company.id})
        branch_admin = new_test_user(self.env, login='policy_api_branch', password='policy_api_branch_123',
                                     groups='base.group_user', company_id=branch.id, company_ids=[Command.set([branch.id])])
        self.env['liwan.access.service']._liwan_replace_assignments(
            branch_admin, [{'role_id': self.system_role.id, 'company_id': branch.id}],
        )
        self.authenticate('policy_api_admin', 'policy_api_pass_123')
        root = self.api('GET', '/api/v1/admin/access/policy').json()
        self.authenticate('policy_api_branch', 'policy_api_branch_123')
        state = self.api('GET', '/api/v1/admin/access/policy')
        self.assertEqual(state.status_code, 200, state.text)
        self.assertEqual(state.json(), root)
        refused = self.api('PATCH', '/api/v1/admin/access/policy', json={
            'self_grant': 'allowed', 'expected_version': root['version'],
        })
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(self.company.liwan_self_grant_policy, 'restricted')

    def test_restricted_self_grant_answers_403_with_details(self):
        self.authenticate('policy_api_admin', 'policy_api_pass_123')
        user = self.env['res.users'].browse(self.admin.id)
        service = self.env['liwan.access.service']
        response = self.api('PATCH', f'/api/v1/admin/users/{self.admin.id}/access', json={
            'expected_version': service._liwan_user_version(user),
            'assignments': [
                {'role_id': self.system_role.id, 'scope': {'kind': 'company', 'id': self.company.id}},
                {'role_id': self.elevating.id, 'scope': {'kind': 'company', 'id': self.company.id}},
            ],
        })
        self.assertEqual(response.status_code, 403, response.text)
        body = response.json()
        self.assertEqual(body['code'], 'self_grant_restricted')
        self.assertEqual(body['details'], {'roles': [self.elevating.key], 'permissions': [PROBE_KEY]})
        self.assertNotIn(PROBE_KEY, service._liwan_capability_keys(self.admin))
