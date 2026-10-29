# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged

from .common import MESSAGE_KEYS, WebVueInboxCase
from .media_samples import MP4, OGG, PDF, PNG
from odoo.addons.webvue_api.serializers.attachment import (
    MAX_ATTACHMENT_BYTES,
    MAX_ENCODED_CHARS,
)
from odoo.addons.webvue_inbox.adapters import media_rules, whatsapp

BUTTONS = {'type': 'buttons', 'body': 'Pick one', 'header': None, 'footer': None, 'buttons': [
    {'id': 'yes', 'title': 'Yes'}, {'id': 'no', 'title': 'No'},
]}
LIST = {'type': 'list', 'body': 'Pick a day', 'header': 'Days', 'footer': None, 'button': 'Choose', 'sections': [
    {'title': 'Weekdays', 'rows': [{'id': 'mon', 'title': 'Monday', 'description': 'Early'}, {'id': 'tue', 'title': 'Tuesday', 'description': None}]},
    {'title': 'Weekend', 'rows': [{'id': 'sat', 'title': 'Saturday', 'description': None}]},
]}
CTA = {'type': 'cta_url', 'body': 'Visit us', 'header': None, 'footer': 'Open daily', 'display_text': 'Open', 'url': 'https://example.com/a?b=1'}


@tagged('post_install', '-at_install', 'webvue')
class TestRepliesApi(WebVueInboxCase):
    """Every reply kind through POST /messages, and the upload that precedes a file reply."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation()
        cls.late = cls.make_conversation(minutes_ago=25 * 60)

    def setUp(self):
        super().setUp()
        self.login(self.agent)

    def path(self, suffix='', conversation=None):
        return f'/api/v1/inbox/conversations/{(conversation or self.conversation).id}{suffix}'

    def reply(self, payload, conversation=None):
        return self.api('POST', self.path('/messages', conversation), payload)

    def upload(self, name='a.png', content=PNG, mimetype='image/png', conversation=None, **overrides):
        payload = {'name': name, 'mimetype': mimetype, 'data': base64.b64encode(content).decode(), **overrides}
        return self.api('POST', self.path('/uploads', conversation), payload)

    def uploaded_id(self, **kwargs):
        response = self.upload(**kwargs)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def last_message(self):
        return self.env['webvue.inbox.message'].search([('conversation_id', '=', self.conversation.id)], order='id desc', limit=1)

    # upload

    def test_upload_stores_an_attachment_of_the_conversation_and_returns_its_shape(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(set(body), {'id', 'name', 'mimetype', 'size'})
        self.assertEqual((body['name'], body['mimetype'], body['size']), ('a.png', 'image/png', len(PNG)))
        attachment = self.env['ir.attachment'].browse(body['id'])
        self.assertEqual((attachment.res_model, attachment.res_id), ('webvue.inbox.conversation', self.conversation.id))

    def test_upload_accepts_each_kind_by_content_or_label(self):
        for name, data, mimetype, expected in (
            ('doc.pdf', PDF, 'application/pdf', 'application/pdf'),
            ('clip.mp4', MP4, 'video/mp4', 'video/mp4'),
            ('voice.ogg', OGG, 'audio/ogg', 'audio/ogg'),
            ('notes.txt', b'plain notes', 'text/plain', 'text/plain'),
        ):
            response = self.upload(name, data, mimetype)
            self.assertEqual((response.status_code, response.json().get('mimetype')), (201, expected), name)

    def test_upload_refuses_types_whatsapp_does_not_accept(self):
        self.assertError(self.upload('run.exe', b'MZ\x90\x00' + b'\x00' * 32, 'application/x-msdownload'), 422, 'invalid')
        self.assertError(self.upload('pic.gif', b'GIF89a' + b'\x00' * 32, 'image/gif'), 422, 'invalid')
        self.assertError(self.upload('fake.png', b'not an image at all', 'image/png'), 422, 'invalid')
        self.assertError(self.upload('empty.txt', b'', 'text/plain'), 422, 'invalid')

    def test_upload_validates_the_body(self):
        for bad in (
            {'data': '!!not base64!!'}, {'data': ''}, {'data': 5}, {'name': ''}, {'name': '../a.png'}, {'name': 'a/b.png'},
            {'name': 'x' * 256}, {'mimetype': ''}, {'mimetype': 5}, {'extra': 1},
        ):
            self.assertError(self.upload(**bad), 422, 'invalid')
        self.assertError(self.api('POST', self.path('/uploads'), {'name': 'a.png'}), 422, 'invalid')

    def test_upload_enforces_the_size_limit_of_each_kind(self):
        too_big_image = PNG + b'\x00' * media_rules.IMAGE_MAX_BYTES
        self.assertError(self.upload('big.png', too_big_image, 'image/png'), 413, 'payload_too_large')
        oversized = {'name': 'a.png', 'mimetype': 'image/png', 'data': 'A' * (MAX_ENCODED_CHARS + 4)}
        self.assertError(self.api('POST', self.path('/uploads'), oversized), 413, 'payload_too_large')
        with patch.dict(media_rules.MAX_BYTES, {'audio': 10}):
            self.assertError(self.upload('long.ogg', OGG, 'audio/ogg'), 413, 'payload_too_large')
        self.assertEqual(
            (media_rules.IMAGE_MAX_BYTES, media_rules.VIDEO_MAX_BYTES, media_rules.AUDIO_MAX_BYTES, media_rules.DOCUMENT_MAX_BYTES),
            (5 * 1024 * 1024, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES),
        )

    def test_upload_needs_the_reply_capability_and_a_visible_conversation(self):
        self.login(self.outsider)
        self.assertError(self.upload(), 403, 'forbidden')
        self.login(self.reader_only)
        self.assertError(self.upload(), 403, 'forbidden')
        self.login(self.agent)
        self.assertError(self.upload(conversation=self.env['webvue.inbox.conversation'].browse(999999999)), 404, 'not_found')
        self.settings.visibility_policy = 'assigned_only'
        self.assertError(self.upload(), 404, 'not_found')

    def test_upload_works_after_the_window_closed(self):
        self.assertEqual(self.upload(conversation=self.late).status_code, 201)

    def test_stale_uploads_are_purged_by_maintenance(self):
        upload_id = self.uploaded_id()
        used_id = self.uploaded_id(name='b.png')
        self.assertEqual(self.reply({'attachment_id': used_id}).status_code, 200)
        self.env['webvue.inbox.conversation']._webvue_purge_stale_uploads(fields.Datetime.now() + timedelta(days=2))
        self.assertFalse(self.env['ir.attachment'].browse(upload_id).exists())
        self.assertTrue(self.env['ir.attachment'].browse(used_id).exists())

    # text, files

    def test_text_with_reply_to_links_the_target(self):
        target = self.conversation.message_ids[0]
        target.provider_message_id = 'wamid.TARGET'
        result = self.reply({'body': 'Answer', 'reply_to_id': target.id})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), MESSAGE_KEYS)
        self.assertEqual((body['kind'], body['reply_to']), ('text', {'id': target.id, 'preview': target.body}))

    def test_reply_to_rules(self):
        other = self.make_conversation()
        foreign = other.message_ids[0]
        foreign.provider_message_id = 'wamid.FOREIGN'
        self.assertError(self.reply({'body': 'x', 'reply_to_id': foreign.id}), 422, 'invalid')
        self.assertError(self.reply({'body': 'x', 'reply_to_id': 999999999}), 422, 'invalid')
        undelivered = self.conversation.message_ids[0]
        self.assertError(self.reply({'body': 'x', 'reply_to_id': undelivered.id}), 422, 'invalid')

    def test_attachment_with_caption_becomes_a_message_with_the_file(self):
        attachment_id = self.uploaded_id()
        result = self.reply({'attachment_id': attachment_id, 'caption': 'Look'})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['kind'], body['body']), ('image', 'Look'))
        self.assertEqual([a['id'] for a in body['attachments']], [attachment_id])
        attachment = self.env['ir.attachment'].browse(attachment_id)
        self.assertEqual((attachment.res_model, attachment.res_id), ('webvue.inbox.message', body['id']))

    def test_attachment_without_caption_uses_the_placeholder_and_each_kind_is_detected(self):
        for name, data, mimetype, kind in (('d.pdf', PDF, 'application/pdf', 'document'), ('v.mp4', MP4, 'video/mp4', 'video'), ('a.ogg', OGG, 'audio/ogg', 'audio')):
            body = self.reply({'attachment_id': self.uploaded_id(name=name, content=data, mimetype=mimetype)}).json()
            self.assertEqual((body['kind'], body['body']), (kind, f'[{kind}]'))

    def test_attachment_rules(self):
        attachment_id = self.uploaded_id()
        other = self.make_conversation()
        self.assertError(self.reply({'attachment_id': attachment_id}, conversation=other), 422, 'invalid')
        self.assertEqual(self.reply({'attachment_id': attachment_id}).status_code, 200)
        self.assertError(self.reply({'attachment_id': attachment_id}), 422, 'invalid')
        self.assertError(self.reply({'attachment_id': 999999999}), 422, 'invalid')
        audio_id = self.uploaded_id(name='a.ogg', content=OGG, mimetype='audio/ogg')
        self.assertError(self.reply({'attachment_id': audio_id, 'caption': 'no captions on audio'}), 422, 'invalid')

    def test_location_reply(self):
        result = self.reply({'location': {'latitude': 24.7136, 'longitude': 46.6753, 'name': 'Office', 'address': None}})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['kind'], body['body']), ('location', 'Office'))
        self.assertEqual(body['location'], {'latitude': 24.7136, 'longitude': 46.6753, 'name': 'Office', 'address': None})
        for bad in ({'latitude': 91, 'longitude': 0}, {'latitude': 0, 'longitude': -181}, {'latitude': 'x', 'longitude': 0}, {'latitude': 0}):
            self.assertError(self.reply({'location': bad}), 422, 'invalid')

    def test_buttons_reply_round_trips_the_contract_shape(self):
        result = self.reply({'interactive': BUTTONS})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['kind'], result.json()['body'], result.json()['interactive']), ('interactive', 'Pick one', BUTTONS))

    def test_list_reply_groups_rows_into_sections(self):
        result = self.reply({'interactive': LIST})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['interactive'], LIST)

    def test_cta_url_reply(self):
        result = self.reply({'interactive': CTA})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['interactive'], CTA)

    def test_interactive_limits(self):
        many = [{'id': f'r{i}', 'title': f'Row {i}', 'description': None} for i in range(11)]
        for bad in (
            {**LIST, 'sections': [{'title': 'All', 'rows': many}]},
            {**LIST, 'sections': [{'title': 'A', 'rows': many[:6]}, {'title': 'B', 'rows': many[6:]}]},
            {**LIST, 'sections': [{'title': None, 'rows': many[:1]}, {'title': 'B', 'rows': many[1:2]}]},
            {**BUTTONS, 'buttons': [{'id': str(i), 'title': 'x'} for i in range(4)]},
            {**BUTTONS, 'buttons': [{'id': 'a', 'title': 'x'}, {'id': 'a', 'title': 'y'}]},
            {**BUTTONS, 'buttons': [{'id': 'a', 'title': 'a title longer than twenty'}]},
            {**CTA, 'url': 'http://example.com'},
            {**CTA, 'url': 'javascript:alert(1)'},
            {**CTA, 'url': 'https://[broken'},
            {**CTA, 'display_text': ''},
            {**BUTTONS, 'body': 'x' * 1025},
            {**BUTTONS, 'unknown': 1},
            {'type': 'carousel', 'body': 'x'},
        ):
            self.assertError(self.reply({'interactive': bad}), 422, 'invalid')

    def test_a_reply_carries_exactly_one_content_member(self):
        for bad in ({}, {'body': 'a', 'location': {'latitude': 0, 'longitude': 0}}, {'reply_to_id': 1}, {'body': 'a', 'unknown': 1}):
            self.assertError(self.reply(bad), 422, 'invalid')

    def test_free_form_kinds_need_the_open_window_but_templates_do_not(self):
        attachment_id = self.uploaded_id(conversation=self.late)
        for payload in (
            {'body': 'late'}, {'attachment_id': attachment_id},
            {'location': {'latitude': 1, 'longitude': 1}}, {'interactive': BUTTONS},
        ):
            self.assertError(self.reply(payload, self.late), 422, 'invalid')
        template = self.env['webvue.inbox.template'].create({
            'channel_id': self.channel.id, 'name': 'hello', 'language': 'ar', 'status': 'APPROVED', 'body': 'Hi', 'param_count': 0,
        })
        result = self.reply({'template_id': template.id, 'params': []}, self.late)
        self.assertEqual((result.status_code, result.json()['kind']), (200, 'template'))

    def test_free_form_kinds_refuse_a_closed_conversation_and_a_missing_capability(self):
        closed = self.make_conversation(state='closed')
        self.assertError(self.reply({'location': {'latitude': 1, 'longitude': 1}}, closed), 422, 'invalid')
        self.login(self.outsider)
        self.assertError(self.reply({'interactive': BUTTONS}), 403, 'forbidden')

    # reaction

    def sent_message(self, provider_id='wamid.SENT'):
        return self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'Hi', 'delivery_state': 'sent',
            'provider_message_id': provider_id,
        })

    def react(self, message, emoji):
        return self.api('POST', f'/api/v1/inbox/messages/{message.id}/reaction', {'emoji': emoji})

    def test_reaction_sets_removes_and_queues_the_send(self):
        message = self.sent_message()
        result = self.react(message, '👍')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['reactions'], {'customer': None, 'agent': '👍'})
        self.assertTrue(message.agent_reaction_pending)
        message.agent_reaction_pending = False
        self.assertEqual(self.react(message, '👍').status_code, 200)
        self.assertFalse(message.agent_reaction_pending, 'the same emoji is not sent twice')
        removed = self.react(message, '')
        self.assertEqual(removed.json()['reactions']['agent'], None)
        self.assertTrue(message.agent_reaction_pending)

    def test_reaction_rules(self):
        message = self.sent_message()
        path = f'/api/v1/inbox/messages/{message.id}/reaction'
        self.assertError(self.api('POST', path, {'emoji': 'x' * 17}), 422, 'invalid')
        self.assertError(self.api('POST', path, {}), 422, 'invalid')
        self.assertError(self.api('POST', path, {'emoji': 1}), 422, 'invalid')
        queued = self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'q', 'delivery_state': 'queued',
        })
        self.assertError(self.react(queued, '👍'), 422, 'invalid')
        note = self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'note', 'body': 'n', 'delivery_state': 'sent',
            'provider_message_id': 'wamid.NOTE',
        })
        self.assertError(self.react(note, '👍'), 422, 'invalid')
        self.assertError(self.api('POST', '/api/v1/inbox/messages/999999999/reaction', {'emoji': '👍'}), 404, 'not_found')
        late_message = self.env['webvue.inbox.message'].create({
            'conversation_id': self.late.id, 'direction': 'out', 'body': 'old', 'delivery_state': 'sent',
            'provider_message_id': 'wamid.LATE',
        })
        self.assertError(self.react(late_message, '👍'), 422, 'invalid')
        self.login(self.outsider)
        self.assertError(self.react(message, '👍'), 403, 'forbidden')

    def test_reaction_on_a_hidden_conversation_is_404(self):
        message = self.sent_message()
        self.settings.visibility_policy = 'assigned_only'
        self.assertError(self.react(message, '👍'), 404, 'not_found')

    # typing and read

    def test_typing_only_records_the_request_throttled_and_wakes_the_outbox(self):
        self.conversation.message_ids[0].provider_message_id = 'wamid.IN-TYPING'
        triggers = self.env['ir.cron.trigger'].search_count([])
        with patch.object(whatsapp, 'mark_read') as mark_read:
            first = self.api('POST', self.path('/typing'))
            requested = self.conversation.typing_requested_at
            second = self.api('POST', self.path('/typing'))
        self.assertEqual((first.status_code, second.status_code), (204, 204))
        mark_read.assert_not_called()
        self.assertTrue(self.conversation.typing_pending)
        self.assertEqual(self.conversation.typing_requested_at, requested)
        self.assertEqual(self.env['ir.cron.trigger'].search_count([]), triggers + 1, 'one wake-up, the second call was throttled')
        self.conversation.typing_requested_at = fields.Datetime.now() - timedelta(seconds=21)
        self.api('POST', self.path('/typing'))
        self.assertEqual(self.env['ir.cron.trigger'].search_count([]), triggers + 2)

    def test_typing_records_nothing_outside_the_window_or_without_an_inbound_id(self):
        self.assertEqual(self.api('POST', self.path('/typing')).status_code, 204)
        self.late.message_ids[0].provider_message_id = 'wamid.LATE-IN'
        self.assertEqual(self.api('POST', self.path('/typing', self.late)).status_code, 204)
        self.assertFalse(self.conversation.typing_pending or self.late.typing_pending)

    def test_typing_is_refused_without_the_capability_or_for_a_hidden_conversation(self):
        self.conversation.message_ids[0].provider_message_id = 'wamid.IN-X'
        self.settings.visibility_policy = 'assigned_only'
        self.assertError(self.api('POST', self.path('/typing')), 404, 'not_found')
        self.login(self.outsider)
        self.assertError(self.api('POST', self.path('/typing')), 403, 'forbidden')

    def test_queued_work_wakes_the_outbox(self):
        triggers = self.env['ir.cron.trigger'].search_count([])
        self.reply({'body': 'now'})
        self.assertEqual(self.env['ir.cron.trigger'].search_count([]), triggers + 1)

    def test_a_reader_without_reply_clears_unread_but_queues_no_receipt(self):
        inbound = self.conversation.message_ids[0]
        inbound.provider_message_id = 'wamid.READER'
        self.conversation.unread = True
        self.login(self.reader_only)
        self.assertEqual(self.api('POST', self.path('/read')).status_code, 204)
        self.reload(self.conversation, inbound)
        self.assertEqual((self.conversation.unread, inbound.read_receipt), (False, False))

    def test_read_queues_one_receipt_for_the_latest_inbound_message(self):
        older = self.conversation.message_ids[0]
        older.provider_message_id = 'wamid.OLD'
        newest = self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'in', 'body': 'again', 'delivery_state': 'received',
            'provider_message_id': 'wamid.NEW', 'date': fields.Datetime.now(),
        })
        self.assertEqual(self.api('POST', self.path('/read')).status_code, 204)
        self.assertEqual((older.read_receipt, newest.read_receipt), (False, 'pending'))
        newest.read_receipt = 'sent'
        self.api('POST', self.path('/read'))
        self.assertEqual(newest.read_receipt, 'sent', 'opening again does not queue a second receipt')
