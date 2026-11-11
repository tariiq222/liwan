# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import PHONE_ID, LiwanInboxCase
from odoo.addons.liwan_inbox.adapters import errors, whatsapp
from odoo.addons.liwan_inbox.models.constants import MAX_ATTEMPTS, REPLY_WINDOWS
from odoo.addons.liwan_inbox.models.health_constants import HEALTH_KIND
from odoo.addons.liwan_inbox.models.inbound_service import LiwanInboxInbound


@tagged('post_install', '-at_install', 'liwan')
class TestEventProcessing(LiwanInboxCase):

    def deliver(self, data):
        event = self.store_event(self.channel, data)
        self.env['liwan.inbox.event']._liwan_run_events()
        return event

    def message(self, provider_id):
        return self.env['liwan.inbox.message'].search([('provider_message_id', '=', provider_id)])

    def test_an_inbound_text_creates_contact_identity_conversation_and_message(self):
        self.channel.department_id = self.department
        event = self.deliver(wa.inbound_text())
        self.assertEqual((event.state, event.attempts), ('done', 0))
        message = self.message('wamid.IN1')
        conversation = message.conversation_id
        self.assertEqual((message.direction, message.body, message.delivery_state), ('in', 'Hello', 'received'))
        self.assertEqual((conversation.state, conversation.unread, conversation.department_id), ('open', True, self.department))
        self.assertEqual((conversation.contact_id.name, conversation.contact_id.phone), ('Sara', '+966501112222'))
        self.assertEqual(conversation.identity_id.address, '966501112222')
        self.assertEqual(conversation.last_message_preview, 'Hello')
        self.assertEqual(conversation.reply_window_ends_at - conversation.last_inbound_at, REPLY_WINDOWS['whatsapp'])
        self.assertTrue(self.channel.last_event_at)

    def test_a_duplicate_delivery_creates_nothing_new(self):
        self.deliver(wa.inbound_text())
        self.deliver(wa.inbound_text())
        self.assertEqual(len(self.message('wamid.IN1')), 1)
        self.assertEqual(self.env['liwan.inbox.contact'].search_count([('phone', '=', '+966501112222')]), 1)

    def test_a_second_message_joins_the_open_conversation_and_reopens_a_resolved_one(self):
        self.deliver(wa.inbound_text())
        conversation = self.message('wamid.IN1').conversation_id
        conversation.state = 'resolved'
        self.deliver(wa.inbound_text('wamid.IN2', body='Still there?'))
        self.assertEqual(self.message('wamid.IN2').conversation_id, conversation)
        self.assertEqual(conversation.state, 'open')

    def test_a_message_after_close_opens_a_new_conversation(self):
        self.deliver(wa.inbound_text())
        first = self.message('wamid.IN1').conversation_id
        first.state = 'closed'
        self.deliver(wa.inbound_text('wamid.IN2'))
        second = self.message('wamid.IN2').conversation_id
        self.assertNotEqual(second, first)
        self.assertEqual(second.contact_id, first.contact_id)

    def test_a_later_status_event_updates_the_delivery_state_and_never_goes_back(self):
        conversation = self.make_conversation()
        outbound = self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'direction': 'out', 'body': 'x', 'delivery_state': 'sent',
            'provider_message_id': 'wamid.OUT1',
        })
        self.deliver(wa.status('wamid.OUT1', 'read'))
        self.assertEqual(outbound.delivery_state, 'read')
        self.deliver(wa.status('wamid.OUT1', 'delivered'))
        self.assertEqual(outbound.delivery_state, 'read')
        self.deliver(wa.status('wamid.OUT1', 'failed', error='Message undeliverable'))
        self.assertEqual((outbound.delivery_state, outbound.error), ('failed', 'Message undeliverable'))

    def test_media_is_downloaded_into_an_attachment(self):
        media = whatsapp.Media(content=b'jpeg-bytes', mimetype='image/jpeg')
        with patch.object(whatsapp, 'fetch_media', return_value=media) as fetch:
            self.deliver(wa.inbound_media(caption='My receipt'))
        self.assertEqual(fetch.call_args.args[1], 'media-1')
        message = self.message('wamid.IMG1')
        self.assertEqual(message.body, 'My receipt')
        attachment = self.env['ir.attachment'].search([('res_model', '=', message._name), ('res_id', '=', message.id)])
        self.assertEqual((attachment.raw, attachment.mimetype), (b'jpeg-bytes', 'image/jpeg'))

    def test_a_media_failure_keeps_the_message_and_records_the_error(self):
        with patch.object(whatsapp, 'fetch_media', side_effect=errors.ProviderError('gone', retryable=False)):
            event = self.deliver(wa.inbound_media(kind='audio'))
        message = self.message('wamid.IMG1')
        self.assertEqual((event.state, message.body, message.error), ('done', '[audio]', 'gone'))

    def test_a_broken_event_fails_and_is_retried_up_to_five_times(self):
        event = self.store_event(self.channel, '{"entry": "x"')
        for expected in range(1, 6):
            self.env['liwan.inbox.event']._liwan_run_events()
            self.assertEqual((event.state, event.attempts), ('failed', expected))
        self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual(event.attempts, 5)
        self.assertTrue(event.error)

    def two_messages(self):
        raw = [
            {'id': provider_id, 'from': '966501112222', 'timestamp': str(wa.TIMESTAMP), 'type': 'text', 'text': {'body': 'Hi'}}
            for provider_id in ('wamid.GOOD', 'wamid.BAD')
        ]
        return wa.payload(PHONE_ID, contacts=[{'wa_id': '966501112222', 'profile': {'name': 'Sara'}}], messages=raw)

    def fail_bad_message(self):
        real = LiwanInboxInbound._liwan_ingest_message

        def ingest(model, channel, item):
            if item.provider_id == 'wamid.BAD':
                raise RuntimeError
            return real(model, channel, item)

        return patch.object(LiwanInboxInbound, '_liwan_ingest_message', ingest)

    def bells(self):
        return self.env['mail.message'].sudo().search([
            ('liwan_notification_kind', '=', HEALTH_KIND), ('model', '=', 'liwan.inbox.channel'), ('res_id', '=', self.channel.id),
        ])

    def test_a_bad_message_does_not_lose_the_good_one_of_its_payload(self):
        event = self.store_event(self.channel, self.two_messages())
        with self.fail_bad_message():
            self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual(len(self.message('wamid.GOOD')), 1)
        self.assertFalse(self.message('wamid.BAD'))
        self.assertEqual((event.state, event.attempts, event.error), ('failed', 1, 'item 2: RuntimeError'))

    def test_the_final_failure_rings_the_channel_managers_once(self):
        self.store_event(self.channel, self.two_messages())
        events = self.env['liwan.inbox.event']
        channel_model = type(self.env['liwan.inbox.channel'])
        with self.fail_bad_message(), patch.object(
            channel_model, '_liwan_notify_event_failed', autospec=True, side_effect=channel_model._liwan_notify_event_failed,
        ) as ring:
            for _ in range(MAX_ATTEMPTS - 1):
                events._liwan_run_events()
            self.assertFalse(self.bells())
            events._liwan_run_events()
            events._liwan_run_events()
        self.assertEqual(ring.call_count, 1)
        self.assertTrue(self.bells())
        self.assertEqual(set(self.bells().mapped('liwan_inbox_channel_id')), {self.channel.id})
