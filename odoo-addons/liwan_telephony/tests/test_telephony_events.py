# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import hmac
import json
import time

from odoo.tests import tagged

from .common import LiwanTelephonyCase, set_feature


def envelope(event_id, state='answered', linkedid='1764049999.9'):
    return {
        'event_id': event_id,
        'database': 'test',
        'occurred_at': '2026-11-25T09:00:05.000000Z',
        'source': 'ari',
        'reconciled': False,
        'call': {
            'linkedid': linkedid,
            'uniqueid': linkedid,
            'channel': 'PJSIP/1001-00000001',
            'direction': 'in',
            'caller_number': '966500000000',
            'connected_number': '1001',
            'dialed_exten': '1001',
            'state': state,
            'started_at': '2026-11-25T09:00:00.000000Z',
            'answered_at': '2026-11-25T09:00:05.000000Z',
            'ended_at': None,
        },
    }


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyEvents(LiwanTelephonyCase):

    def setUp(self):
        super().setUp()
        set_feature(self, 'telephony.enabled')
        self.env['ir.config_parameter'].sudo().set_param(
            'liwan.telephony.events_key_root', 'ab' * 32,
        )

    def post(self, payload, when=None, signature=None):
        """Post the exact bytes that were signed, the way the agent does."""
        when = int(time.time()) if when is None else when

        def body_with(sig):
            return json.dumps(
                {'payload': payload, 'timestamp': when, 'signature': sig},
                separators=(',', ':'),
            ).encode()

        database = self.env.cr.dbname
        key = hmac.new(
            bytes.fromhex('ab' * 32),
            b'liwan-telephony-events/v1\n' + database.encode(),
            hashlib.sha256,
        ).hexdigest()
        signed = signature if signature is not None else hmac.new(
            bytes.fromhex(key),
            str(when).encode() + b'\n' + body_with(''),
            hashlib.sha256,
        ).hexdigest()
        return self.url_open(
            '/api/v1/telephony/events',
            data=body_with(signed),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )

    def test_an_event_creates_the_call_once(self):
        first = self.post(envelope('e-1', linkedid='1764049999.9'))
        self.assertTrue(first.json()['applied'])
        second = self.post(envelope('e-1', linkedid='1764049999.9'))
        self.assertFalse(second.json()['applied'])
        calls = self.env['liwan.telephony.call'].search([('linkedid', '=', '1764049999.9')])
        self.assertEqual(len(calls), 1)

    def test_a_bad_signature_is_refused(self):
        result = self.post(envelope('e-2'), signature='00' * 32)
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_an_old_timestamp_is_refused(self):
        result = self.post(envelope('e-3'), when=int(time.time()) - 3600, signature=None)
        self.assertEqual(result.status_code, 403)


@tagged('post_install', '-at_install', 'liwan')
class TestTelephonyServiceUser(LiwanTelephonyCase):

    def test_the_service_user_is_inactive_and_has_its_own_group(self):
        rows = self.env['ir.model.access'].search([('name', 'like', 'liwan.telephony.call.')])
        self.assertTrue(rows, 'the call ACL rows exist')
        user = self.env.ref('liwan_telephony.user_telephony_events')
        self.assertFalse(user.active)
        self.assertIn('Telephony events (machine)', user.group_ids.mapped('name'))

    def test_the_events_user_can_write_a_call(self):
        """The machine route's own account: the reason the route can act at all after the key is verified."""
        user = self.env.ref('liwan_telephony.user_telephony_events')
        self.env['ir.model.access'].search([('name', '=', 'liwan.telephony.call.events')])
        call = self.env['liwan.telephony.call'].with_user(user).create({
            'linkedid': '1764049999.77',
            'direction': 'in',
            'state': 'ringing',
        })
        self.assertTrue(call.exists())
        self.assertEqual(user.group_ids.mapped('name'), ['Telephony events (machine)'])
