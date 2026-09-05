# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestSettings(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='api_admin', password='api_admin_pass_123',
            groups='nasq_core.group_pmo_manager',
        )

    def setUp(self):
        super().setUp()
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('nasq_pmo.project_creators', 'managers')
        params.set_param('nasq_pmo.default_stages', False)

    def test_employee_is_forbidden_and_legacy_pmo_manager_is_allowed(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 403)
        self.assertEqual(self.api(
            'PATCH', '/api/v1/settings/projects', {'project_creators': 'employees'},
        ).status_code, 403)

        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/settings/projects').status_code, 200)

    def test_get_and_patch(self):
        self.authenticate('api_admin', 'api_admin_pass_123')
        body = self.api('GET', '/api/v1/settings/projects').json()
        self.assertEqual(set(body), {'project_creators', 'default_stages'})
        self.assertEqual(body['project_creators'], 'managers')
        self.assertEqual(len(body['default_stages']), 4)
        res = self.api('PATCH', '/api/v1/settings/projects', {'project_creators': 'employees', 'default_stages': [{'name': 'Only', 'fold': False}]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'project_creators': 'employees', 'default_stages': [{'name': 'Only', 'fold': False}]})
        res = self.api('PATCH', '/api/v1/settings/projects', {'default_stages': []})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'default_stages'))
        res = self.api('PATCH', '/api/v1/settings/projects', {'project_creators': 'x'})
        self.assertEqual((res.status_code, res.json()['field']), (422, 'project_creators'))
        self.assertEqual(self.api('PATCH', '/api/v1/settings/projects', {'other': 1}).status_code, 422)
        # the new policy is live: the employee may now create
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertTrue(self.api('GET', '/api/v1/projects').json()['can_create'])
