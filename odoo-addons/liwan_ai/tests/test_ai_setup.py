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
        self.assertEqual(self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'approve', 'expected': 'draft_only'}).status_code, 404)
        self._as('ai_setup_admin')
        listed = {item['key']: item for item in self.api('GET', '/api/v1/ai/setup/settings').json()['items']}
        self.assertEqual(listed['ai.external_send']['value'], 'draft_only')
        self.assertEqual(listed['ai.external_send']['options'], ['draft_only', 'approve'])
        self.assertEqual(listed['ai.messages_per_user_monthly']['max'], 100000)
        bad = self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'shout', 'expected': 'draft_only'})
        self.assertEqual((bad.status_code, bad.json()['field']), (422, 'value'))
        self.assertEqual(self.api('POST', '/api/v1/ai/setup/settings/ai.messages_per_user_monthly', {'value': -1, 'expected': 0}).status_code, 422)
        self.assertEqual(self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'approve'}).status_code, 422)
        stale = self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'approve', 'expected': 'approve'})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        applied = self.api('POST', '/api/v1/ai/setup/settings/ai.external_send', {'value': 'approve', 'expected': 'draft_only'}).json()
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
        self.assertEqual({item['name'] for item in setup['items']}, {'ai.readiness', 'ai.list_settings', 'ai.apply_setting'})
        self.assertEqual([agent['key'] for agent in setup['agents']], ['ai'])
        self.assertEqual(self.url_open('/api/v1/ai/tools?mode=shout').status_code, 422)

    def test_setup_messages_spend_the_assistance_budget_never_the_package(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**(profile.features or {}), 'ai.assist.monthly': 1, 'ai.messages.monthly': 0},
        })
        self._grant_ai_use(self.manager)
        with self.assertRaises(AccessError):  # the setup assistant serves those who may change a setting
            self.env['liwan.ai.audit'].with_user(self.employee).create(MESSAGE)
        Audit = self.env['liwan.ai.audit'].with_user(self.manager)
        Audit.create(MESSAGE)  # a package with no message left still runs the setup agent
        with self.assertRaises(LiwanAccessRule) as caught:
            Audit.create(MESSAGE)
        self.assertEqual(caught.exception.details['limit_key'], 'ai.assist.monthly')
        self.assertEqual(Audit._liwan_ai_count_messages(), 0)
        self.assertEqual(Audit._liwan_ai_count_messages(kinds=('setup',)), 1)

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

    def _no_record_checks(self):
        self.patch(type(self.env['liwan.ai.readiness']), '_liwan_ai_record_checks', lambda model: ())

    def test_the_readiness_check_lists_only_what_the_caller_may_see_and_changes_nothing(self):
        self._no_record_checks()
        self._as('api_emp')
        self.assertEqual(self.api('GET', '/api/v1/ai/setup/readiness').json(), {'items': [], 'total': 0})
        self.patch(type(self.env['liwan.ai.settings']), '_liwan_current', lambda model: model.browse())
        self.assertEqual(self.api('GET', '/api/v1/ai/setup/readiness').json(), {'items': [], 'total': 0})
        self._as('ai_setup_admin')
        items = self.api('GET', '/api/v1/ai/setup/readiness').json()['items']
        self.assertEqual([item['key'] for item in items], ['settings.ai'])
        # An unsigned acknowledgement is never listed: no run, and so no readiness check, happens without one.
        self.assertNotIn('ai.consent', [item['key'] for item in items])

    def test_unsaved_settings_are_grouped_by_application_and_point_to_the_settings_home(self):
        self._no_record_checks()
        self.patch(type(self.env['liwan.ai.settings']), '_liwan_current', lambda model: model.browse())
        self._as('ai_setup_admin')
        unsaved = {item['key']: item for item in self.api('GET', '/api/v1/ai/setup/readiness').json()['items']}['settings.ai']
        self.assertEqual((unsaved['page'], unsaved['severity']), ('/settings', 'recommended'))
        self.assertIn('رسائل كل موظف شهريًا', unsaved['label']['ar'])
        self.assertIn('Messages per employee each month', unsaved['label']['en'])

    def test_users_without_a_role_are_counted_only_for_a_reader_of_users(self):
        self._no_record_checks()
        new_test_user(self.env, login='ai_roleless', password='ai_roleless_pass_123', name='Roleless', groups='base.group_user')
        reader_role = self.env['liwan.access.role'].create({
            'name_ar': 'قارئ المستخدمين', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([('key', 'in', ('access.users.read', 'access.roles.read', 'ai.use'))]).ids)],
        })
        reader = new_test_user(self.env, login='ai_users_reader', password='ai_users_reader_pass_123', name='Reader', groups='base.group_user,liwan_ai.group_cap_ai_use')
        self.env['liwan.access.assignment'].create({'user_id': reader.id, 'role_id': reader_role.id, 'company_id': self.env.company.id})
        entry = self.env['liwan.ai.readiness'].with_user(reader)._liwan_ai_user_items()
        self.assertEqual([item['key'] for item in entry], ['access.users_without_role'])
        self.assertEqual(entry[0]['page'], '/settings/team/users')
        self.assertEqual(self.env['liwan.ai.readiness'].with_user(self.employee)._liwan_ai_user_items(), [])
        self._as('ai_users_reader')
        self.assertEqual([item['key'] for item in self.api('GET', '/api/v1/ai/setup/readiness').json()['items']], ['access.users_without_role'])

    def test_an_application_declares_what_it_expects_to_hold_once_in_use(self):
        check = {
            'key': 'ai.consents', 'owner': 'liwan_ai', 'feature_key': 'ai.enabled', 'model': 'liwan.ai.consent',
            'capability': 'ai.use', 'label_ar': 'لا إقرارات بعد', 'label_en': 'No acknowledgements yet', 'page': '/settings/apps/ai',
        }
        registry = type(self.env['liwan.ai.readiness'])
        self.patch(registry, '_liwan_ai_record_checks', lambda model: (check,))
        readiness = self.env['liwan.ai.readiness'].with_user(self.env.ref('base.user_admin'))
        self.assertEqual([entry['key'] for entry in readiness._liwan_ai_record_items()], ['records.ai.consents'])
        self.assertEqual(readiness._liwan_ai_record_items()[0]['severity'], 'optional')
        # A domain narrows which records count: none matches, so the application still looks unused.
        self.patch(registry, '_liwan_ai_record_checks', lambda model: ({**check, 'domain': [('id', '=', 0)]},))
        self.assertEqual(len(readiness._liwan_ai_record_items()), 1)
        for broken, fragment in (({**check, 'page': 'settings'}, 'page'), ({**check, 'key': 'crm.consents'}, 'prefix'), ({**check, 'model': 'no.such'}, 'page'), ({**check, 'domain': 'x'}, 'domain')):
            self.patch(registry, '_liwan_ai_record_checks', lambda model, broken=broken: (broken,))
            with self.assertRaises(ValidationError) as caught:
                self.env['liwan.ai.readiness']._liwan_ai_check_map()
            self.assertIn(fragment, str(caught.exception))
