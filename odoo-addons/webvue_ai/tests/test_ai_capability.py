# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_ai.tests.common import READ_CAP, AiProbe
from odoo.addons.webvue_ai.tests.test_ai_audit import MESSAGE, READ
from odoo.addons.webvue_api.tests.common import WebVueApiCase


@tagged('post_install', '-at_install', 'webvue')
class TestAiUseCapability(AiProbe, WebVueApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.granted = {READ_CAP}
        role = self.env['webvue.access.role'].create({
            'name_ar': 'قارئ الأدوار',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['webvue.access.permission'].search([('key', '=', 'access.roles.read')]).ids)],
        })
        self.no_ai = new_test_user(self.env, login='ai_no_use', password='ai_no_use_pass_123', name='Noor', groups='base.group_user')
        self.env['webvue.access.assignment'].create({
            'user_id': self.no_ai.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })

    def test_employee_holds_ai_use(self):
        access = self.env['webvue.access.service']
        self.assertIn('ai.use', access._webvue_capability_keys(self.employee))
        self.assertIn('ai.use', access._webvue_identity(self.employee)['capabilities'])

    def test_employee_role_is_granted_ai_use(self):
        role = self.env.ref('webvue_core.role_employee')
        self.assertIn('ai.use', role.permission_ids.mapped('key'))

    def test_role_without_ai_use_does_not_hold_it(self):
        self.assertNotIn('ai.use', self.env['webvue.access.service']._webvue_capability_keys(self.no_ai))

    def test_routes_answer_forbidden_without_ai_use(self):
        self.authenticate('ai_no_use', 'ai_no_use_pass_123')
        for method, path, body in (('GET', '/api/v1/ai/tools', None), ('POST', '/api/v1/ai/audit', MESSAGE)):
            response = self.api(method, path, body)
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.json()['code'], 'forbidden', path)

    def test_audit_create_requires_ai_use(self):
        with self.assertRaises(AccessError):
            self.env['webvue.ai.audit'].with_user(self.no_ai).create(MESSAGE)
        self.assertTrue(self.env['webvue.ai.audit'].with_user(self.employee).create(MESSAGE))

    def test_a_custom_role_granting_only_ai_use_works_end_to_end(self):
        permission = self.env['webvue.access.permission'].search([('key', '=', 'ai.use')])
        role = self.env['webvue.access.role'].create({
            'name_ar': 'مستخدم المساعد', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, permission.ids)],
        })
        user = new_test_user(self.env, login='ai_only', password='ai_only_pass_123', name='Aya', groups='base.group_user')
        self.env['webvue.access.assignment'].create({
            'user_id': user.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        self.assertFalse(user.has_group('webvue_core.group_employee'))
        self.assertTrue(user.has_group('webvue_ai.group_cap_ai_use'))
        self.authenticate('ai_only', 'ai_only_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/ai/tools').status_code, 200)
        first = self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(first.status_code, 200, first.content)
        self.env['webvue.ai.audit'].with_user(self.employee).create(READ)
        rows = self.env['webvue.ai.audit'].with_user(user).search([])
        self.assertEqual(rows.mapped('user_id'), user)
        self.assertEqual(rows.mapped('kind'), ['message'])
