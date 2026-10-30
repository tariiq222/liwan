# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command
from odoo.tests import new_test_user, tagged

from .automation_common import BASE, AutomationCase
from .common import PASSWORD
from odoo.addons.liwan_api.tests.common import set_probe_feature

BUTTONS = {
    'type': 'buttons', 'body': 'Pick one', 'header': None, 'footer': 'Menu',
    'buttons': [{'id': 'a', 'title': 'A'}, {'id': 'b', 'title': 'B'}],
}
LIST = {
    'type': 'list', 'body': 'Pick', 'header': None, 'footer': None, 'button': 'Open',
    'sections': [{'title': 'Services', 'rows': [{'id': 'r1', 'title': 'One', 'description': 'First'}]}],
}
CTA = {'type': 'cta_url', 'body': 'Visit us', 'header': None, 'footer': None, 'display_text': 'Open', 'url': 'https://example.com'}


@tagged('post_install', '-at_install', 'liwan')
class TestChannelAutomationApi(AutomationCase):

    def setUp(self):
        super().setUp()
        self.login(self.automation_user)
        self.path = f'{BASE}/channels/{self.channel.id}/automation'

    def patch(self, payload):
        return self.api('PATCH', self.path, payload)

    def test_defaults_have_everything_off(self):
        body = self.get(self.path).json()
        self.assertEqual(set(body), {'welcome', 'away', 'csat'})
        self.assertEqual(body['welcome'], {'enabled': False, 'idle_days': 0, 'content': None})
        self.assertEqual(body['away'], {'enabled': False, 'repeat_hours': 12, 'content': None})
        self.assertEqual(set(body['csat']), {'enabled', 'question', 'good', 'neutral', 'bad'})
        self.assertFalse(body['csat']['enabled'])

    def test_text_and_interactive_content_round_trip_in_one_shape(self):
        for interactive in (BUTTONS, LIST, CTA):
            result = self.patch({'welcome': {'enabled': True, 'idle_days': 3, 'content': {'interactive': interactive}}})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()['welcome'], {'enabled': True, 'idle_days': 3, 'content': {'interactive': interactive}})
            self.assertEqual(self.get(self.path).json(), result.json())
        text = self.patch({'welcome': {'content': {'body': 'Hello there'}}}).json()['welcome']
        self.assertEqual(text['content'], {'body': 'Hello there'})
        message = self.reload(self.channel)._liwan_auto_message('welcome')
        self.assertEqual((message.interactive_type, len(message.option_ids), message.cta_url), (False, 0, False))
        self.assertEqual(self.env['liwan.inbox.auto.message'].search_count([('channel_id', '=', self.channel.id)]), 1)

    def test_away_survey_and_partial_patches(self):
        result = self.patch({
            'away': {'enabled': True, 'repeat_hours': 6, 'content': {'body': 'Closed'}},
            'csat': {'enabled': True, 'question': 'Rate us?', 'good': 'Yes', 'neutral': 'So-so', 'bad': 'No'},
        }).json()
        self.assertEqual(result['away'], {'enabled': True, 'repeat_hours': 6, 'content': {'body': 'Closed'}})
        self.assertEqual(result['csat'], {'enabled': True, 'question': 'Rate us?', 'good': 'Yes', 'neutral': 'So-so', 'bad': 'No'})
        self.assertEqual(self.patch({'csat': {'bad': 'Poor'}}).json()['csat']['bad'], 'Poor')
        self.assertEqual(self.patch({'welcome': {}}).json()['away']['repeat_hours'], 6)
        removed = self.patch({'away': {'enabled': False, 'content': None}}).json()['away']
        self.assertEqual(removed, {'enabled': False, 'repeat_hours': 6, 'content': None})

    def test_an_enabled_message_needs_content(self):
        self.assertError(self.patch({'welcome': {'enabled': True}}), 422, 'invalid')
        self.assertError(self.patch({'away': {'enabled': True, 'content': None}}), 422, 'invalid')
        self.patch({'away': {'enabled': True, 'content': {'body': 'x'}}})
        self.assertError(self.patch({'away': {'content': None}}), 422, 'invalid')
        self.assertTrue(self.reload(self.channel)._liwan_auto_message('away'))

    def test_invalid_bodies_are_rejected(self):
        for bad in (
            {}, {'other': {}}, {'welcome': 1}, {'welcome': {'x': 1}}, {'welcome': {'enabled': 'yes'}},
            {'welcome': {'idle_days': 366}}, {'welcome': {'idle_days': -1}}, {'welcome': {'idle_days': True}},
            {'away': {'repeat_hours': 0}}, {'away': {'repeat_hours': 169}},
            {'welcome': {'content': {}}}, {'welcome': {'content': {'body': 'a', 'interactive': BUTTONS}}},
            {'welcome': {'content': {'body': ''}}}, {'welcome': {'content': {'body': 'x' * 4097}}},
            {'welcome': {'content': {'text': 'x'}}}, {'welcome': {'content': 'x'}},
            {'welcome': {'content': {'interactive': {**BUTTONS, 'buttons': []}}}},
            {'welcome': {'content': {'interactive': {**BUTTONS, 'type': 'carousel'}}}},
            {'welcome': {'content': {'interactive': {**CTA, 'url': 'http://example.com'}}}},
            {'csat': {'good': ''}}, {'csat': {'good': 'x' * 21}}, {'csat': {'question': 'x' * 1025}}, {'csat': {'enabled': 1}},
        ):
            self.assertError(self.patch(bad), 422, 'invalid')

    def test_the_channel_lookup_lists_references_only(self):
        body = self.get(f'{BASE}/automation/channels').json()
        self.assertEqual(body['total'], len(body['items']))
        self.assertIn({'id': self.channel.id, 'name': self.channel.name}, body['items'])

    def test_departments_tags_and_agents_can_be_listed_for_the_rule_forms(self):
        for path in ('departments', 'tags', 'agents'):
            self.assertEqual(self.get(f'{BASE}/{path}').status_code, 200, path)


@tagged('post_install', '-at_install', 'liwan')
class TestChannelAutomationAccess(AutomationCase):

    def routes(self):
        path = f'{BASE}/channels/{self.channel.id}/automation'
        return (('GET', path, None), ('PATCH', path, {'csat': {'enabled': True}}), ('GET', f'{BASE}/automation/channels', None))

    def test_only_the_automation_capability_opens_the_routes(self):
        for user in (self.agent, self.supervisor, self.reader_only, self.outsider):
            self.login(user)
            for method, path, body in self.routes():
                self.assertError(self.api(method, path, body), 403, 'forbidden')
        for user in (self.automation_user, self.manager):
            self.login(user)
            for method, path, body in self.routes():
                self.assertEqual(self.api(method, path, body).status_code, 200, (user.login, method, path))

    def test_the_channels_capability_alone_does_not_edit_automation(self):
        channels_only = self.custom_user('channels_only', 'inbox.channels.manage')
        self.login(channels_only)
        for method, path, body in self.routes():
            self.assertError(self.api(method, path, body), 403, 'forbidden')

    def test_the_feature_closes_the_routes(self):
        self.login(self.manager)
        set_probe_feature(self, key='inbox.automation', enabled=False)
        set_probe_feature(self, key='inbox.campaigns', enabled=False)  # the channel references serve both applications
        for method, path, body in self.routes():
            self.assertError(self.api(method, path, body), 403, 'feature_not_included')

    def test_the_automation_capability_does_not_reveal_channel_secrets(self):
        self.login(self.automation_user)
        self.assertNotIn('verify_token', self.get(f'{BASE}/channels/{self.channel.id}/automation').text)
        self.assertError(self.get(f'{BASE}/channels/{self.channel.id}'), 403, 'forbidden')


@tagged('post_install', '-at_install', 'liwan')
class TestChannelAutomationCompanyScope(AutomationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.child = cls.env['res.company'].create({'name': 'Automation child company', 'parent_id': cls.env.company.id})
        cls.child_channel = cls.make_channel(phone_id='820000000001', owner_company_id=cls.child.id)
        cls.child_manager = new_test_user(
            cls.env, login='automation_child_manager', password=PASSWORD, name='Child manager', groups='base.group_user',
            company_id=cls.env.company.id, company_ids=[Command.set((cls.env.company | cls.child).ids)],
        )
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.child_manager.id, 'company_id': cls.child.id,
            'role_id': cls.env.ref('liwan_inbox.role_inbox_manager').id,
        })

    def test_another_company_channel_is_not_found(self):
        self.login(self.manager)
        path = f'{BASE}/channels/{self.child_channel.id}/automation'
        self.assertError(self.get(path), 404, 'not_found')
        self.assertError(self.api('PATCH', path, {'csat': {'enabled': True}}), 404, 'not_found')
        self.assertNotIn(self.child_channel.id, [item['id'] for item in self.get(f'{BASE}/automation/channels').json()['items']])

    def test_the_child_manager_automates_the_child_channel_only(self):
        self.login(self.child_manager)
        path = f'{BASE}/channels/{self.child_channel.id}/automation'
        result = self.api('PATCH', path, {'away': {'enabled': True, 'content': {'body': 'Closed'}}})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(self.child_channel._liwan_auto_message('away').company_id, self.child)
        self.assertError(self.get(f'{BASE}/channels/{self.channel.id}/automation'), 404, 'not_found')
