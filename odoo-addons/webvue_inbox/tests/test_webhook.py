# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import WebVueInboxCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

HOOK = '/api/v1/inbox/hooks/whatsapp'


@tagged('post_install', '-at_install', 'webvue')
class TestWhatsAppWebhook(WebVueInboxCase):

    def post(self, data, signature=None, raw=None):
        raw = raw if raw is not None else wa.body_of(data)
        headers = {'Content-Type': 'application/json', 'X-Hub-Signature-256': signature or wa.sign(raw)}
        return self.url_open(HOOK, data=raw, headers=headers, method='POST')

    def events(self):
        return self.env['webvue.inbox.event'].search([('channel_id', '=', self.channel.id)])

    def verify(self, token, mode='subscribe', challenge='1158201444'):
        query = f'hub.mode={mode}&hub.verify_token={token}&hub.challenge={challenge}'
        return self.url_open(f'{HOOK}?{query}')

    def test_verification_with_the_channel_token_echoes_the_challenge(self):
        response = self.verify(self.channel.verify_token)
        self.assertEqual((response.status_code, response.text), (200, '1158201444'))
        self.assertTrue(response.headers['Content-Type'].startswith('text/plain'))

    def test_verification_with_a_wrong_token_or_mode_is_403(self):
        self.assertError(self.verify('wrong-token'), 403, 'forbidden')
        self.assertError(self.verify(self.channel.verify_token, mode='unsubscribe'), 403, 'forbidden')

    def test_a_disabled_channel_does_not_verify(self):
        self.channel.state = 'disabled'
        self.assertError(self.verify(self.channel.verify_token), 403, 'forbidden')

    def test_a_signed_delivery_creates_one_event_and_nothing_else(self):
        raw = wa.body_of(wa.inbound_text())
        response = self.post(None, raw=raw)
        self.assertEqual((response.status_code, response.text), (200, 'ok'))
        event = self.events()
        self.assertEqual((len(event), event.state, event.payload.encode()), (1, 'pending', raw))
        self.assertEqual(event.owner_company_id, self.channel.owner_company_id)
        self.assertFalse(self.env['webvue.inbox.message'].search([('provider_message_id', '=', 'wamid.IN1')]))

    def test_bad_signature_and_unknown_phone_answer_the_same_403(self):
        bad_signature = self.post(wa.inbound_text(), signature='sha256=' + '0' * 64)
        unknown_phone = self.post(wa.inbound_text(phone_id='999999999999'))
        no_signature = self.post(wa.inbound_text(), signature='nope')
        for response in (bad_signature, unknown_phone, no_signature):
            self.assertError(response, 403, 'forbidden')
        self.assertEqual(bad_signature.content, unknown_phone.content)
        self.assertFalse(self.events())

    def test_malformed_and_oversized_bodies_are_refused(self):
        self.assertError(self.post(None, raw=b'not json'), 403, 'forbidden')
        self.assertError(self.post(None, raw=b'[1, 2]'), 403, 'forbidden')
        self.assertEqual(self.post(None, raw=b'{"pad": "' + b'x' * (1024 * 1024) + b'"}').status_code, 413)
        self.assertFalse(self.events())

    def test_a_disabled_channel_receives_nothing(self):
        self.channel.state = 'disabled'
        self.assertError(self.post(wa.inbound_text()), 403, 'forbidden')
        self.assertFalse(self.events())

    def test_closed_whatsapp_feature_refuses_the_hook(self):
        set_probe_feature(self, key='inbox.whatsapp', enabled=False)
        self.assertError(self.post(wa.inbound_text()), 403, 'feature_not_included')
        self.assertError(self.verify(self.channel.verify_token), 403, 'feature_not_included')

    def test_without_the_master_key_a_delivery_is_refused_like_a_bad_signature(self):
        with patch.dict('os.environ', {}, clear=False) as env:
            env.pop('WEBVUE_INBOX_SECRET_KEY', None)
            self.assertError(self.post(wa.inbound_text()), 403, 'forbidden')
        self.assertFalse(self.events())
