# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from .common import ACCESS_TOKEN, PHONE_ID, LiwanInboxCase
from odoo.addons.liwan_inbox.adapters import whatsapp
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


def response(status, body=None):
    mocked = MagicMock(status_code=status)
    mocked.json.return_value = body if body is not None else {}
    return mocked


@tagged('post_install', '-at_install', 'liwan')
class TestOutbox(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conversation = cls.make_conversation()

    def queue(self, **values):
        return self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'Hi', 'delivery_state': 'queued',
            'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1), **values,
        })

    def run_outbox(self, mocked):
        with patch.object(requests, 'request', mocked):
            self.env['liwan.inbox.message']._liwan_run_outbox()

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

    def test_a_queued_reply_is_sent_after_its_author_loses_a_full_seat(self):
        message = self.queue(author_id=self.agent.id)
        self.env['liwan.entitlement.service']._liwan_apply_flags(self.agent, {'liwan_read_only': True})
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.QUEUED'}]}))
        self.run_outbox(mocked)
        self.assertEqual((message.delivery_state, message.provider_message_id), ('sent', 'wamid.QUEUED'))

    def test_a_template_reply_is_sent_with_its_parameters(self):
        template = self.env['liwan.inbox.template'].create({
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

    def test_an_unconfirmed_read_timeout_fails_without_a_retry_and_a_retry_clears_it(self):
        message = self.queue()
        queued_at = message.next_attempt_at
        self.run_outbox(MagicMock(side_effect=requests.ReadTimeout('the answer arrived too late')))
        self.assertEqual((message.delivery_state, message.attempts), ('failed', 1))
        self.assertTrue(message.unconfirmed)
        self.assertFalse(message.error_code)
        self.assertEqual(message.next_attempt_at, queued_at)  # not rescheduled
        message._liwan_retry()
        self.assertEqual((message.delivery_state, message.unconfirmed), ('queued', False))

    def test_a_connect_timeout_stays_queued_and_unconfirmed_is_false(self):
        message = self.queue()
        self.run_outbox(MagicMock(side_effect=requests.ConnectTimeout('never reached')))
        self.assertEqual((message.delivery_state, message.attempts), ('queued', 1))
        self.assertTrue(message.next_attempt_at)
        self.assertFalse(message.unconfirmed)

    def test_a_client_error_fails_permanently_at_once(self):
        message = self.queue()
        self.run_outbox(MagicMock(return_value=response(400, {'error': {'message': 'Invalid parameter'}})))
        self.assertEqual((message.delivery_state, message.attempts, message.error), ('failed', 1, 'Invalid parameter'))

    def test_a_missing_master_key_fails_the_message_with_a_clear_error(self):
        message = self.queue()
        with patch.dict('os.environ', {'LIWAN_INBOX_SECRET_KEY': ''}):
            self.run_outbox(MagicMock())
        self.assertEqual((message.delivery_state, message.error), ('failed', 'Secret storage is not configured.'))

    def test_a_local_failure_after_the_provider_took_the_message_is_unconfirmed_and_never_resent(self):
        message = self.queue()
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.LOST'}]}))
        message_model = type(self.env['liwan.inbox.message'])
        with patch.object(message_model, '_liwan_mark_sent', side_effect=RuntimeError('disk full')):
            self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)
        self.assertEqual((message.delivery_state, message.unconfirmed, message.attempts), ('failed', True, 1))
        self.assertFalse(message.send_token)
        self.assertIn('could not be stored', message.error)
        self.commits.assert_any_call(0)  # the send marker was committed before the provider was called
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)

    def test_an_unexpected_error_before_the_provider_keeps_the_retry(self):
        message = self.queue()
        mocked = MagicMock()
        message_model = type(self.env['liwan.inbox.message'])
        with patch.object(message_model, '_liwan_provider_send', side_effect=RuntimeError('boom')):
            self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 0)
        self.assertEqual((message.delivery_state, message.attempts, message.unconfirmed), ('queued', 1, False))
        self.assertTrue(message.next_attempt_at)
        self.assertFalse(message.send_token)

    def test_a_failure_after_the_provider_answered_is_unconfirmed_and_never_resent(self):
        message = self.queue()
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.SENTBUS'}]}))
        conversation_model = type(self.env['liwan.inbox.conversation'])
        with patch.object(conversation_model, '_liwan_notify_bus', side_effect=RuntimeError('bus down')):
            self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)
        self.assertEqual((message.delivery_state, message.unconfirmed, message.attempts), ('failed', True, 1))
        self.assertFalse(message.send_token)
        self.assertIn('could not be stored', message.error)
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 1)

    def test_a_marker_left_by_a_crashed_worker_is_settled_without_sending(self):
        message = self.queue(send_token='a' * 32, send_started_at=fields.Datetime.now() - timedelta(minutes=5))
        # A message already stored as sent keeps its state: only a queued outbound message can be mid-send.
        sent = self.queue(delivery_state='sent', provider_message_id='wamid.OLD', send_token='c' * 32)
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.NOPE'}]}))
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 0)
        self.assertEqual((message.delivery_state, message.unconfirmed, message.attempts), ('failed', True, 1))
        self.assertFalse(message.send_token)
        self.assertIn('recorded no result', message.error)
        self.assertEqual((sent.delivery_state, sent.unconfirmed, sent.send_token), ('sent', False, 'c' * 32))
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 0)

    def test_a_token_of_an_in_flight_send_is_left_alone(self):
        message = self.queue(send_token='c' * 32, send_started_at=fields.Datetime.now())
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.FRESH'}]}))
        self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 0)
        self.assertEqual((message.delivery_state, message.send_token, message.unconfirmed), ('queued', 'c' * 32, False))

    def test_settling_an_interrupted_send_notifies_the_conversation(self):
        message = self.queue(send_token='d' * 32, send_started_at=fields.Datetime.now() - timedelta(minutes=5))
        conversation_model = type(self.env['liwan.inbox.conversation'])
        with patch.object(conversation_model, '_liwan_notify_bus', autospec=True) as notify:
            self.run_outbox(MagicMock())
        self.assertEqual(
            {call.args[0].id for call in notify.call_args_list if call.args and call.args[0]},
            {message.conversation_id.id},
        )

    def test_a_message_with_an_unsettled_send_token_is_never_sent_again(self):
        message = self.queue(send_token='b' * 32, send_started_at=fields.Datetime.now())
        mocked = MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.AGAIN'}]}))
        message_model = type(self.env['liwan.inbox.message'])
        # A settlement that could not write its failure must still keep the send query away from the token.
        with patch.object(message_model, '_liwan_settle_interrupted_sends', lambda model: None):
            self.run_outbox(mocked)
        self.assertEqual(mocked.call_count, 0)
        self.assertEqual((message.delivery_state, message.send_token), ('queued', 'b' * 32))

    def test_a_run_cut_short_by_the_time_budget_does_not_ask_for_another_run(self):
        first, second = self.queue(), self.queue()
        # Both fit the batch, but the cron's budget ends after the first message.
        remaining = iter([float('inf')] * 3 + [2.0])
        self.commits.side_effect = lambda *args, **kwargs: next(remaining, 2.0)
        message_model = type(self.env['liwan.inbox.message'])
        with patch('odoo.addons.liwan_inbox.models.message_outbox.OUTBOX_BATCH', 2), \
                patch.object(message_model, '_liwan_wake_outbox') as wake:
            self.run_outbox(MagicMock(return_value=response(200, {'messages': [{'id': 'wamid.CUT'}]})))
        self.assertEqual((first.delivery_state, second.delivery_state), ('sent', 'queued'))
        wake.assert_not_called()

    def test_the_monthly_outbound_limit_is_enforced(self):
        profile = self.env.ref('liwan_platform.tenant_profile')
        used = self.env['liwan.inbox.message']._liwan_count_outbound_this_month()
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'inbox.messages_out': used + 1}})
        self.queue()
        self.login(self.agent)
        result = self.api('POST', f'/api/v1/inbox/conversations/{self.conversation.id}/messages', {'body': 'over'})
        self.assertEqual(result.status_code, 403, result.text)
        self.assertEqual(result.json()['details'], {'reason': 'limit', 'limit_key': 'inbox.messages_out'})
