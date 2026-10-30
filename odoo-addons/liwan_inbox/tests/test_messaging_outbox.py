# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from .common import ACCESS_TOKEN, PHONE_ID, LiwanInboxCase
from .media_samples import PDF, PNG
from .test_outbox import response
from .test_replies_api import BUTTONS, CTA, LIST
from odoo.addons.liwan_inbox.adapters import whatsapp
from odoo.addons.liwan_inbox.controllers import reply_parsing


@tagged('post_install', '-at_install', 'liwan')
class TestMessagingOutbox(LiwanInboxCase):
    """The outbox sends every kind through the provider, with context, uploading a file once."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conversation = cls.make_conversation()

    def queue(self, **values):
        return self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'Hi', 'delivery_state': 'queued',
            'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1), **values,
        })

    def queue_file(self, kind='image', name='a.png', data=PNG, mimetype='image/png', **values):
        message = self.queue(kind=kind, body=values.pop('body', f'[{kind}]'), **values)
        self.env['ir.attachment'].create({
            'name': name, 'raw': data, 'mimetype': mimetype, 'res_model': message._name, 'res_id': message.id,
        })
        return message

    def run_outbox(self, mocked):
        with patch.object(requests, 'request', mocked):
            self.env['liwan.inbox.message']._liwan_run_outbox()

    def calls(self, mocked):
        return [(call.args[0], call.args[1].split(f'/{PHONE_ID}/')[-1], call.kwargs) for call in mocked.call_args_list]

    def test_a_file_is_uploaded_then_sent_with_caption_and_context(self):
        target = self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'in', 'body': 'q', 'delivery_state': 'received',
            'provider_message_id': 'wamid.CONTEXT',
        })
        message = self.queue_file(body='Look', reply_to_id=target.id)
        mocked = MagicMock(side_effect=[response(200, {'id': 'media-77'}), response(200, {'messages': [{'id': 'wamid.IMG'}]})])
        self.run_outbox(mocked)
        (upload_method, upload_path, upload), (send_method, send_path, send) = self.calls(mocked)
        self.assertEqual((upload_method, upload_path), ('POST', 'media'))
        self.assertEqual(upload['data'], {'messaging_product': 'whatsapp', 'type': 'image/png'})
        self.assertEqual(upload['files'], {'file': ('a.png', PNG, 'image/png')})
        self.assertEqual(upload['headers'], {'Authorization': f'Bearer {ACCESS_TOKEN}'})
        self.assertEqual(upload['timeout'], whatsapp.UPLOAD_TIMEOUT_SECONDS)
        self.assertEqual((send_method, send_path), ('POST', 'messages'))
        self.assertEqual(send['json']['image'], {'id': 'media-77', 'caption': 'Look'})
        self.assertEqual(send['json']['context'], {'message_id': 'wamid.CONTEXT'})
        self.assertEqual((message.delivery_state, message.provider_message_id, message.media_id), ('sent', 'wamid.IMG', 'media-77'))

    def test_a_file_without_caption_sends_no_caption_and_a_document_its_filename(self):
        self.queue_file(kind='document', name='report.pdf', data=PDF, mimetype='application/pdf')
        mocked = MagicMock(side_effect=[response(200, {'id': 'media-1'}), response(200, {'messages': [{'id': 'wamid.D'}]})])
        self.run_outbox(mocked)
        sent = self.calls(mocked)[1][2]['json']
        self.assertEqual(sent['document'], {'id': 'media-1', 'filename': 'report.pdf'})
        self.assertNotIn('context', sent)

    def test_a_retry_after_the_upload_does_not_upload_again(self):
        message = self.queue_file()
        failing = MagicMock(side_effect=[response(200, {'id': 'media-9'}), response(503, {'error': {'message': 'down'}})])
        self.run_outbox(failing)
        self.assertEqual((message.delivery_state, message.attempts, message.media_id), ('queued', 1, 'media-9'))
        message.next_attempt_at = fields.Datetime.now() - timedelta(seconds=1)
        working = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.RETRY'}]}))
        self.run_outbox(working)
        self.assertEqual([path for _method, path, _kwargs in self.calls(working)], ['messages'])
        self.assertEqual(working.call_args.kwargs['json']['image'], {'id': 'media-9'})
        self.assertEqual(message.delivery_state, 'sent')

    def test_a_failed_upload_is_recorded_without_sending(self):
        message = self.queue_file()
        mocked = MagicMock(return_value=response(400, {'error': {'message': 'Unsupported file'}}))
        self.run_outbox(mocked)
        self.assertEqual((mocked.call_count, message.delivery_state, message.error), (1, 'failed', 'Unsupported file'))

    def test_a_file_message_without_its_file_fails_clearly(self):
        message = self.queue(kind='image', body='[image]')
        self.run_outbox(MagicMock())
        self.assertEqual((message.delivery_state, bool(message.error)), ('failed', True))

    def test_a_location_is_sent(self):
        self.queue(kind='location', body='Office', latitude=24.7136, longitude=46.6753, location_name='Office')
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.L'}]}))
        self.run_outbox(mocked)
        sent = mocked.call_args.kwargs['json']
        self.assertEqual((sent['type'], sent['location']), ('location', {'latitude': 24.7136, 'longitude': 46.6753, 'name': 'Office'}))

    def interactive(self, interactive):
        message = self.queue(**reply_parsing.parse_interactive(interactive))
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.I'}]}))
        self.run_outbox(mocked)
        self.assertEqual(message.delivery_state, 'sent')
        return mocked.call_args.kwargs['json']

    def test_reply_buttons_payload(self):
        sent = self.interactive(BUTTONS)
        self.assertEqual(sent['type'], 'interactive')
        self.assertEqual(sent['interactive'], {
            'type': 'button', 'body': {'text': 'Pick one'},
            'action': {'buttons': [
                {'type': 'reply', 'reply': {'id': 'yes', 'title': 'Yes'}},
                {'type': 'reply', 'reply': {'id': 'no', 'title': 'No'}},
            ]},
        })

    def test_list_payload_keeps_sections_and_drops_empty_descriptions(self):
        interactive = self.interactive(LIST)['interactive']
        self.assertEqual((interactive['type'], interactive['header']), ('list', {'type': 'text', 'text': 'Days'}))
        self.assertEqual(interactive['action'], {'button': 'Choose', 'sections': [
            {'title': 'Weekdays', 'rows': [
                {'id': 'mon', 'title': 'Monday', 'description': 'Early'}, {'id': 'tue', 'title': 'Tuesday'},
            ]},
            {'title': 'Weekend', 'rows': [{'id': 'sat', 'title': 'Saturday'}]},
        ]})

    def test_cta_url_payload(self):
        interactive = self.interactive(CTA)['interactive']
        self.assertEqual(interactive['type'], 'cta_url')
        self.assertEqual(interactive['footer'], {'text': 'Open daily'})
        self.assertEqual(interactive['action'], {'name': 'cta_url', 'parameters': {'display_text': 'Open', 'url': 'https://example.com/a?b=1'}})

    def test_a_text_reply_sends_its_context(self):
        target = self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'in', 'body': 'q', 'delivery_state': 'received',
            'provider_message_id': 'wamid.Q',
        })
        self.queue(reply_to_id=target.id)
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.T'}]}))
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_args.kwargs['json']['context'], {'message_id': 'wamid.Q'})

    # reactions and read receipts

    def reacted(self, emoji='👍', **values):
        return self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'Hi', 'delivery_state': 'sent',
            'provider_message_id': 'wamid.R', 'agent_reaction': emoji or False, 'agent_reaction_pending': True, **values,
        })

    def test_a_reaction_is_sent_once_and_a_removal_sends_an_empty_emoji(self):
        message = self.reacted()
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.RX'}]}))
        self.run_outbox(mocked)
        sent = mocked.call_args.kwargs['json']
        self.assertEqual((sent['type'], sent['reaction'], sent['to']), (
            'reaction', {'message_id': 'wamid.R', 'emoji': '👍'}, self.conversation.identity_id.address,
        ))
        self.assertFalse(message.agent_reaction_pending)
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)
        message.write({'agent_reaction': False, 'agent_reaction_pending': True})
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_args.kwargs['json']['reaction'], {'message_id': 'wamid.R', 'emoji': ''})

    def test_a_reaction_backs_off_between_attempts_then_is_withdrawn(self):
        message = self.reacted()
        mocked = MagicMock(return_value=response(503, {'error': {'message': 'down'}}))
        for attempt, minutes in enumerate((1, 2, 4, 8), start=1):
            before = fields.Datetime.now()
            self.run_outbox(mocked)
            self.assertEqual((message.agent_reaction_pending, message.reaction_attempts, message.agent_reaction), (True, attempt, '👍'))
            self.assertAlmostEqual((message.reaction_next_attempt_at - before).total_seconds(), minutes * 60, delta=5)
            self.run_outbox(mocked)
            self.assertEqual(message.reaction_attempts, attempt, 'a run before the backoff ends does not try again')
            message.reaction_next_attempt_at = fields.Datetime.now() - timedelta(seconds=1)
        self.run_outbox(mocked)
        self.assertEqual((message.agent_reaction_pending, message.agent_reaction), (False, False))

    def test_a_refused_reaction_is_withdrawn_at_once(self):
        message = self.reacted()
        self.run_outbox(MagicMock(return_value=response(400, {'error': {'message': 'bad'}})))
        self.assertEqual((message.agent_reaction_pending, message.agent_reaction), (False, False))

    def test_a_read_receipt_is_sent_once_with_the_message_id(self):
        inbound = self.conversation.message_ids[0]
        inbound.write({'provider_message_id': 'wamid.RCPT', 'read_receipt': 'pending'})
        mocked = MagicMock(return_value=response(200, {'success': True}))
        self.run_outbox(mocked)
        method, path, kwargs = self.calls(mocked)[0]
        self.assertEqual((method, path), ('POST', 'messages'))
        self.assertEqual(kwargs['json'], {'messaging_product': 'whatsapp', 'status': 'read', 'message_id': 'wamid.RCPT'})
        self.assertEqual(inbound.read_receipt, 'sent')
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)

    def test_a_read_receipt_backs_off_between_attempts_then_is_given_up(self):
        inbound = self.conversation.message_ids[0]
        inbound.write({'provider_message_id': 'wamid.RCPT2', 'read_receipt': 'pending'})
        mocked = MagicMock(return_value=response(503, {'error': {'message': 'down'}}))
        for attempt, minutes in enumerate((1, 2, 4, 8), start=1):
            before = fields.Datetime.now()
            self.run_outbox(mocked)
            self.assertEqual((inbound.read_receipt, inbound.receipt_attempts), ('pending', attempt))
            self.assertAlmostEqual((inbound.receipt_next_attempt_at - before).total_seconds(), minutes * 60, delta=5)
            self.run_outbox(mocked)
            self.assertEqual(inbound.receipt_attempts, attempt)
            inbound.receipt_next_attempt_at = fields.Datetime.now() - timedelta(seconds=1)
        self.run_outbox(mocked)
        self.assertEqual(inbound.read_receipt, 'failed')

    def test_a_manual_retry_uploads_the_file_again(self):
        message = self.queue_file()
        self.run_outbox(MagicMock(side_effect=[response(200, {'id': 'media-old'}), response(400, {'error': {'message': 'refused'}})]))
        self.assertEqual((message.delivery_state, message.media_id), ('failed', 'media-old'))
        message._liwan_retry()
        self.assertFalse(message.media_id)
        mocked = MagicMock(side_effect=[response(200, {'id': 'media-new'}), response(200, {'messages': [{'id': 'wamid.AGAIN'}]})])
        self.run_outbox(mocked)
        self.assertEqual([path for _method, path, _kwargs in self.calls(mocked)], ['media', 'messages'])
        self.assertEqual(message.media_id, 'media-new')

    def request_typing(self, age_seconds=0):
        inbound = self.conversation.message_ids[0]
        inbound.provider_message_id = 'wamid.TYPE'
        self.conversation.write({
            'typing_pending': True, 'typing_requested_at': fields.Datetime.now() - timedelta(seconds=age_seconds),
        })
        return inbound

    def test_a_pending_typing_request_sends_the_indicator_once_with_a_short_timeout(self):
        inbound = self.request_typing()
        mocked = MagicMock(return_value=response(200, {'success': True}))
        self.run_outbox(mocked)
        kwargs = mocked.call_args.kwargs
        self.assertEqual(kwargs['json'], {
            'messaging_product': 'whatsapp', 'status': 'read', 'message_id': 'wamid.TYPE', 'typing_indicator': {'type': 'text'},
        })
        self.assertEqual(kwargs['timeout'], whatsapp.TYPING_TIMEOUT_SECONDS)
        self.assertEqual(kwargs['headers'], {'Authorization': f'Bearer {ACCESS_TOKEN}'})
        self.assertEqual((self.conversation.typing_pending, inbound.read_receipt), (False, 'sent'))
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)

    def test_a_stale_typing_request_is_dropped_unsent(self):
        self.request_typing(age_seconds=26)
        mocked = MagicMock()
        self.run_outbox(mocked)
        self.assertEqual((mocked.call_count, self.conversation.typing_pending), (0, False))

    def reply_at(self, seconds_ago):
        return self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'done',
            'delivery_state': 'sent', 'date': fields.Datetime.now() - timedelta(seconds=seconds_ago),
        })

    def test_a_reply_sent_after_the_typing_request_cancels_it(self):
        self.request_typing(age_seconds=5)
        self.reply_at(seconds_ago=1)
        mocked = MagicMock()
        self.run_outbox(mocked)
        self.assertEqual((mocked.call_count, self.conversation.typing_pending), (0, False))

    def test_typing_requested_after_the_last_reply_is_still_sent(self):
        self.reply_at(seconds_ago=10)
        self.request_typing(age_seconds=1)
        mocked = MagicMock(return_value=response(200, {'success': True}))
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)

    def test_a_failed_typing_call_is_not_retried(self):
        self.request_typing()
        mocked = MagicMock(return_value=response(503, {'error': {'message': 'down'}}))
        self.run_outbox(mocked)
        self.run_outbox(mocked)
        self.assertEqual((mocked.call_count, self.conversation.typing_pending), (1, False))
