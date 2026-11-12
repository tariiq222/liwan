# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""TikTok outbound: the 48-hour window and the reply limit, the content TikTok accepts, and the send."""
import base64
import calendar
from datetime import timedelta
from unittest.mock import MagicMock, patch

from odoo import Command, fields
from odoo.tests import tagged

from . import tiktok_payloads as tt
from .automation_common import RULE_BODY
from .common import LiwanInboxCase
from .media_samples import PDF, PNG
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.controllers.reply_parsing import parse_interactive
from odoo.addons.liwan_inbox.models.constants import (
    AUTOMATION_FEATURE,
    REPLY_WINDOWS,
    TIKTOK_ECHO_SETTLE,
    TIKTOK_FEATURE,
)

ACCESS_TOKEN = 'tiktok-access-token-send'
REFRESH_TOKEN = 'tiktok-refresh-token-send'
REASON_UNSUPPORTED = 'inbox_tiktok_unsupported_kind'


@tagged('post_install', '-at_install', 'liwan')
class TikTokCase(LiwanInboxCase):
    """The fixtures of the TikTok outbound tests: a connected account and a customer conversation."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        now = fields.Datetime.now()
        cls.tiktok = cls.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': tt.BUSINESS_ID, 'state': 'connected',
        })
        cls.tiktok._liwan_tiktok_store(tiktok.TokenGrant(
            open_id=tt.BUSINESS_ID, scopes=frozenset(tiktok.SCOPES),
            access_token=ACCESS_TOKEN, refresh_token=REFRESH_TOKEN,
            expires_at=now + timedelta(days=1), refresh_expires_at=now + timedelta(days=365),
        ))
        cls.conversation = cls.make_tiktok_conversation()

    @classmethod
    def make_tiktok_conversation(cls, minutes_ago=5, image_send_capable=True, inbound_id='msg-inbound-1'):
        cls.counter += 1
        company = cls.tiktok.owner_company_id
        contact = cls.env['liwan.inbox.contact'].create({
            'name': f'TikTok customer {cls.counter}', 'company_id': company.id,
        })
        identity = cls.env['liwan.inbox.contact.identity'].create({
            'contact_id': contact.id, 'channel_kind': 'tiktok', 'address': f'tiktok-sender-{cls.counter}',
            'company_id': company.id,
        })
        conversation = cls.env['liwan.inbox.conversation'].create({
            'channel_id': cls.tiktok.id, 'contact_id': contact.id, 'identity_id': identity.id,
            'company_id': company.id, 'provider_conversation_id': tt.CONVERSATION_ID,
            'image_send_capable': image_send_capable,
        })
        cls.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': company.id, 'direction': 'in',
            'body': 'Hello from TikTok', 'delivery_state': 'received', 'provider_message_id': inbound_id,
            'date': fields.Datetime.now() - timedelta(minutes=minutes_ago),
        })
        return conversation

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)
        self.login(self.agent)
        capability = patch.object(tiktok, 'image_send_capable', return_value=True)
        capability.start()
        self.addCleanup(capability.stop)

    def path(self, suffix='', conversation=None):
        return f'/api/v1/inbox/conversations/{(conversation or self.conversation).id}{suffix}'

    def reply(self, payload, conversation=None):
        return self.api('POST', self.path('/messages', conversation), payload)

    def upload(self, name='a.png', content=PNG, mimetype='image/png', conversation=None):
        response = self.api('POST', self.path('/uploads', conversation), {
            'name': name, 'mimetype': mimetype, 'data': base64.b64encode(content).decode(),
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def run_outbox(self):
        self.env['liwan.inbox.message']._liwan_run_outbox()

    def queued(self, message_id):
        return self.env['liwan.inbox.message'].browse(message_id)

    def deliver(self, payload):
        """Deliver one webhook payload and process it after the echo settle time."""
        self.store_event(self.tiktok, payload)
        later = fields.Datetime.now() + TIKTOK_ECHO_SETTLE + timedelta(seconds=1)
        with patch('odoo.fields.Datetime.now', return_value=later):
            self.env['liwan.inbox.event']._liwan_run_events()
        latest = self.env['liwan.inbox.message'].search([
            ('conversation_id.channel_id', '=', self.tiktok.id),
        ], order='id desc', limit=1)
        return latest.conversation_id

    def receive_now(self, body='Hi'):
        """An inbound text delivered at the current moment (the fixtures' fixed timestamp is months old)."""
        moment = calendar.timegm(fields.Datetime.now().timetuple()) * 1000
        return tt.receive_text(body=body, timestamp=moment)


class TestTikTokSend(TikTokCase):
    """An agent replying on a TikTok conversation: what may be queued, and what leaves the outbox."""

    # what may be queued

    def test_a_text_is_queued_with_the_quote_target(self):
        inbound = self.conversation.message_ids[0]
        response = self.reply({'body': 'Hello back', 'reply_to_id': inbound.id})
        self.assertEqual(response.status_code, 200, response.text)
        message = self.env['liwan.inbox.message'].browse(response.json()['id'])
        self.assertEqual(
            (message.direction, message.kind, message.body, message.reply_to_id),
            ('out', 'text', 'Hello back', inbound),
        )

    def test_a_caption_is_refused(self):
        response = self.reply({
            'attachment_id': self.upload(), 'caption': 'Look at this',
        })
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], REASON_UNSUPPORTED)

    def test_a_pdf_is_refused(self):
        response = self.reply({'attachment_id': self.upload('a.pdf', PDF, 'application/pdf')})
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], REASON_UNSUPPORTED)

    def test_an_image_is_refused_when_the_conversation_cannot_receive_one(self):
        conversation = self.make_tiktok_conversation(image_send_capable=False, inbound_id='msg-inbound-2')
        response = self.reply({'attachment_id': self.upload(conversation=conversation)}, conversation=conversation)
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], REASON_UNSUPPORTED)

    def test_a_template_is_refused(self):
        template = self.make_template(channel=self.tiktok, name='order_ready')
        response = self.reply({'template_id': template.id, 'params': []})
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], REASON_UNSUPPORTED)

    def test_the_window_closes_after_48_hours(self):
        conversation = self.make_tiktok_conversation(
            minutes_ago=int(REPLY_WINDOWS['tiktok'].total_seconds() // 60) + 1, inbound_id='msg-inbound-3',
        )
        response = self.reply({'body': 'too late'}, conversation=conversation)
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], 'inbox_window_closed')
        self.assertIn('48', response.json()['message'])

    def test_ten_replies_in_a_row_are_allowed_but_an_eleventh_is_refused(self):
        for number in range(10):
            self.assertEqual(self.reply({'body': f'Reply {number}'}).status_code, 200)
        response = self.reply({'body': 'One too many'})
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], 'inbox_tiktok_reply_limit')

    def test_a_failed_send_does_not_use_up_the_next_replies(self):
        # A reply that never reached TikTok (a refused send, not a delivered one) must not hold the
        # conversation at the limit: the customer should not have to write again to unblock it.
        for number in range(9):
            self.assertEqual(self.reply({'body': f'Reply {number}'}).status_code, 200)
        tenth = self.reply({'body': 'Reply nine'}).json()['id']
        self.env['liwan.inbox.message'].browse(tenth).write({'delivery_state': 'failed'})
        self.assertEqual(self.reply({'body': 'A replacement'}).status_code, 200)

    # what leaves the outbox

    def test_the_text_goes_to_the_conversation_id_with_the_quote(self):
        inbound = self.conversation.message_ids[0]
        message = self.queued(self.reply({'body': 'Hello back', 'reply_to_id': inbound.id}).json()['id'])
        with patch.object(tiktok, 'send_text', return_value='msg-sent-1') as send_text:
            self.run_outbox()
        credentials, conversation_id, body, context_id = send_text.call_args.args
        self.assertEqual((credentials.business_id, credentials.access_token), (tt.BUSINESS_ID, ACCESS_TOKEN))
        self.assertEqual((conversation_id, body, context_id), (tt.CONVERSATION_ID, 'Hello back', inbound.provider_message_id))
        self.assertEqual((message.delivery_state, message.provider_message_id, message.attempts), ('sent', 'msg-sent-1', 1))

    def test_the_image_is_uploaded_once_then_sent(self):
        message = self.queued(self.reply({'attachment_id': self.upload()}).json()['id'])
        with patch.object(tiktok, 'upload_image', return_value='media-1') as upload, patch.object(
            tiktok, 'send_image', return_value='msg-image-1',
        ) as send_image:
            self.run_outbox()
        _credentials, name, mimetype, data = upload.call_args.args
        self.assertEqual((name, mimetype, data), ('a.png', 'image/png', PNG))
        self.assertEqual((send_image.call_args.args[1], send_image.call_args.args[2]), (tt.CONVERSATION_ID, 'media-1'))
        self.assertEqual((message.delivery_state, message.provider_message_id, message.media_id), ('sent', 'msg-image-1', 'media-1'))

    def test_a_retryable_error_backs_off(self):
        message = self.queued(self.reply({'body': 'Hello'}).json()['id'])
        before = fields.Datetime.now()
        with patch.object(tiktok, 'send_text', side_effect=errors.ProviderError('rate limited', retryable=True)):
            self.run_outbox()
        self.assertEqual((message.delivery_state, message.attempts), ('queued', 1))
        self.assertAlmostEqual((message.next_attempt_at - before).total_seconds(), 60, delta=5)

    def test_a_server_error_on_a_send_fails_unconfirmed_and_is_never_sent_again(self):
        message = self.queued(self.reply({'body': 'Hello'}).json()['id'])
        answer = MagicMock(status_code=503)
        answer.json.side_effect = ValueError
        with patch.object(tiktok.requests, 'request', return_value=answer) as request:
            self.run_outbox()
            self.run_outbox()
        self.assertEqual(request.call_count, 1, 'TikTok may hold the message, so it is never sent a second time')
        self.assertEqual((message.delivery_state, message.unconfirmed, message.attempts), ('failed', True, 1))

    def test_a_reconnect_needed_failure_is_not_retried(self):
        message = self.queued(self.reply({'body': 'Hello'}).json()['id'])
        self.tiktok.write({
            'token_expires_at': fields.Datetime.now() - timedelta(minutes=1),
            'refresh_expires_at': fields.Datetime.now() - timedelta(minutes=1),
        })
        with patch.object(tiktok, 'send_text') as send_text:
            self.run_outbox()
        self.assertEqual((send_text.call_count, message.delivery_state, message.attempts), (0, 'failed', 1))
        self.assertIn('reconnect', message.error.lower())
        self.assertEqual(self.tiktok.state, 'error')

    # button cards, typing and read receipts

    def card(self, buttons):
        return {'type': 'buttons', 'body': 'Pick one', 'header': None, 'footer': None, 'buttons': buttons}

    def test_a_rule_reply_with_three_buttons_goes_out_as_a_card(self):
        rule = self.env['liwan.inbox.rule'].create({
            'name': 'Pick', 'channel_id': self.tiktok.id, 'match_kind': 'contains',
            'keyword_ids': [Command.create({'value': 'pick'})],
        })
        rule._liwan_set_reply(parse_interactive(self.card(
            [{'id': f'id-{number}', 'title': f'Choice {number}'} for number in range(3)],
        ), self.tiktok))
        message = self.env['liwan.inbox.message']._liwan_queue_automated(
            self.conversation, rule.reply_ids._liwan_message_values(),
        )
        with patch.object(tiktok, 'send_buttons', return_value='msg-card-1') as send_buttons:
            self.run_outbox()
        credentials, conversation_id, title, buttons = send_buttons.call_args.args
        self.assertEqual((credentials.business_id, conversation_id, title), (tt.BUSINESS_ID, tt.CONVERSATION_ID, 'Pick one'))
        self.assertEqual([(button.id, button.title) for button in buttons], [('id-0', 'Choice 0'), ('id-1', 'Choice 1'), ('id-2', 'Choice 2')])
        self.assertEqual((message.delivery_state, message.provider_message_id), ('sent', 'msg-card-1'))

    def test_a_rule_for_a_tiktok_channel_refuses_four_buttons(self):
        set_probe_feature(self, key=AUTOMATION_FEATURE, enabled=True)
        self.login(self.manager)
        buttons = [{'id': f'id-{number}', 'title': f'Choice {number}'} for number in range(4)]
        response = self.api('POST', '/api/v1/inbox/rules', {
            **RULE_BODY, 'channel_id': self.tiktok.id, 'keywords': ['pick'], 'reply': {'interactive': self.card(buttons)},
        })
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], REASON_UNSUPPORTED)
        three = [{'id': f'id-{number}', 'title': f'Choice {number}'} for number in range(3)]
        accepted = self.api('POST', '/api/v1/inbox/rules', {
            **RULE_BODY, 'channel_id': self.tiktok.id, 'keywords': ['pick'], 'reply': {'interactive': self.card(three)},
        })
        self.assertEqual(accepted.status_code, 201, accepted.text)
        self.assertEqual(len(accepted.json()['reply']['interactive']['buttons']), 3)

    def request_typing(self):
        self.conversation.write({'typing_pending': True, 'typing_requested_at': fields.Datetime.now()})

    def test_typing_uses_a_sender_action(self):
        self.request_typing()
        with patch.object(tiktok, 'send_action') as send_action:
            self.run_outbox()
        credentials, conversation_id, action = send_action.call_args.args
        self.assertEqual((credentials.business_id, conversation_id, action), (tt.BUSINESS_ID, tt.CONVERSATION_ID, 'TYPING'))
        self.assertFalse(self.conversation.typing_pending)
        self.run_outbox()
        self.assertEqual(send_action.call_count, 1)

    def test_a_read_receipt_marks_the_conversation_read(self):
        inbound = self.conversation.message_ids[0]
        inbound.read_receipt = 'pending'
        with patch.object(tiktok, 'send_action') as send_action:
            self.run_outbox()
        self.assertEqual(send_action.call_args.args[1:], (tt.CONVERSATION_ID, 'MARK_READ'))
        self.assertEqual(inbound.read_receipt, 'sent')

    def test_an_outbound_reaction_is_refused(self):
        message = self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'company_id': self.conversation.company_id.id,
            'direction': 'out', 'body': 'Already sent', 'delivery_state': 'sent', 'provider_message_id': 'msg-sent-old',
        })
        response = self.api('POST', f'/api/v1/inbox/messages/{message.id}/reaction', {'emoji': '👍'})
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], REASON_UNSUPPORTED)
        self.assertFalse(message.agent_reaction_pending or message.agent_reaction)


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokAutomation(TikTokCase):
    """The TikTok automation messages: the welcome is TikTok's own, the away and the survey leave LiwanOS."""

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=AUTOMATION_FEATURE, enabled=True)
        self.login(self.manager)

    def patch_automation(self, payload):
        return self.api('PATCH', f'/api/v1/inbox/channels/{self.tiktok.id}/automation', payload)

    def closed_hours(self):
        tomorrow = (fields.Datetime.now().weekday() + 1) % 7
        return {
            'timezone': 'UTC', 'holidays': [],
            'days': [{'weekday': tomorrow, 'from': '00:00', 'to': '24:00'}],
        }

    def test_saving_the_welcome_message_pushes_it_to_tiktok(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-welcome-1') as create:
            response = self.patch_automation({
                'welcome': {'enabled': True, 'content': {'body': 'Welcome to the shop'}},
            })
        self.assertEqual(response.status_code, 200, response.text)
        credentials, auto_type, content = create.call_args.args
        self.assertEqual((credentials.business_id, auto_type), (tt.BUSINESS_ID, 'WELCOME_MESSAGE'))
        self.assertEqual(content, {'welcome_message': {'content': 'Welcome to the shop'}})
        self.tiktok.invalidate_recordset(['tiktok_welcome_id', 'tiktok_welcome_audit'])
        self.assertEqual((self.tiktok.tiktok_welcome_id, self.tiktok.tiktok_welcome_audit), ('am-welcome-1', 'reviewing'))
        self.assertEqual(self.tiktok._liwan_auto_message('welcome').body, 'Welcome to the shop')

    def test_a_welcome_that_is_not_a_short_text_is_refused(self):
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)
        for content in (
            {'body': 'x' * (tiktok.WELCOME_MAX + 1)},
            {'interactive': {'type': 'buttons', 'body': 'Pick', 'buttons': [{'id': 'yes', 'title': 'Yes'}]}},
        ):
            with patch.object(tiktok, 'create_auto_message') as create:
                response = self.patch_automation({'welcome': {'enabled': True, 'content': content}})
            self.assertError(response, 422, 'invalid')
            self.assertEqual(create.call_count, 0)
        self.assertFalse(self.tiktok._liwan_auto_message('welcome'))

    def test_the_welcome_is_never_sent_by_liwanos(self):
        with patch.object(tiktok, 'create_auto_message', return_value='am-welcome-1'):
            self.patch_automation({'welcome': {'enabled': True, 'content': {'body': 'Welcome to the shop'}}})
        conversation = self.deliver(self.receive_now())
        self.assertFalse(conversation.message_ids.filtered(lambda message: message.direction == 'out'))

    def test_the_away_message_is_sent_by_liwanos(self):
        self.env['liwan.inbox.working.hours']._liwan_write(self.settings, self.closed_hours())
        with patch.object(tiktok, 'create_auto_message', return_value='am-welcome-1'):
            self.patch_automation({'away': {'enabled': True, 'content': {'body': 'We are away'}}})
        conversation = self.deliver(self.receive_now())
        message = conversation.message_ids.filtered(lambda message: message.direction == 'out')
        self.assertEqual((message.body, message.automated, message.author_id), ('We are away', True, self.env['res.users']))
        # The delivery runs the automation 31 seconds ahead (the echo settle time); the outbox sends it right after.
        message.next_attempt_at = fields.Datetime.now() - timedelta(seconds=1)
        with patch.object(tiktok, 'send_text', return_value='msg-away-1') as send_text:
            self.run_outbox()
        self.assertEqual(send_text.call_args.args[1:3], (tt.CONVERSATION_ID, 'We are away'))
        self.assertEqual((message.delivery_state, message.provider_message_id), ('sent', 'msg-away-1'))
        self.assertTrue(conversation.away_sent_at)

    def test_the_survey_is_a_button_card_and_a_click_records_the_score(self):
        self.tiktok.write({'csat_enabled': True})
        self.conversation._liwan_send_csat_survey()
        with patch.object(tiktok, 'send_buttons', return_value='msg-csat-1') as send_buttons:
            self.run_outbox()
        _credentials, conversation_id, title, buttons = send_buttons.call_args.args
        self.assertEqual((conversation_id, title), (tt.CONVERSATION_ID, self.tiktok.csat_question))
        self.assertEqual([button.id for button in buttons], ['csat_good', 'csat_neutral', 'csat_bad'])
        address = self.conversation.identity_id.address
        self.deliver(tt.inbound(
            'text', {'body': 'Excellent'}, message_id='msg-click-csat',
            from_user={'id': address, 'role': 'personal_account'}, **{'from': address},
            referenced_message_info={'referenced_message_id': 'msg-csat-1'},
            reply_source_payload={'reply_source_msg_id': 'msg-csat-1', 'reply_source_unique_id': 'csat_good'},
        ))
        self.conversation.invalidate_recordset(['csat_score', 'csat_at'])
        self.assertEqual(self.conversation.csat_score, 'good')
