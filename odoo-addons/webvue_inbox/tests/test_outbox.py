# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from .common import ACCESS_TOKEN, PHONE_ID, WebVueInboxCase
from odoo.addons.webvue_inbox.adapters import whatsapp
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


def response(status, body=None):
    mocked = MagicMock(status_code=status)
    mocked.json.return_value = body if body is not None else {}
    return mocked


@tagged('post_install', '-at_install', 'webvue')
class TestOutbox(WebVueInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conversation = cls.make_conversation()

    def queue(self, **values):
        return self.env['webvue.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'Hi', 'delivery_state': 'queued',
            'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1), **values,
        })

    def run_outbox(self, mocked):
        with patch.object(requests, 'request', mocked):
            self.env['webvue.inbox.message']._webvue_run_outbox()

    def test_success_sends_the_text_once_with_the_token_and_marks_sent(self):
        message = self.queue()
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.SENT1'}]}))
        self.run_outbox(mocked)
        self.assertEqual((message.delivery_state, message.provider_message_id, message.attempts), ('sent', 'wamid.SENT1', 1))
        method, url = mocked.call_args.args
        self.assertEqual((method, url.endswith(f'/{PHONE_ID}/messages')), ('POST', True))
        self.assertEqual(mocked.call_args.kwargs['headers'], {'Authorization': f'Bearer {ACCESS_TOKEN}'})
        self.assertEqual(mocked.call_args.kwargs['timeout'], whatsapp.TIMEOUT_SECONDS)
        sent = mocked.call_args.kwargs['json']
        self.assertEqual((sent['to'], sent['type'], sent['text']), (self.conversation.identity_id.address, 'text', {'body': 'Hi'}))
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)

    def test_a_template_reply_is_sent_with_its_parameters(self):
        template = self.env['webvue.inbox.template'].create({
            'channel_id': self.channel.id, 'name': 'order_ready', 'language': 'ar', 'status': 'approved',
            'body': 'Hi {{1}}',
        })
        self.queue(
            template_id=template.id, template_name=template.name, template_language=template.language,
            template_params=['Sara'], body='Hi Sara',
        )
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.T1'}]}))
        self.run_outbox(mocked)
        sent = mocked.call_args.kwargs['json']
        self.assertEqual(sent['template'], {
            'name': 'order_ready', 'language': {'code': 'ar'},
            'components': [{'type': 'body', 'parameters': [{'type': 'text', 'text': 'Sara'}]}],
        })

    def test_server_errors_retry_with_exponential_backoff_then_fail_after_five(self):
        message = self.queue()
        mocked = MagicMock(return_value=response(503, {'error': {'message': 'Service unavailable'}}))
        for attempt, minutes in enumerate((1, 2, 4, 8), start=1):
            before = fields.Datetime.now()
            self.run_outbox(mocked)
            self.assertEqual((message.delivery_state, message.attempts), ('queued', attempt))
            self.assertAlmostEqual((message.next_attempt_at - before).total_seconds(), minutes * 60, delta=5)
            message.next_attempt_at = fields.Datetime.now() - timedelta(seconds=1)
        self.run_outbox(mocked)
        self.assertEqual((message.delivery_state, message.attempts, message.error), ('failed', 5, 'Service unavailable'))

    def test_a_not_yet_due_message_waits(self):
        message = self.queue(next_attempt_at=fields.Datetime.now() + timedelta(minutes=5))
        mocked = MagicMock()
        self.run_outbox(mocked)
        self.assertEqual((mocked.call_count, message.delivery_state), (0, 'queued'))

    def test_a_timeout_is_retried(self):
        message = self.queue()
        self.run_outbox(MagicMock(side_effect=requests.Timeout()))
        self.assertEqual((message.delivery_state, message.attempts), ('queued', 1))
        self.assertNotIn(ACCESS_TOKEN, message.error)

    def test_a_client_error_fails_permanently_at_once(self):
        message = self.queue()
        self.run_outbox(MagicMock(return_value=response(400, {'error': {'message': 'Invalid parameter'}})))
        self.assertEqual((message.delivery_state, message.attempts, message.error), ('failed', 1, 'Invalid parameter'))

    def test_a_missing_master_key_fails_the_message_with_a_clear_error(self):
        message = self.queue()
        with patch.dict('os.environ', {'WEBVUE_INBOX_SECRET_KEY': ''}):
            self.run_outbox(MagicMock())
        self.assertEqual((message.delivery_state, message.error), ('failed', 'Secret storage is not configured.'))

    def test_the_monthly_outbound_limit_is_enforced(self):
        profile = self.env.ref('webvue_platform.tenant_profile')
        used = self.env['webvue.inbox.message']._webvue_count_outbound_this_month()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.messages_out': used + 1}})
        self.queue()
        self.login(self.agent)
        result = self.api('POST', f'/api/v1/inbox/conversations/{self.conversation.id}/messages', {'body': 'over'})
        self.assertEqual(result.status_code, 403, result.text)
        self.assertEqual(result.json()['details'], {'reason': 'limit', 'limit_key': 'inbox.messages_out'})
