# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timezone

from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_warn_01', 'kind': 'message', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}


@tagged('post_install', '-at_install', 'liwan')
class TestAiLimitWarning(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._install_probe()
        self._grant_ai_use(self.employee)
        self.manager = new_test_user(
            self.env, login='ai_warn_admin', password='ai_warn_admin_pass_123', name='Huda',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings(self.manager)
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _set_feature(self, key, value):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), key: value},
        })

    def _bell(self, user):
        return self.env['liwan.notify.service'].with_user(user)._liwan_list(50)['items']

    def test_managers_are_told_once_a_month_at_eighty_percent(self):
        self._set_feature('ai.messages.monthly', 5)
        for index in range(3):
            self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'conversation_id': f'r_warn_{index}'})
        self.assertEqual(self._bell(self.manager), [])
        self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'conversation_id': 'r_warn_4'})
        items = self._bell(self.manager)
        self.assertEqual([item['kind'] for item in items], ['ai.limit_warning'])
        self.assertIn('80%', items[0]['title'])
        self.api('POST', '/api/v1/ai/audit', {**MESSAGE, 'conversation_id': 'r_warn_5'})
        self.assertEqual(len(self._bell(self.manager)), 1)

    def test_an_ordinary_user_never_sees_the_warning(self):
        self._set_feature('ai.messages.monthly', 1)
        self.api('POST', '/api/v1/ai/audit', MESSAGE)
        self.assertEqual(self._bell(self.employee), [])
        self.assertEqual(len(self._bell(self.manager)), 1)

    def test_platform_tokens_warn_when_the_crossing_usage_is_recorded(self):
        self._set_feature('ai.tokens.monthly', 100)
        usage = {
            'conversation_id': 'r_warn', 'kind': 'plan', 'billing': 'platform', 'provider': 'acme-ai', 'model': 'acme-1',
            'outcome': 'ok', 'input_tokens': 90, 'output_tokens': 30, 'called_at': self._now(),
        }
        self.assertEqual(self.api('POST', '/api/v1/ai/usage', {'items': [usage]}).status_code, 200)
        items = self._bell(self.manager)
        self.assertEqual(len(items), 1)
        self.assertIn('tokens', items[0]['title'])

    def test_tenant_key_usage_never_warns_about_platform_tokens(self):
        self._set_feature('ai.tokens.monthly', 100)
        usage = {
            'conversation_id': 'r_warn', 'kind': 'plan', 'billing': 'tenant_key', 'provider': 'acme-ai', 'model': 'acme-1',
            'outcome': 'ok', 'input_tokens': 90, 'output_tokens': 30, 'called_at': self._now(),
        }
        self.api('POST', '/api/v1/ai/usage', {'items': [usage]})
        self.assertEqual(self._bell(self.manager), [])

    def _now(self):
        return datetime.now(timezone.utc).isoformat()
