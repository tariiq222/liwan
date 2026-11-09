# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from psycopg2.errors import NotNullViolation, UniqueViolation

from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

HOOK = '/api/v1/inbox/hooks/whatsapp'


@tagged('post_install', '-at_install', 'liwan')
class TestWhatsAppWebhook(LiwanInboxCase):

    def post(self, data, signature=None, raw=None):
        raw = raw if raw is not None else wa.body_of(data)
        headers = {'Content-Type': 'application/json', 'X-Hub-Signature-256': signature or wa.sign(raw)}
        return self.url_open(HOOK, data=raw, headers=headers, method='POST')

    def events(self):
        return self.env['liwan.inbox.event'].search([('channel_id', '=', self.channel.id)])

    def verify(self, token, mode='subscribe', challenge='1158201444'):
        query = f'hub.mode={mode}&hub.verify_token={token}&hub.challenge={challenge}'
        return self.url_open(f'{HOOK}?{query}')

    def test_verification_with_the_channel_token_echoes_the_challenge(self):
        response = self.verify(self.channel._liwan_verify_token())
        self.assertEqual((response.status_code, response.text), (200, '1158201444'))
        self.assertTrue(response.headers['Content-Type'].startswith('text/plain'))

    def test_verification_with_a_wrong_token_or_mode_is_403(self):
        self.assertError(self.verify('wrong-token'), 403, 'forbidden')
        self.assertError(self.verify(self.channel._liwan_verify_token(), mode='unsubscribe'), 403, 'forbidden')

    def test_an_empty_token_never_subscribes(self):
        # An empty query value is a missing handshake parameter, refused before any channel is read.
        self.assertError(self.verify(''), 400, 'invalid')

    def test_a_handshake_without_meta_parameters_is_400_invalid(self):
        self.assertError(self.url_open(HOOK), 400, 'invalid')
        self.assertError(self.url_open(f'{HOOK}?hub.mode=subscribe&hub.challenge=1'), 400, 'invalid')

    def test_a_disabled_channel_does_not_verify(self):
        self.channel.state = 'disabled'
        self.assertError(self.verify(self.channel._liwan_verify_token()), 403, 'forbidden')

    def test_a_signed_delivery_creates_one_event_and_nothing_else(self):
        raw = wa.body_of(wa.inbound_text())
        response = self.post(None, raw=raw)
        self.assertEqual((response.status_code, response.text), (200, 'ok'))
        event = self.events()
        self.assertEqual((len(event), event.state, event.payload.encode()), (1, 'pending', raw))
        self.assertEqual(event.owner_company_id, self.channel.owner_company_id)
        self.assertFalse(self.env['liwan.inbox.message'].search([('provider_message_id', '=', 'wamid.IN1')]))

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

    def test_a_replayed_delivery_leaves_one_event_and_one_side_effect(self):
        # Meta signs the body alone, so a captured body stays valid forever. The event's dedupe key
        # (SHA-256 of channel and body) stores this delivery once, so a replay changes nothing.
        raw = wa.body_of(wa.inbound_text())
        self.assertEqual(self.post(None, raw=raw).status_code, 200)
        self.assertEqual(self.post(None, raw=raw).status_code, 200)
        self.assertEqual(len(self.events()), 1)
        keys = self.env['liwan.inbox.event'].search([('channel_id', '=', self.channel.id)]).mapped('dedupe_key')
        self.assertEqual(keys, [self.env['liwan.inbox.event']._liwan_dedupe_key(self.channel, raw)])

    def test_the_key_is_required_and_unique_on_its_own(self):
        # One plain unique index on the required column: `_liwan_store` always sets the key, so a stored
        # delivery without one cannot exist and the index needs no partial WHERE clause.
        field = self.env['liwan.inbox.event']._fields['dedupe_key']
        self.assertTrue(field.required)
        self.assertFalse(field.index, 'the unique index already covers the column; a second btree index is dead weight')
        event = self.store_event(self.channel, wa.inbound_text())
        with self.assertRaises(UniqueViolation), self.env.cr.savepoint():
            self.env['liwan.inbox.event'].create({
                'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id,
                'payload': event.payload, 'dedupe_key': event.dedupe_key,
            })
        with self.assertRaises(NotNullViolation), self.env.cr.savepoint():
            self.env['liwan.inbox.event'].create({
                'channel_id': self.channel.id, 'owner_company_id': self.channel.owner_company_id.id,
                'payload': event.payload,
            })

    def test_a_replayed_resume_cannot_withdraw_a_later_opt_out(self):
        # The sharp end of a replay (A9-F3): a captured `user_preferences: resume` delivery, replayed after
        # the customer sent `stop`, must not withdraw the marketing opt-out. The delivery was already stored,
        # so the replay is not processed at all and the consent history keeps one opt-out.
        contact = self.env['liwan.inbox.contact'].create({
            'name': 'Sara', 'phone': '+966501112222', 'company_id': self.channel.owner_company_id.id,
        })
        self.env['liwan.inbox.contact.identity'].create({
            'contact_id': contact.id, 'channel_kind': 'whatsapp', 'address': '966501112222',
            'company_id': self.channel.owner_company_id.id,
        })

        def preference(value):
            payload = wa.payload(wa.PHONE_ID)
            payload['entry'][0]['changes'][0]['value']['user_preferences'] = [{
                'wa_id': '966501112222', 'category': 'marketing_messages', 'value': value,
                'timestamp': str(wa.TIMESTAMP),
            }]
            return wa.body_of(payload)

        resume_raw, stop_raw = preference('resume'), preference('stop')
        self.assertEqual(self.post(None, raw=resume_raw).status_code, 200)
        self.assertEqual(self.post(None, raw=stop_raw).status_code, 200)
        self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual((contact.marketing_consent, contact.marketing_consent_source), ('opted_out', 'whatsapp'))
        decisions = contact.consent_ids
        # The replay is accepted (the provider must not retry) and changes nothing at all.
        self.assertEqual(self.post(None, raw=resume_raw).status_code, 200)
        self.env['liwan.inbox.event']._liwan_run_events()
        self.assertEqual(len(self.events()), 2, 'the replayed resume is not stored twice')
        self.assertEqual(contact.consent_ids, decisions)
        self.assertEqual(contact.marketing_consent, 'opted_out')

    def test_an_old_envelope_is_still_stored_once(self):
        # Meta signs the body alone, so its age proves nothing: Meta retries after an outage for days, and
        # the signature stays valid. The dedupe key is the replay bound, not the envelope's own timestamp.
        data = wa.inbound_text()
        for entry in data['entry']:
            entry['time'] = wa.TIMESTAMP
        raw = wa.body_of(data)
        self.assertEqual(self.post(None, raw=raw).status_code, 200)
        self.assertEqual(self.post(None, raw=raw).status_code, 200)
        self.assertEqual(len(self.events()), 1)

    def test_a_delivery_without_an_envelope_time_is_judged_by_its_dedupe_key(self):
        data = wa.inbound_text()
        for entry in data['entry']:
            entry.pop('time', None)
        raw = wa.body_of(data)
        self.assertEqual(self.post(None, raw=raw).status_code, 200)
        self.assertEqual(self.post(None, raw=raw).status_code, 200)
        self.assertEqual(len(self.events()), 1)

    def test_a_disabled_channel_receives_nothing(self):
        self.channel.state = 'disabled'
        self.assertError(self.post(wa.inbound_text()), 403, 'forbidden')
        self.assertFalse(self.events())

    def test_closed_whatsapp_feature_refuses_the_hook(self):
        set_probe_feature(self, key='inbox.whatsapp', enabled=False)
        self.assertError(self.post(wa.inbound_text()), 403, 'feature_not_included')
        self.assertError(self.verify(self.channel._liwan_verify_token()), 403, 'feature_not_included')

    def test_without_the_master_key_a_delivery_is_refused_like_a_bad_signature(self):
        with patch.dict('os.environ', {}, clear=False) as env:
            env.pop('LIWAN_INBOX_SECRET_KEY', None)
            self.assertError(self.post(wa.inbound_text()), 403, 'forbidden')
        self.assertFalse(self.events())
