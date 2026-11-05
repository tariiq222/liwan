# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.fields import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_ai.tests.common import AiProbe
from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

MESSAGE = {
    'conversation_id': 'r_setup_01', 'kind': 'setup', 'tool_name': None, 'input': None,
    'result': 'ok', 'http_status': None, 'draft': None, 'approved': None, 'attested': False,
}


@tagged('post_install', '-at_install', 'liwan')
class TestAiSettingRegistry(AiProbe, LiwanApiCase):

    def _rejected(self, settings, fragment):
        self.patch(type(self.env['liwan.ai.setting.registry']), '_liwan_ai_setting_definitions', lambda model: settings)
        with self.assertRaises(ValidationError) as caught:
            self.env['liwan.ai.setting.registry']._liwan_ai_setting_map()
        self.assertIn(fragment, str(caught.exception))

    def test_a_declaration_must_match_its_settings_field(self):
        base = dict(self.env['liwan.ai.setting.registry']._liwan_ai_setting_map()['ai.external_send'])
        self._rejected(({**base, 'options': ['draft_only', 'shout']},), 'options')
        self._rejected(({**base, 'type': 'integer', 'min': 0, 'max': 1},), 'is not a integer field')
        self._rejected(({**base, 'field': 'nope'},), 'is not a selection field')
        self._rejected(({**base, 'key': 'crm.external_send'},), 'prefix must match owner')
        self._rejected(({**base, 'scope': 'user'},), 'scope')
        self._rejected((base, base), 'duplicate')


@tagged('post_install', '-at_install', 'liwan')
class TestAiSetupAgent(AiProbe, LiwanApiCase):

    def setUp(self):
        super().setUp()
        self._grant_ai_use(self.employee)
        self.manager = new_test_user(
            self.env, login='ai_setup_admin', password='ai_setup_admin_pass_123', name='Sara',
            groups='liwan_core.group_employee,liwan_ai.group_cap_ai_use',
        )
        self._grant_ai_settings_only(self.manager)

    def _grant_ai_settings_only(self, user):
        """The real capability lookup, with ``ai.settings.manage`` granted to ``user`` alone."""
        user.write({'group_ids': [Command.link(self.env.ref('liwan_ai.group_cap_ai_settings_manage').id)]})
        access = type(self.env['liwan.access.service'])
        original = access._liwan_has_capability

        def has_capability(model, who, key, record=None, company=None):
            if key == 'ai.settings.manage':
                return who == user
            return original(model, who, key, record=record, company=company)

        self.patch(access, '_liwan_has_capability', has_capability)

    def _as(self, login):
        self.authenticate(login, f'{login}_pass_123')

    def test_only_the_settings_a_user_may_change_are_listed_and_applied(self):
        self._as('api_emp')
        self.assertNotIn('ai.external_send', [item['key'] for item in self.api('GET', '/api/v1/ai/setup/settings').json()['items']])
        self.assertEqual(self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'approve'}).status_code, 404)
        self._as('ai_setup_admin')
        listed = {item['key']: item for item in self.api('GET', '/api/v1/ai/setup/settings').json()['items']}
        self.assertEqual(listed['ai.external_send']['value'], 'draft_only')
        self.assertEqual(listed['ai.external_send']['options'], ['draft_only', 'approve'])
        self.assertEqual(listed['ai.messages_per_user_monthly']['max'], 100000)
        bad = self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'shout'})
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'value'))
        self.assertEqual(self.api('POST', '/api/v1/ai/setup/settings/ai.messages_per_user_monthly', {'value': -1}).status_code, 422)
        applied = self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'approve'}).json()
        self.assertEqual(applied, {'key': 'ai.external_send', 'before': 'draft_only', 'after': 'approve'})
        settings = self.env['liwan.ai.settings']._liwan_current()
        self.assertEqual((settings.external_send, settings.revision), ('approve', 2))
        entry = self.env['liwan.access.audit'].search([('action', '=', 'ai.setting.apply')], limit=1)
        self.assertEqual((entry.before['value'], entry.after['value'], entry.actor_id), ('draft_only', 'approve', self.manager))

    def test_the_setup_tools_live_only_in_a_setup_conversation(self):
        self._as('api_emp')
        ordinary = self.api('GET', '/api/v1/ai/tools').json()
        self.assertFalse([item for item in ordinary['items'] if item['name'].startswith('ai.')])
        setup = self.url_open('/api/v1/ai/tools?mode=setup').json()
        self.assertEqual({item['name'] for item in setup['items']}, {'ai.list_settings', 'ai.apply_setting'})
        self.assertEqual([agent['key'] for agent in setup['agents']], ['ai'])
        self.assertEqual(self.url_open('/api/v1/ai/tools?mode=shout').status_code, 422)

    def test_setup_messages_spend_the_setup_budget_never_the_package(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), 'ai.setup.monthly': 1, 'ai.messages.monthly': 0},
        })
        self._grant_ai_use(self.manager)
        with self.assertRaises(AccessError):  # the setup assistant serves those who may change a setting
            self.env['liwan.ai.audit'].with_user(self.employee).create(MESSAGE)
        Audit = self.env['liwan.ai.audit'].with_user(self.manager)
        Audit.create(MESSAGE)  # a package with no message left still runs the setup agent
        with self.assertRaises(LiwanAccessRule) as caught:
            Audit.create(MESSAGE)
        self.assertEqual(caught.exception.details['limit_key'], 'ai.setup.monthly')
        self.assertEqual(Audit._liwan_ai_count_messages(), 0)
        self.assertEqual(Audit._liwan_ai_count_messages(kind='setup'), 1)

    def test_a_conversation_keeps_the_mode_it_started_in(self):
        self._grant_ai_use(self.manager)
        Audit = self.env['liwan.ai.audit'].with_user(self.manager)
        Audit.create(MESSAGE)
        with self.assertRaises(ValidationError) as caught:
            Audit.create({**MESSAGE, 'kind': 'message'})
        self.assertEqual(caught.exception.liwan_code, 'mode_mismatch')
        self.assertEqual(Audit._liwan_ai_conversation_mode('r_setup_01'), 'setup')
        self.assertIsNone(Audit._liwan_ai_conversation_mode('r_unknown'))
        self._as('ai_setup_admin')
        self.assertEqual(self.api('GET', '/api/v1/ai/conversations/r_setup_01/mode').json(), {'mode': 'setup'})
