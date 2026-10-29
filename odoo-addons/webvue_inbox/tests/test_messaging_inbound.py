# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
import json
from pathlib import Path

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import BUSINESS_ACCOUNT_ID, MESSAGE_KEYS, PHONE_ID, WebVueInboxCase
from odoo.addons.webvue_inbox.adapters import whatsapp


def parsed(payload):
    return whatsapp.parse_events(payload, PHONE_ID, BUSINESS_ACCOUNT_ID)


@tagged('post_install', '-at_install', 'webvue')
class TestInboundParsing(WebVueInboxCase):
    """The webhook parser: every inbound type becomes a structured, readable message or a reaction."""

    def one(self, kind, block=None, **extra):
        events = parsed(wa.inbound_message(kind, block, **extra))
        self.assertEqual(len(events), 1)
        return events[0]

    def test_location(self):
        event = self.one('location', {'latitude': 24.7, 'longitude': 46.6, 'name': 'HQ', 'address': 'Riyadh'})
        self.assertEqual((event.kind, event.body, event.location), ('location', 'HQ', whatsapp.Location(24.7, 46.6, 'HQ', 'Riyadh')))
        bare = self.one('location', {'latitude': 24.7, 'longitude': 46.6})
        self.assertEqual(bare.body, '24.700000, 46.600000')

    def test_a_location_with_bad_coordinates_is_unsupported(self):
        for block in ({'latitude': 99, 'longitude': 0}, {'latitude': 'x', 'longitude': 0}, {}):
            event = self.one('location', block)
            self.assertEqual((event.kind, event.location), ('unsupported', None))

    def test_contacts_become_readable_text(self):
        event = self.one('contacts', None, contacts=[
            {'name': {'formatted_name': 'Ali Hassan'}, 'phones': [{'phone': '+966501234567'}, {'phone': '+966559999999'}]},
            {'name': {'formatted_name': 'No Phone'}},
        ])
        self.assertEqual((event.kind, event.body), ('contacts', 'Ali Hassan: +966501234567, +966559999999\nNo Phone'))

    def test_interactive_replies_keep_the_chosen_option(self):
        button = self.one('interactive', {'type': 'button_reply', 'button_reply': {'id': 'yes', 'title': 'Yes'}})
        self.assertEqual((button.kind, button.body, button.option), ('interactive', 'Yes', whatsapp.Option('yes', 'Yes')))
        row = self.one('interactive', {'type': 'list_reply', 'list_reply': {'id': 'mon', 'title': 'Monday', 'description': 'x'}})
        self.assertEqual((row.body, row.option), ('Monday', whatsapp.Option('mon', 'Monday')))

    def test_a_template_quick_reply_button_is_a_selected_option(self):
        event = self.one('button', {'payload': 'confirm', 'text': 'Confirm'})
        self.assertEqual((event.kind, event.body, event.option), ('interactive', 'Confirm', whatsapp.Option('confirm', 'Confirm')))

    def test_location_text_is_cut_to_the_contract_maximum(self):
        event = self.one('location', {'latitude': 1, 'longitude': 2, 'name': 'n' * 1500, 'address': 'a' * 1500})
        self.assertEqual((len(event.location.name), len(event.location.address)), (1000, 1000))

    def test_context_names_the_message_answered(self):
        event = self.one('text', {'body': 'yes'}, context={'from': '966', 'id': 'wamid.OUT'})
        self.assertEqual(event.context_id, 'wamid.OUT')
        self.assertIsNone(self.one('text', {'body': 'yes'}).context_id)

    def test_a_reaction_is_an_event_of_its_own_and_an_empty_one_removes(self):
        event = self.one('reaction', {'message_id': 'wamid.T', 'emoji': '❤️'})
        self.assertEqual(event, whatsapp.InboundReaction('966501112222', 'wamid.T', '❤️'))
        self.assertEqual(self.one('reaction', {'message_id': 'wamid.T'}).emoji, '')
        self.assertEqual(parsed(wa.inbound_message('reaction', {'emoji': '👍'})), [])

    def test_unknown_types_are_unsupported_with_a_readable_body(self):
        for kind in ('order', 'system', 'unsupported', 'ephemeral', 'something_new'):
            event = self.one(kind, {'x': 1})
            self.assertEqual((event.kind, event.body), ('unsupported', '[unsupported]'))

    def test_media_kinds_and_text_are_unchanged(self):
        sticker = self.one('sticker', {'id': 'm1', 'mime_type': 'image/webp'})
        self.assertEqual((sticker.kind, sticker.media_id), ('sticker', 'm1'))
        self.assertEqual(self.one('text', {'body': 'hi'}).body, 'hi')


@tagged('post_install', '-at_install', 'webvue')
class TestInboundIngestion(WebVueInboxCase):

    def deliver(self, data):
        event = self.env['webvue.inbox.event'].create({
            'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id, 'payload': json.dumps(data),
        })
        self.env['webvue.inbox.event']._webvue_run_events()
        return event

    def message(self, provider_id):
        return self.env['webvue.inbox.message'].search([('provider_message_id', '=', provider_id)])

    def test_location_is_stored_structured(self):
        self.deliver(wa.inbound_message('location', {'latitude': 24.7, 'longitude': 46.6, 'name': 'HQ', 'address': 'Riyadh'}, provider_id='wamid.LOC'))
        message = self.message('wamid.LOC')
        self.assertEqual((message.kind, message.latitude, message.longitude, message.location_name, message.location_address), ('location', 24.7, 46.6, 'HQ', 'Riyadh'))

    def test_a_reply_context_resolves_to_the_message_of_the_same_conversation(self):
        self.deliver(wa.inbound_text('wamid.FIRST'))
        first = self.message('wamid.FIRST')
        out = self.env['webvue.inbox.message'].create({
            'conversation_id': first.conversation_id.id, 'direction': 'out', 'body': 'Question?', 'delivery_state': 'sent',
            'provider_message_id': 'wamid.OUTQ',
        })
        self.deliver(wa.inbound_message('text', {'body': 'Answer'}, provider_id='wamid.ANS', context={'id': 'wamid.OUTQ'}))
        self.assertEqual(self.message('wamid.ANS').reply_to_id, out)
        self.deliver(wa.inbound_message('text', {'body': 'Lost'}, provider_id='wamid.LOST', context={'id': 'wamid.UNKNOWN'}))
        self.assertFalse(self.message('wamid.LOST').reply_to_id)

    def test_an_interactive_reply_stores_the_option(self):
        self.deliver(wa.inbound_message('interactive', {'type': 'button_reply', 'button_reply': {'id': 'yes', 'title': 'Yes'}}, provider_id='wamid.BTN'))
        message = self.message('wamid.BTN')
        self.assertEqual((message.kind, message.selected_option_id, message.selected_option_title), ('interactive', 'yes', 'Yes'))

    def test_contacts_and_unsupported_are_stored_readable(self):
        self.deliver(wa.inbound_message('contacts', None, provider_id='wamid.CT', contacts=[{'name': {'formatted_name': 'Ali'}, 'phones': [{'phone': '+966'}]}]))
        self.deliver(wa.inbound_message('order', {}, provider_id='wamid.OR'))
        self.assertEqual((self.message('wamid.CT').kind, self.message('wamid.CT').body), ('contacts', 'Ali: +966'))
        self.assertEqual((self.message('wamid.OR').kind, self.message('wamid.OR').body), ('unsupported', '[unsupported]'))

    def test_a_customer_reaction_updates_the_target_and_creates_no_message(self):
        self.deliver(wa.inbound_text('wamid.TARGET'))
        target = self.message('wamid.TARGET')
        before = self.env['webvue.inbox.message'].search_count([])
        unread_before = target.conversation_id.unread
        target.conversation_id.unread = False
        self.deliver(wa.inbound_message('reaction', {'message_id': 'wamid.TARGET', 'emoji': '👍'}, provider_id='wamid.RX1'))
        self.assertEqual(target.customer_reaction, '👍')
        self.assertEqual(self.env['webvue.inbox.message'].search_count([]), before)
        self.assertFalse(target.conversation_id.unread, 'a reaction does not mark the conversation unread')
        self.deliver(wa.inbound_message('reaction', {'message_id': 'wamid.TARGET', 'emoji': '😂'}, provider_id='wamid.RX2'))
        self.assertEqual(target.customer_reaction, '😂')
        self.deliver(wa.inbound_message('reaction', {'message_id': 'wamid.TARGET'}, provider_id='wamid.RX3'))
        self.assertFalse(target.customer_reaction)
        self.assertTrue(unread_before)

    def test_a_reaction_of_another_channel_is_ignored(self):
        other = self.make_channel(phone_id='100000000077')
        conversation = self.make_conversation(channel=other)
        target = conversation.message_ids[0]
        target.provider_message_id = 'wamid.OTHERCH'
        self.deliver(wa.inbound_message('reaction', {'message_id': 'wamid.OTHERCH', 'emoji': '👍'}))
        self.assertFalse(target.customer_reaction)


@tagged('post_install', '-at_install', 'webvue')
class TestMessageSerializer(WebVueInboxCase):
    """The message shape carries every key of the contract, filled per kind."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation()

    def messages(self):
        self.login(self.agent)
        items = self.get(f'/api/v1/inbox/conversations/{self.conversation.id}/messages').json()['items']
        return {item['id']: item for item in items}

    def test_a_plain_message_has_empty_optional_members(self):
        item = next(iter(self.messages().values()))
        self.assertEqual(set(item), MESSAGE_KEYS)
        self.assertEqual(
            (item['kind'], item['reply_to'], item['reactions'], item['location'], item['interactive'], item['selected_option']),
            ('text', None, {'customer': None, 'agent': None}, None, None, None),
        )

    def test_every_member_is_filled_for_a_rich_message(self):
        Message = self.env['webvue.inbox.message']
        target = self.conversation.message_ids[0]
        message = Message.create({
            'conversation_id': self.conversation.id, 'direction': 'in', 'kind': 'location', 'body': 'HQ',
            'delivery_state': 'received', 'reply_to_id': target.id, 'customer_reaction': '👍', 'agent_reaction': '❤️',
            'latitude': 24.7136, 'longitude': 46.6753, 'location_name': 'HQ',
            'selected_option_id': 'yes', 'selected_option_title': 'Yes',
        })
        item = self.messages()[message.id]
        self.assertEqual(set(item), MESSAGE_KEYS)
        self.assertEqual(item['reply_to'], {'id': target.id, 'preview': target.body})
        self.assertEqual(item['reactions'], {'customer': '👍', 'agent': '❤️'})
        self.assertEqual(item['location'], {'latitude': 24.7136, 'longitude': 46.6753, 'name': 'HQ', 'address': None})
        self.assertEqual(item['selected_option'], {'id': 'yes', 'title': 'Yes'})

    def test_the_reply_preview_is_the_first_80_characters_on_one_line(self):
        long = self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'in', 'body': 'word\n' * 40, 'delivery_state': 'received',
        })
        reply = self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'a', 'delivery_state': 'sent', 'reply_to_id': long.id,
        })
        preview = self.messages()[reply.id]['reply_to']['preview']
        self.assertEqual((len(preview), '\n' in preview), (80, False))


@tagged('post_install', '-at_install', 'webvue')
class TestKindMigration(WebVueInboxCase):
    """The 19.0.1.1.0 post-migration derives `kind` for messages stored before the field existed."""

    def test_old_rows_get_the_kind_their_content_shows(self):
        spec = importlib.util.spec_from_file_location(
            'post_message_kinds', Path(__file__).parents[1] / 'migrations' / '19.0.1.1.0' / 'post-message-kinds.py',
        )
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        conversation = self.make_conversation()
        Message = self.env['webvue.inbox.message']

        def old(body, direction='in', **values):
            return Message.create({
                'conversation_id': conversation.id, 'direction': direction, 'body': body,
                'delivery_state': 'received' if direction == 'in' else 'sent', **values,
            })

        captioned = old('Look at this')
        self.env['ir.attachment'].create({
            'name': 'a.mp4', 'raw': b'x', 'mimetype': 'video/mp4', 'res_model': Message._name, 'res_id': captioned.id,
        })
        outbound_pdf = old('Invoice', 'out')
        self.env['ir.attachment'].create({
            'name': 'a.pdf', 'raw': b'x', 'mimetype': 'application/pdf', 'res_model': Message._name, 'res_id': outbound_pdf.id,
        })
        expected = {
            captioned: 'video', outbound_pdf: 'document', old('[sticker]'): 'sticker', old('[contacts]'): 'contacts',
            old('[button]'): 'interactive', old('[interactive]'): 'interactive', old('[location]'): 'unsupported',
            old('Hi {{1}}', 'out', template_name='t'): 'template', old('plain text'): 'text',
        }
        migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual({message: message.kind for message in expected}, expected)
