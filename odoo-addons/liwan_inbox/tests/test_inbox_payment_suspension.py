# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A tenant suspended for non-payment records what customers send and sends nothing until it is paid."""
from datetime import timedelta
from unittest.mock import MagicMock, patch

import requests

from odoo import fields
from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import LiwanInboxCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

HOOK = '/api/v1/inbox/hooks/whatsapp'


@tagged('post_install', '-at_install', 'liwan')
class TestInboxPaymentSuspension(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.conversation = cls.make_conversation()

    def _profile(self, **values):
        self.env.ref('liwan_platform.tenant_profile').sudo().with_context(**{OPERATOR_CONTEXT: True}).write(values)

    def _suspend(self, reason='non_payment'):
        self._profile(status='suspended', suspension_reason=reason)

    def _outbound(self):
        return self.env['liwan.inbox.message'].search_count([('direction', '=', 'out')])

    def test_a_signed_delivery_is_stored_and_its_message_recorded_without_any_reply(self):
        self._suspend()
        raw = wa.body_of(wa.inbound_text(provider_id='wamid.UNPAID1', body='Where is my order?'))
        stored = self.env['liwan.inbox.event'].search_count([('channel_id', '=', self.channel.id)])
        outbound = self._outbound()
        response = self.url_open(HOOK, data=raw, headers={'Content-Type': 'application/json', 'X-Hub-Signature-256': wa.sign(raw)}, method='POST')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.env['liwan.inbox.event'].search_count([('channel_id', '=', self.channel.id)]), stored + 1)
        self.env['liwan.inbox.event']._liwan_run_events()
        self.assertTrue(self.env['liwan.inbox.message'].search([('provider_message_id', '=', 'wamid.UNPAID1')]))
        self.assertEqual(self._outbound(), outbound)

    def test_a_queued_reply_waits_while_unpaid_and_goes_out_after_payment(self):
        message = self.env['liwan.inbox.message'].create({
            'conversation_id': self.conversation.id, 'direction': 'out', 'body': 'Hi', 'delivery_state': 'queued',
            'next_attempt_at': fields.Datetime.now() - timedelta(seconds=1),
        })
        mocked = MagicMock(return_value=MagicMock(status_code=200, **{'json.return_value': {'messages': [{'id': 'wamid.AFTER'}]}}))
        for reason in ('non_payment', 'vendor'):
            self._suspend(reason)
            with patch.object(requests, 'request', mocked):
                self.env['liwan.inbox.message']._liwan_run_outbox()
            self.assertEqual((message.delivery_state, mocked.call_count), ('queued', 0), reason)
        self._profile(status='active')
        with patch.object(requests, 'request', mocked):
            self.env['liwan.inbox.message']._liwan_run_outbox()
        self.assertEqual((message.delivery_state, mocked.call_count), ('sent', 1))

    def test_the_provider_pulling_crons_make_no_call_while_unpaid(self):
        self._suspend()
        mocked = MagicMock()
        channels = self.env['liwan.inbox.channel']
        with patch.object(requests, 'request', mocked):
            channels._liwan_run_health()
            channels._liwan_run_analytics()
            channels._liwan_run_analytics_requested()
            channels._liwan_retry_tiktok_bindings()
        mocked.assert_not_called()
