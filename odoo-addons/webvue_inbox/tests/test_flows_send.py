# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .flows_common import BASE, FlowCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_inbox.models import automation as engine


@tagged('post_install', '-at_install', 'webvue')
class TestSendForm(FlowCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conversation = cls.make_conversation()
        cls.flow = cls.make_flow(name='Intake')

    def setUp(self):
        super().setUp()
        self.login(self.agent)

    def interactive(self, flow=None, **overrides):
        return {'interactive': {
            'type': 'flow', 'body': 'Please fill in', 'header': 'Intake', 'footer': 'Takes a minute', 'flow_id': (flow or self.flow).id,
            'cta': 'Open form', **overrides,
        }}

    def reply(self, body, conversation=None):
        return self.api('POST', f'{BASE}/conversations/{(conversation or self.conversation).id}/messages', body)

    def test_the_outbox_sends_the_flow_message_with_a_fresh_token(self):
        result = self.reply(self.interactive())
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['interactive'], {
            'type': 'flow', 'body': 'Please fill in', 'header': 'Intake', 'footer': 'Takes a minute',
            'flow_id': self.flow.id, 'cta': 'Open form',
        })
        message = self.env['webvue.inbox.message'].browse(result.json()['id'])
        self.assertEqual((message.flow_id, message.kind, message.interactive_type), (self.flow, 'interactive', 'flow'))
        self.assertGreaterEqual(len(message.flow_token), 30)
        self.env['webvue.inbox.message']._webvue_run_outbox()
        (sent,) = [body for body in self.meta.messages() if body and body.get('type') == 'interactive']
        self.assertEqual(sent['interactive'], {
            'type': 'flow', 'body': {'text': 'Please fill in'}, 'header': {'type': 'text', 'text': 'Intake'},
            'footer': {'text': 'Takes a minute'},
            'action': {'name': 'flow', 'parameters': {
                'flow_message_version': '3', 'flow_token': message.flow_token, 'flow_id': self.flow.provider_flow_id,
                'flow_cta': 'Open form', 'flow_action': 'navigate', 'mode': 'published',
            }},
        })
        self.assertEqual(message.delivery_state, 'sent')

    def test_every_message_gets_its_own_token(self):
        first = self.env['webvue.inbox.message'].browse(self.reply(self.interactive()).json()['id'])
        second = self.env['webvue.inbox.message'].browse(self.reply(self.interactive()).json()['id'])
        self.assertNotEqual(first.flow_token, second.flow_token)

    def test_only_a_sendable_form_of_the_same_channel_can_be_sent(self):
        other = self.make_channel(phone_id='100000000055')
        for flow in (
            self.make_flow(status='draft'), self.make_flow(status='deprecated'), self.make_flow(health='blocked'),
            self.make_flow(channel=other),
        ):
            result = self.reply(self.interactive(flow))
            self.assertEqual((result.status_code, result.json().get('field')), (422, 'flow_id'), flow.name)
        self.assertError(self.reply(self.interactive(flow_id=999999)), 422, 'invalid')

    def test_the_body_is_checked(self):
        for overrides in ({'cta': 'x' * 31}, {'cta': ''}, {'body': ''}, {'extra': 1}):
            self.assertError(self.reply(self.interactive(**overrides)), 422, 'invalid')
        missing = self.interactive()
        del missing['interactive']['cta']
        self.assertError(self.reply(missing), 422, 'invalid')

    def test_a_form_follows_the_24_hour_window(self):
        old = self.make_conversation(minutes_ago=25 * 60)
        self.assertError(self.reply(self.interactive(), old), 422, 'invalid')

    def test_the_sub_feature_must_be_on(self):
        set_probe_feature(self, key='inbox.flows', enabled=False)
        self.assertEqual(self.reply(self.interactive()).status_code, 403)


@tagged('post_install', '-at_install', 'webvue')
class TestAutomationForm(FlowCase):

    def test_a_rule_reply_sends_the_form(self):
        flow = self.make_flow()
        self.make_rule(keywords=['book'], name='book', reply={
            'body': 'Fill this', 'interactive_type': 'flow', 'flow_id': flow.id, 'flow_cta': 'Open',
        })
        message, _event = self.deliver('I want to book')
        sent = self.automated(message.conversation_id)
        self.assertEqual((len(sent), sent.kind, sent.interactive_type, sent.flow_id), (1, 'interactive', 'flow', flow))
        self.assertTrue(sent.flow_token)

    def test_a_form_that_is_no_longer_sendable_is_skipped_with_a_note(self):
        flow = self.make_flow(name='Old intake')
        self.set_text('welcome', 'ignored')
        self.channel._webvue_set_auto_message('welcome', {
            'body': 'Fill this', 'interactive_type': 'flow', 'flow_id': flow.id, 'flow_cta': 'Open',
        })
        flow.status = 'deprecated'
        message, _event = self.deliver('Hi')
        conversation = message.conversation_id
        self.assertFalse(self.automated(conversation))
        self.assertIn(engine.NOTE_FLOW_UNAVAILABLE % 'Old intake', self.notes(conversation))

    def test_a_form_of_another_channel_is_skipped_too(self):
        other = self.make_channel(phone_id='100000000066')
        flow = self.make_flow(channel=other, name='Elsewhere')
        self.channel._webvue_set_auto_message('welcome', {
            'body': 'Fill this', 'interactive_type': 'flow', 'flow_id': flow.id, 'flow_cta': 'Open',
        })
        self.channel.welcome_enabled = True
        message, _event = self.deliver('Hi')
        self.assertFalse(self.automated(message.conversation_id))
        self.assertIn(engine.NOTE_FLOW_UNAVAILABLE % 'Elsewhere', self.notes(message.conversation_id))

    def test_the_api_accepts_a_form_in_the_welcome_message_and_a_rule(self):
        flow = self.make_flow()
        self.login(self.automation_user)
        content = {'interactive': {
            'type': 'flow', 'body': 'Fill this', 'header': None, 'footer': None, 'flow_id': flow.id, 'cta': 'Open',
        }}
        patched = self.api('PATCH', f'{BASE}/channels/{self.channel.id}/automation', {'welcome': {'enabled': True, 'content': content}})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['welcome']['content'], content)
        draft = self.make_flow(status='draft')
        content['interactive']['flow_id'] = draft.id
        refused = self.api('PATCH', f'{BASE}/channels/{self.channel.id}/automation', {'welcome': {'content': content}})
        self.assertEqual((refused.status_code, refused.json().get('field')), (422, 'flow_id'))


@tagged('post_install', '-at_install', 'webvue')
class TestTemplateFormButton(FlowCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.flow = cls.make_flow(name='Survey form')
        cls.conversation = cls.make_conversation(minutes_ago=30 * 60)

    def setUp(self):
        super().setUp()
        self.login(self.manager)

    def body(self, **button):
        return {
            'name': 'form_invite', 'language': 'ar', 'category': 'utility', 'allow_category_change': False, 'header': None,
            'body': 'Please answer', 'body_examples': [], 'footer': None,
            'buttons': [{'type': 'flow', 'text': 'Open form', 'flow_id': self.flow.id, **button}],
        }

    def templates(self):
        return f'{BASE}/channels/{self.channel.id}/templates'

    def test_creating_a_template_with_a_form_button(self):
        created = self.api('POST', self.templates(), self.body())
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['buttons'], [{
            'type': 'flow', 'text': 'Open form', 'flow': {'id': self.flow.id, 'name': 'Survey form'},
            'provider_flow_id': self.flow.provider_flow_id,
        }])
        self.assertTrue(created.json()['supported'])
        (payload,) = self.meta.bodies('/message_templates')
        self.assertEqual(payload['components'][-1]['buttons'], [{
            'type': 'FLOW', 'text': 'Open form', 'flow_id': self.flow.provider_flow_id, 'flow_action': 'navigate',
        }])

    def test_the_form_button_needs_a_published_form_of_the_channel(self):
        other = self.make_channel(phone_id='100000000044')
        for flow in (self.make_flow(status='draft'), self.make_flow(status='deprecated'), self.make_flow(channel=other)):
            self.assertError(self.api('POST', self.templates(), self.body(flow_id=flow.id)), 422, 'invalid')
        two = self.body()
        two['buttons'] = [two['buttons'][0], {'type': 'flow', 'text': 'Again', 'flow_id': self.flow.id}]
        self.assertError(self.api('POST', self.templates(), two), 422, 'invalid')

    def test_sending_the_template_adds_the_button_with_a_fresh_token(self):
        template = self.make_template(button_ids=[
            {'kind': 'flow', 'text': 'Open form', 'provider_flow_id': self.flow.provider_flow_id},
        ])
        self.assertEqual(template.button_ids.flow_id, self.flow)
        tokens = []
        for _ in range(2):
            result = self.api('POST', f'{BASE}/conversations/{self.conversation.id}/messages', {'template_id': template.id, 'params': []})
            self.assertEqual(result.status_code, 200, result.text)
            message = self.env['webvue.inbox.message'].browse(result.json()['id'])
            self.assertEqual(message.flow_id, self.flow)
            tokens.append(message.flow_token)
            self.assertEqual(result.json()['template']['buttons'], [{'type': 'flow', 'text': 'Open form'}])
        self.assertNotEqual(*tokens)
        self.env['webvue.inbox.message']._webvue_run_outbox()
        sent = [body['template']['components'] for body in self.meta.messages() if body and body.get('type') == 'template']
        self.assertEqual(
            [components[-1] for components in sent],
            [{'type': 'button', 'sub_type': 'flow', 'index': '0', 'parameters': [{'type': 'action', 'action': {'flow_token': token}}]}
             for token in tokens],
        )

    def test_a_form_that_is_no_longer_sendable_blocks_the_template(self):
        template = self.make_template(button_ids=[{'kind': 'flow', 'text': 'Open', 'provider_flow_id': self.flow.provider_flow_id}])
        self.flow.status = 'deprecated'
        result = self.api('POST', f'{BASE}/conversations/{self.conversation.id}/messages', {'template_id': template.id, 'params': []})
        self.assertError(result, 422, 'invalid')

    def test_a_form_made_in_whatsapp_manager_is_sent_as_it_is(self):
        template = self.make_template(button_ids=[{'kind': 'flow', 'text': 'Open', 'provider_flow_id': '123456789'}])
        self.assertFalse(template.button_ids.flow_id)
        result = self.api('POST', f'{BASE}/conversations/{self.conversation.id}/messages', {'template_id': template.id, 'params': []})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(self.env['webvue.inbox.message'].browse(result.json()['id']).flow_token)

    def test_sync_reads_a_form_button_as_supported(self):
        channel_template = {
            'id': '555000123', 'name': 'form_sync', 'language': 'ar', 'category': 'UTILITY', 'status': 'APPROVED',
            'components': [
                {'type': 'BODY', 'text': 'Hello'},
                {'type': 'BUTTONS', 'buttons': [{'type': 'FLOW', 'text': 'Open', 'flow_id': self.flow.provider_flow_id, 'flow_action': 'navigate'}]},
            ],
        }
        values = self.env['webvue.inbox.template']._webvue_values_from_meta(channel_template)
        self.assertTrue(values['supported'])
        self.assertEqual(values['button_ids'][1][2]['provider_flow_id'], self.flow.provider_flow_id)
