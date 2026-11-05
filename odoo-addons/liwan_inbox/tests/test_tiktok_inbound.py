# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""TikTok inbound: the message kinds, the conversation they create, media and reactions."""
import json
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged
from odoo.tools import mute_logger

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.models.constants import (
    REPLY_WINDOWS,
    TIKTOK_ECHO_SETTLE,
    TIKTOK_FEATURE,
)

ACCESS_TOKEN = 'tiktok-access-token-1'
REFRESH_TOKEN = 'tiktok-refresh-token-1'
INBOUND_LOGGER = 'odoo.addons.liwan_inbox.models.inbound_tiktok'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokInbound(LiwanInboxCase):
    """One connected business account receives the customer's messages and turns them into one conversation."""

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)
        self.tiktok = self.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': tt.BUSINESS_ID,
        })
        now = fields.Datetime.now()
        self.tiktok._liwan_tiktok_store(tiktok.TokenGrant(
            open_id=tt.BUSINESS_ID, scopes=frozenset(tiktok.SCOPES),
            access_token=ACCESS_TOKEN, refresh_token=REFRESH_TOKEN,
            expires_at=now + timedelta(days=1), refresh_expires_at=now + timedelta(days=365),
        ))
        capability = patch.object(tiktok, 'image_send_capable', return_value=True)
        capability.start()
        self.addCleanup(capability.stop)

    def deliver(self, payload):
        """Deliver one webhook payload as an event old enough to be processed now."""
        event = self.env['liwan.inbox.event'].create({
            'channel_id': self.tiktok.id, 'owner_company_id': self.tiktok.owner_company_id.id,
            'payload': json.dumps(payload), 'create_date': fields.Datetime.now() - TIKTOK_ECHO_SETTLE - timedelta(seconds=1),
        })
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
