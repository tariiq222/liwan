# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_ai.tests.common import READ_CAP, AiProbe
from odoo.addons.nasq_ai.tests.test_ai_audit import MESSAGE
from odoo.addons.nasq_api.tests.common import NasqApiCase


@tagged('post_install', '-at_install', 'nasq')
class TestAiUseCapability(AiProbe, NasqApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.granted = {READ_CAP}
        role = self.env['nasq.access.role'].create({
            'name_ar': 'قارئ الأدوار',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([('key', '=', 'access.roles.read')]).ids)],
        })
        self.no_ai = new_test_user(self.env, login='ai_no_use', password='ai_no_use_pass_123', name='Noor', groups='base.group_user')
        self.env['nasq.access.assignment'].create({
            'user_id': self.no_ai.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })

    def test_employee_holds_ai_use(self):
        access = self.env['nasq.access.service']
        self.assertIn('ai.use', access._nasq_capability_keys(self.employee))
        self.assertIn('ai.use', access._nasq_identity(self.employee)['capabilities'])

    def test_employee_role_is_granted_ai_use(self):
        role = self.env.ref('nasq_core.role_employee')
        self.assertIn('ai.use', role.permission_ids.mapped('key'))

    def test_role_without_ai_use_does_not_hold_it(self):
        self.assertNotIn('ai.use', self.env['nasq.access.service']._nasq_capability_keys(self.no_ai))

    def test_routes_answer_forbidden_without_ai_use(self):
        self.authenticate('ai_no_use', 'ai_no_use_pass_123')
        for method, path, body in (('GET', '/api/v1/ai/tools', None), ('POST', '/api/v1/ai/audit', MESSAGE)):
            response = self.api(method, path, body)
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.json()['code'], 'forbidden', path)

    def test_audit_create_requires_ai_use(self):
        with self.assertRaises(AccessError):
            self.env['nasq.ai.audit'].with_user(self.no_ai).create(MESSAGE)
        self.assertTrue(self.env['nasq.ai.audit'].with_user(self.employee).create(MESSAGE))
