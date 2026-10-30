# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
from unittest.mock import patch

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import LiwanInboxCase
from odoo.addons.liwan_inbox.adapters import whatsapp
from odoo.addons.liwan_inbox.models.constants import REPLY_WINDOW


@tagged('post_install', '-at_install', 'liwan')
class TestEventProcessing(LiwanInboxCase):

    def deliver(self, data):
        event = self.env['liwan.inbox.event'].create({
            'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': json.dumps(data),
        })
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
        self.assertEqual(conversation.reply_window_ends_at - conversation.last_inbound_at, REPLY_WINDOW)
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
        with patch.object(whatsapp, 'fetch_media', side_effect=whatsapp.ProviderError('gone', retryable=False)):
            event = self.deliver(wa.inbound_media(kind='audio'))
        message = self.message('wamid.IMG1')
        self.assertEqual((event.state, message.body, message.error), ('done', '[audio]', 'gone'))

    def test_a_broken_event_fails_and_is_retried_up_to_five_times(self):
        event = self.env['liwan.inbox.event'].create({
            'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': '{"entry": "x"',
        })
        for expected in range(1, 6):
            self.env['liwan.inbox.event']._liwan_run_events()
            self.assertEqual((event.state, event.attempts), ('failed', expected))
        self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual(event.attempts, 5)
        self.assertTrue(event.error)
