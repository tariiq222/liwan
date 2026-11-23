# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""TikTok inbound: the message kinds, the conversation they create, media and reactions."""
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from . import tiktok_payloads as tt
from .common import LiwanInboxCase, tiktok_grant
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.models.constants import (
    INBOX_FEATURE,
    REPLY_WINDOWS,
    TIKTOK_ECHO_SETTLE,
)
from odoo.addons.liwan_inbox.models.inbound_tiktok import NOTE_TIKTOK_AUTO_WELCOME
from odoo.addons.liwan_inbox.serializers import conversation as conversation_dump
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

ACCESS_TOKEN = 'tiktok-access-token-1'
REFRESH_TOKEN = 'tiktok-refresh-token-1'
INBOUND_LOGGER = 'odoo.addons.liwan_inbox.models.inbound_tiktok'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokInbound(LiwanInboxCase):
    """One connected business account receives the customer's messages and turns them into one conversation."""

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=INBOX_FEATURE, enabled=True)
        self.tiktok = self.make_tiktok_channel(
            authorization=tiktok_grant(access_token=ACCESS_TOKEN, refresh_token=REFRESH_TOKEN),
        )
        capability = patch.object(tiktok, 'image_send_capable', return_value=True)
        capability.start()
        self.addCleanup(capability.stop)

    def deliver(self, payload):
        """Deliver one webhook payload and process it on the next cron run, after the echo settle time."""
        event = self.store_event(self.tiktok, payload)
        later = fields.Datetime.now() + TIKTOK_ECHO_SETTLE + timedelta(seconds=1)
        with patch('odoo.fields.Datetime.now', return_value=later):
            self.env['liwan.inbox.event']._liwan_run_events()
        return event

    def message(self, provider_id):
        return self.env['liwan.inbox.message'].search([('provider_message_id', '=', provider_id)])

    def test_text(self):
        event = self.deliver(tt.receive_text())
        self.assertEqual((event.state, event.attempts), ('done', 0))
        message = self.message('msg-text-1')
        conversation = message.conversation_id
        self.assertEqual(
            (message.direction, message.kind, message.body, message.delivery_state),
            ('in', 'text', 'Hello from TikTok', 'received'),
        )
        self.assertEqual(
            (conversation.provider_conversation_id, conversation.image_send_capable),
            (tt.CONVERSATION_ID, True),
        )
        self.assertEqual((conversation.identity_id.channel_kind, conversation.identity_id.address), ('tiktok', tt.SENDER_ID))
        self.assertEqual((conversation.contact_id.name, conversation.contact_id.phone), (tt.SENDER_NAME, False))
        self.assertEqual((conversation.state, conversation.unread), ('open', True))
        self.assertEqual(conversation.last_message_preview, 'Hello from TikTok')
        self.assertEqual(
            conversation.reply_window_ends_at - conversation.last_inbound_at, REPLY_WINDOWS['tiktok'],
        )

    def test_duplicate(self):
        self.deliver(tt.receive_text())
        self.deliver(tt.receive_text())
        self.assertEqual(len(self.message('msg-text-1')), 1)
        self.assertEqual(self.env['liwan.inbox.contact'].search_count([('name', '=', tt.SENDER_NAME)]), 1)
        self.assertEqual(
            self.env['liwan.inbox.conversation'].search_count([('provider_conversation_id', '=', tt.CONVERSATION_ID)]), 1,
        )

    def test_image(self):
        media = tiktok.Media(content=b'jpeg-bytes', mimetype='image/jpeg')
        with mute_logger(INBOUND_LOGGER), patch.object(
            tiktok, 'image_send_capable', side_effect=errors.ProviderError('no capability', retryable=False),
        ), patch.object(tiktok, 'fetch_media', return_value=media) as fetch:
            self.deliver(tt.receive_image())
        message = self.message('msg-image-1')
        self.assertEqual((message.kind, message.body), ('image', '[image]'))
        self.assertFalse(message.conversation_id.image_send_capable)
        attachment = self.env['ir.attachment'].search([
            ('res_model', '=', 'liwan.inbox.message'), ('res_id', '=', message.id),
        ])
        self.assertEqual(
            (len(attachment), attachment.mimetype, attachment.raw, attachment.name),
            (1, 'image/jpeg', b'jpeg-bytes', 'image'),
        )
        credentials, conversation_id, message_id, media_id, media_type = fetch.call_args.args
        self.assertEqual(credentials.business_id, tt.BUSINESS_ID)
        self.assertEqual(
            (conversation_id, message_id, media_id, media_type),
            (tt.CONVERSATION_ID, 'msg-image-1', 'media-image-1', 'IMAGE'),
        )

    def test_media_failure(self):
        with mute_logger(INBOUND_LOGGER), patch.object(
            tiktok, 'fetch_media', side_effect=errors.ProviderError('media gone', retryable=False),
        ):
            event = self.deliver(tt.receive_image())
        message = self.message('msg-image-1')
        self.assertEqual(event.state, 'done')
        self.assertEqual(message.error, 'media gone')
        self.assertFalse(self.env['ir.attachment'].search([
            ('res_model', '=', 'liwan.inbox.message'), ('res_id', '=', message.id),
        ]))

    def test_share_post(self):
        self.deliver(tt.receive_share_post())
        message = self.message('msg-share-1')
        self.assertEqual((message.kind, message.body), ('text', 'https://www.tiktok.com/player/v1/7234567890123456789'))

    def test_sticker(self):
        self.deliver(tt.receive_sticker())
        message = self.message('msg-sticker-1')
        self.assertEqual((message.kind, message.body), ('sticker', 'https://cdn.tiktok.com/sticker/1.webp?x-expires=1790000000'))
        self.assertFalse(self.env['ir.attachment'].search([
            ('res_model', '=', 'liwan.inbox.message'), ('res_id', '=', message.id),
        ]))

    def test_button_click_records_csat_score(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'kind': 'interactive', 'interactive_type': 'buttons', 'body': 'How was your experience?',
            'automated': True, 'delivery_state': 'sent', 'provider_message_id': 'msg-survey-1',
            'option_ids': [(0, 0, {'sequence': 0, 'option_id': 'csat_good', 'title': 'Good'})],
        })
        self.deliver(tt.receive_button_click(option_id='csat_good', source_message_id='msg-survey-1'))
        message = self.message('msg-click-1')
        self.assertEqual((message.selected_option_id, message.selected_option_title), ('csat_good', 'Good'))
        self.assertEqual((conversation.csat_score, conversation.csat_at), ('good', message.date))

    def test_a_click_resolves_the_button_of_its_own_card(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        for provider_id, title in (('msg-card-1', 'Yes'), ('msg-card-2', 'Delivery')):
            self.env['liwan.inbox.message'].create({
                'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
                'kind': 'interactive', 'interactive_type': 'buttons', 'body': 'Which one?',
                'automated': True, 'delivery_state': 'sent', 'provider_message_id': provider_id,
                'option_ids': [(0, 0, {'sequence': 0, 'option_id': 'btn_1', 'title': title})],
            })
        self.deliver(tt.receive_button_click(option_id='btn_1', source_message_id='msg-card-2'))
        message = self.message('msg-click-1')
        self.assertEqual(message.selected_option_title, 'Delivery')

    def test_reaction_add_and_remove(self):
        self.deliver(tt.receive_text())
        target = self.message('msg-text-1')
        conversation = target.conversation_id
        conversation.unread = False
        messages = self.env['liwan.inbox.message'].search_count([('conversation_id', '=', conversation.id)])
        self.deliver(tt.receive_reaction())
        self.assertEqual(target.customer_reaction, '👍')
        self.assertEqual(self.env['liwan.inbox.message'].search_count([('conversation_id', '=', conversation.id)]), messages)
        self.assertFalse(conversation.unread)
        self.deliver(tt.receive_reaction(operation='REMOVE'))
        self.assertFalse(target.customer_reaction)

    # echoes, reads and referrals

    def test_an_echo_of_a_liwan_reply_is_not_duplicated(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        sent = self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'body': 'Replied from LiwanOS', 'delivery_state': 'sent', 'provider_message_id': 'msg-echo-1',
        })
        used = self.env['liwan.inbox.message']._liwan_count_outbound_this_month()
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.messages_out': used}})
        event = self.deliver(tt.send_echo())
        self.assertEqual(event.state, 'done')
        self.assertEqual(len(self.message('msg-echo-1')), 1)
        self.assertEqual(sent.delivery_state, 'sent')
        self.assertEqual(
            self.env['liwan.inbox.message'].search_count([
                ('conversation_id', '=', conversation.id), ('direction', '=', 'out'),
            ]), 1,
        )

    def test_an_echo_is_stored_and_not_counted_when_the_monthly_limit_is_reached(self):
        self.deliver(tt.receive_text())
        Message = self.env['liwan.inbox.message']
        used = Message._liwan_count_outbound_this_month()
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.messages_out': used}})
        event = self.deliver(tt.send_echo(body='Sent from the TikTok app', message_id='msg-echo-3'))
        self.assertEqual(event.state, 'done')
        message = self.message('msg-echo-3')
        self.assertEqual((message.direction, message.external), ('out', True))
        self.assertEqual(Message._liwan_count_outbound_this_month(), used)

    def test_an_external_message_cannot_be_queued(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        with self.assertRaises(ValidationError):
            self.env['liwan.inbox.message'].create({
                'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
                'body': 'Reply', 'delivery_state': 'queued', 'external': True,
            })

    def test_a_reply_sent_by_liwan_cannot_become_external(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        reply = self.env['liwan.inbox.message'].create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'body': 'Reply', 'delivery_state': 'sent', 'author_id': self.env.user.id,
        })
        with self.assertRaises(ValidationError):
            reply.write({'external': True})

    def test_a_reply_sent_by_liwan_is_still_refused_at_the_monthly_limit(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        Message = self.env['liwan.inbox.message']
        used = Message._liwan_count_outbound_this_month()
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.messages_out': used}})
        with self.assertRaises(LiwanAccessRule):
            Message.create({
                'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
                'body': 'Reply', 'delivery_state': 'queued',
            })

    def test_an_echo_from_the_tiktok_app_is_stored_without_an_author(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        self.deliver(tt.send_echo(body='Sent from the TikTok app', message_id='msg-echo-2'))
        message = self.message('msg-echo-2')
        self.assertEqual(
            (message.direction, message.body, message.delivery_state), ('out', 'Sent from the TikTok app', 'sent'),
        )
        self.assertFalse(message.author_id)
        self.assertFalse(message.automated)
        self.assertTrue(conversation.unread)

    def test_an_image_echo_from_the_tiktok_app_keeps_its_media(self):
        self.deliver(tt.receive_text())
        media = tiktok.Media(content=b'jpeg-bytes', mimetype='image/jpeg')
        with patch.object(tiktok, 'fetch_media', return_value=media) as fetch:
            self.deliver(tt.send_echo(message_id='msg-echo-image', kind='image', fields={'media_id': 'media-image-1'}))
        message = self.message('msg-echo-image')
        attachment = self.env['ir.attachment'].search([('res_model', '=', 'liwan.inbox.message'), ('res_id', '=', message.id)])
        self.assertEqual((message.direction, message.kind, message.external), ('out', 'image', True))
        self.assertEqual((len(attachment), attachment.mimetype, attachment.raw), (1, 'image/jpeg', b'jpeg-bytes'))
        self.assertEqual(fetch.call_args.args[2:], ('msg-echo-image', 'media-image-1', 'IMAGE'))

    def test_a_media_echo_that_cannot_be_fetched_is_recorded_and_still_stored(self):
        self.deliver(tt.receive_text())
        with mute_logger(INBOUND_LOGGER), patch.object(
            tiktok, 'fetch_media', side_effect=errors.ProviderError('media gone', retryable=False),
        ):
            event = self.deliver(tt.send_echo(message_id='msg-echo-gone', kind='image', fields={'media_id': 'media-image-1'}))
        message = self.message('msg-echo-gone')
        self.assertEqual((event.state, message.error, message.external), ('done', 'media gone', True))

    def test_a_tiktok_auto_welcome_echo_is_stored_with_a_note(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        self.deliver(tt.send_auto_welcome())
        message = self.message('msg-welcome-1')
        notes = conversation.message_ids.filtered(lambda message: message.direction == 'note')
        self.assertEqual((message.direction, message.body), ('out', 'Welcome to the shop'))
        self.assertFalse(message.author_id)
        self.assertEqual((len(notes), notes.body), (1, NOTE_TIKTOK_AUTO_WELCOME))
        self.assertFalse(notes.author_id)

    def test_young_events_wait(self):
        self.deliver(tt.receive_text())
        event = self.store_event(self.tiktok, tt.send_echo(message_id='msg-echo-young'))
        self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual((event.state, len(self.message('msg-echo-young'))), ('pending', 0))
        with patch('odoo.fields.Datetime.now', return_value=fields.Datetime.now() + TIKTOK_ECHO_SETTLE):
            self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual((event.state, len(self.message('msg-echo-young'))), ('done', 1))

    def test_a_customer_read_marks_earlier_outbound_read(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        inbound_at = conversation.last_inbound_at
        Message = self.env['liwan.inbox.message']
        older = Message.create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'body': 'Earlier', 'delivery_state': 'delivered', 'provider_message_id': 'msg-out-old',
            'date': inbound_at - timedelta(minutes=1),
        })
        newer = Message.create({
            'conversation_id': conversation.id, 'company_id': conversation.company_id.id, 'direction': 'out',
            'body': 'Later', 'delivery_state': 'sent', 'provider_message_id': 'msg-out-new',
            'date': inbound_at + timedelta(minutes=1),
        })
        self.deliver(tt.mark_read())
        self.assertEqual((older.delivery_state, newer.delivery_state), ('read', 'sent'))
        self.deliver(tt.mark_read(last_read_timestamp=tt.SENT_AT + 120_000))
        self.assertEqual(newer.delivery_state, 'read')

    def test_referral_is_stored_on_the_conversation(self):
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        count = self.env['liwan.inbox.message'].search_count([('conversation_id', '=', conversation.id)])
        self.deliver(tt.referral('ad'))
        self.assertEqual((conversation.referral_source, conversation.referral_ref), ('ad', 'ad-1'))
        self.deliver(tt.referral('short_link', ref='campaign_1'))
        self.assertEqual((conversation.referral_source, conversation.referral_ref), ('short_link', 'campaign_1'))
        self.assertEqual(self.env['liwan.inbox.message'].search_count([('conversation_id', '=', conversation.id)]), count)

    def referral_conversations(self, channel=None):
        return self.env['liwan.inbox.conversation'].search([
            ('channel_id', '=', (channel or self.tiktok).id), ('provider_conversation_id', '=', tt.CONVERSATION_ID),
        ])

    def test_a_referral_before_the_first_message_opens_the_conversation(self):
        """The ad the customer came from is kept even when its event arrives first; the message then joins that conversation."""
        self.deliver(tt.referral('ad'))
        conversation = self.referral_conversations()
        self.assertEqual((len(conversation), conversation.referral_source, conversation.referral_ref), (1, 'ad', 'ad-1'))
        self.assertEqual(conversation.message_ids, self.env['liwan.inbox.message'])
        self.assertIsNone(conversation_dump.dump_conversation(conversation)['last_message_preview'])
        self.deliver(tt.receive_text())
        self.assertEqual(self.message('msg-text-1').conversation_id, conversation)
        self.assertEqual((conversation.referral_source, conversation.referral_ref), ('ad', 'ad-1'))
        self.assertEqual(self.env['liwan.inbox.conversation'].search_count([('channel_id', '=', self.tiktok.id)]), 1)

    def test_a_redelivered_referral_opens_one_conversation(self):
        self.deliver(tt.referral('ad'))
        self.deliver(tt.referral('ad'))
        self.assertEqual(len(self.referral_conversations()), 1)
        self.assertEqual(self.env['liwan.inbox.contact'].search_count([('name', '=', tt.SENDER_NAME)]), 1)

    def test_a_referral_before_the_message_in_one_delivery_ends_in_one_conversation(self):
        items = [*tiktok.parse_event(tt.referral('short_link', ref='campaign_1'), tt.BUSINESS_ID), *tiktok.parse_event(tt.receive_text(), tt.BUSINESS_ID)]
        for item in items:
            self.env['liwan.inbox.inbound']._liwan_ingest_tiktok(self.tiktok, [item])
        conversation = self.referral_conversations()
        self.assertEqual(len(conversation), 1)
        self.assertEqual(
            (conversation.referral_source, conversation.referral_ref, self.message('msg-text-1').conversation_id),
            ('short_link', 'campaign_1', conversation),
        )

    def test_a_referral_matches_only_the_conversations_of_its_own_channel(self):
        other_company = self.env['res.company'].create({'name': 'Other TikTok company'})
        other = self.make_tiktok_channel(business_id='other-business-open-id', owner_company_id=other_company.id)
        for item in tiktok.parse_event(tt.receive_text(), tt.BUSINESS_ID):
            self.env['liwan.inbox.inbound']._liwan_ingest_tiktok(other, [item])
        foreign = self.referral_conversations(other)
        self.assertEqual(len(foreign), 1)
        self.deliver(tt.referral('ad'))
        own = self.referral_conversations()
        self.assertEqual((len(own), own == foreign, own.company_id), (1, False, self.env.company))
        self.assertFalse(foreign.referral_source)

    def test_a_referral_opened_conversation_acts_as_no_customer_message(self):
        """Nothing is sent, counted or timed until the customer writes; then the conversation behaves as a new one."""
        self.deliver(tt.referral('ad'))
        conversation = self.referral_conversations()
        self.assertEqual(
            (conversation.unread, conversation.waiting_since, conversation.last_inbound_at, conversation.message_ids),
            (False, False, False, self.env['liwan.inbox.message']),
        )
        self.assertFalse(self.env['liwan.inbox.conversation.cycle'].search([('conversation_id', '=', conversation.id)]))
        self.deliver(tt.receive_text())
        self.assertTrue(conversation.unread)
        self.assertEqual(len(self.env['liwan.inbox.conversation.cycle'].search([('conversation_id', '=', conversation.id)])), 1)
        self.assertTrue(conversation.waiting_since)

    def test_the_image_capability_is_probed_at_the_first_message_of_a_referral_conversation(self):
        with patch.object(
            tiktok, 'image_send_capable', side_effect=errors.ProviderError('not yet', retryable=False),
        ) as probe:
            self.deliver(tt.referral('ad'))
        self.assertEqual(probe.call_count, 0)
        conversation = self.referral_conversations()
        self.assertFalse(conversation.image_send_capable)
        self.deliver(tt.receive_text())
        self.assertTrue(conversation.image_send_capable)

    def test_a_note_before_the_first_customer_message_does_not_skip_the_image_probe(self):
        self.deliver(tt.referral('ad'))
        conversation = self.referral_conversations()
        self.env['liwan.inbox.message']._liwan_post_note(conversation, 'checked the ad')
        self.assertFalse(conversation.image_send_capable)
        self.deliver(tt.receive_text())
        self.assertTrue(conversation.image_send_capable)

    def test_a_stored_referral_is_dumped_on_the_conversation(self):
        """The conversation dump carries the referral, so the workspace can show where the customer came from (D9)."""
        self.deliver(tt.receive_text())
        conversation = self.message('msg-text-1').conversation_id
        dump = conversation_dump.dump_conversation(conversation)
        self.assertIsNone(dump['referral_source'])
        self.assertIsNone(dump['referral_ref'])
        self.deliver(tt.referral('short_link', ref='campaign_1'))
        dump = conversation_dump.dump_conversation(conversation)
        self.assertEqual((dump['referral_source'], dump['referral_ref']), ('short_link', 'campaign_1'))

    def test_an_eu_notice_queues_a_history_import(self):
        """TikTok sends no content for an EEA, Swiss or UK sender: the notice imports that history instead (D8)."""
        Sync = self.env['liwan.inbox.tiktok.sync']
        self.assertFalse(Sync.search([('channel_id', '=', self.tiktok.id)]))
        event = self.deliver(tt.eu_notice())
        self.assertEqual((event.state, event.attempts), ('done', 0))
        job = Sync.search([('channel_id', '=', self.tiktok.id)])
        self.assertEqual(len(job), 1)
        self.assertEqual((job.state, job.owner_company_id), ('queued', self.tiktok.owner_company_id))
        self.assertFalse(self.env['liwan.inbox.conversation'].search_count([]))
        # An import already queued reads the same messages: a second notice is a replay, so it stores no event
        # and starts nothing, and raises nothing.
        self.assertFalse(self.deliver(tt.eu_notice()))
        self.assertEqual(len(Sync.search([('channel_id', '=', self.tiktok.id)])), 1)
