# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import READ_CAP, AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase


@tagged('post_install', '-at_install', 'liwan')
class TestAiMemory(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self.granted = {READ_CAP}
        self._grant_ai_use(self.employee)
        self.manager = new_test_user(
            self.env, login='ai_memory_admin', password='ai_memory_admin_pass_123', name='Mona',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings(self.manager)

    def _outbox(self):
        self.env.cr.execute('SELECT kind, user_ref FROM liwan_ai.ai_outbox ORDER BY id')
        return self.env.cr.fetchall()

    def test_switching_an_agent_memory_off_reaches_the_catalog(self):
        self.authenticate('ai_memory_admin', 'ai_memory_admin_pass_123')
        saved = self.api('PATCH', '/api/v1/ai/agents/probe', {'revision': 0, 'memory': False}).json()
        self.assertFalse(saved['items'][0]['memory'])
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual([agent['memory'] for agent in self.api('GET', '/api/v1/ai/tools').json()['agents']], [False])

    def test_a_deactivation_and_a_reactivation_are_reported_when_the_ai_schema_exists(self):
        user = new_test_user(self.env, login='ai_leaver', name='Leaver')
        user.active = False  # no AI schema: nothing is written and nothing fails
        user.active = True
        self.env.cr.execute(
            'CREATE SCHEMA liwan_ai;'
            " CREATE TABLE liwan_ai.ai_outbox (id BIGSERIAL PRIMARY KEY, kind TEXT NOT NULL, user_ref TEXT NOT NULL,"
            ' created_at TIMESTAMPTZ NOT NULL DEFAULT now())',
        )
        user.active = False
        user.write({'active': False})  # no change, no second event
        user.active = True
        self.assertEqual(self._outbox(), [('user_deactivated', str(user.id)), ('user_reactivated', str(user.id))])
        gone = new_test_user(self.env, login='ai_gone', name='Gone')
        gone_id = gone.id
        gone.unlink()
        self.assertEqual(self._outbox()[-1], ('user_deactivated', str(gone_id)))

    def test_company_notes_are_reviewed_by_a_settings_manager_of_the_current_company(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', '/api/v1/ai/company-memory/authorize').status_code, 403)
        self.authenticate('ai_memory_admin', 'ai_memory_admin_pass_123')
        response = self.api('POST', '/api/v1/ai/company-memory/authorize')
        self.assertEqual(response.json(), {'company_id': self.env.company.id})
