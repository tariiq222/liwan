# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The public TikTok webhook: signed deliveries of the connected business account only."""
import json
import os
import time
from unittest.mock import patch

from odoo.tests import tagged

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE

HOOK = '/api/v1/inbox/hooks/tiktok'
BUSINESS_ID = tt.BUSINESS_ID
OVERSIZED = b'{"pad": "' + b'x' * (1024 * 1024) + b'"}'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokWebhook(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, {
            'LIWAN_TIKTOK_CLIENT_KEY': tt.CLIENT_KEY,
            'LIWAN_TIKTOK_CLIENT_SECRET': tt.CLIENT_SECRET,
            'LIWAN_TIKTOK_REDIRECT_URI': 'https://liwan.test/api/v1/inbox/tiktok/callback',
        })
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)
        cls.tiktok = cls.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': BUSINESS_ID, 'state': 'connected',
        })

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)

    def post(self, payload, secret=tt.CLIENT_SECRET, now=None, raw=None):
        raw = json.dumps(payload).encode() if raw is None else raw
        header = tt.signed(raw, secret, int(time.time()) if now is None else now)
        return self.url_open(HOOK, data=raw, headers={
            'Content-Type': 'application/json', 'Tiktok-Signature': header,
        }, method='POST')

    def events(self, channel=None):
        return self.env['liwan.inbox.event'].search([('channel_id', '=', (channel or self.tiktok).id)])

    def test_a_signed_delivery_creates_one_event_and_nothing_else(self):
        raw = json.dumps(tt.receive_text()).encode()
        response = self.post(None, raw=raw)
        self.assertEqual((response.status_code, response.text), (200, 'ok'))
        event = self.events()
        self.assertEqual((len(event), event.state, event.payload.encode()), (1, 'pending', raw))
        self.assertEqual(event.owner_company_id, self.tiktok.owner_company_id)

    def test_a_read_only_branch_records_only_a_signed_delivery(self):
        self.env['liwan.tenant.branch'].create({
            'branch_uid': 'tiktok-ro', 'company_id': self.tiktok.owner_company_id.id,
            'operation_id': 'tiktok-hook', 'read_only': True,
        })
        self.assertError(self.post(tt.receive_text(), secret='another-secret'), 403, 'forbidden')
        self.assertFalse(self.events())
        self.assertEqual(self.post(tt.receive_text()).status_code, 200)
        self.assertEqual(len(self.events()), 1)

    def test_a_bad_signature_and_an_unknown_business_answer_the_same_403(self):
        bad_signature = self.post(tt.receive_text(), secret='another-secret')
        unknown = self.post(tt.envelope('im_receive_msg', tt.message('text', {'body': 'Hi'}),
                                       business_id='unknown-business-open-id'))
        missing = self.url_open(HOOK, data=b'{}', headers={'Content-Type': 'application/json'}, method='POST')
        for response in (bad_signature, unknown, missing):
            self.assertError(response, 403, 'forbidden')
        self.assertEqual(bad_signature.content, unknown.content)
        self.assertEqual(bad_signature.content, missing.content)
        self.assertFalse(self.events())

    def test_the_tenant_window_accepts_a_delivery_the_relay_forwarded_late(self):
        # The relay already verified the delivery with its own five-second window; the tenant is the
        # second hop and trusts that verification, so a delivery 6-8s old (the forward alone may take
        # ten) must still be accepted rather than refused as a replay by a second clock (A09-F4).
        # Each delivery is its own message: the dedupe key stores each once, so all three are accepted.
        for offset in (6, 8, 12):
            with self.subTest(offset=offset):
                self.assertEqual(self.post(tt.receive_text(message_id=f'msg-late-{offset}'), now=int(time.time()) - offset).status_code, 200)
        self.assertEqual(len(self.events()), 3)

    def test_the_tenant_still_refuses_a_delivery_beyond_its_relay_window(self):
        self.assertError(self.post(tt.receive_text(), now=int(time.time()) - 31), 403, 'forbidden')
        self.assertFalse(self.events())

    def test_a_delivery_replayed_to_the_tenant_is_stored_once(self):
        # The tenant's wider window is bounded by the event dedupe key: the same signed delivery twice
        # leaves one event and one side effect, whatever the timestamp.
        raw = json.dumps(tt.receive_text()).encode()
        now = int(time.time())
        self.assertEqual(self.post(None, raw=raw, now=now - 8).status_code, 200)
        self.assertEqual(self.post(None, raw=raw, now=now - 8).status_code, 200)
        self.assertEqual(len(self.events()), 1)

    def test_a_disabled_channel_receives_nothing(self):
        self.tiktok.state = 'disabled'
        self.assertError(self.post(tt.receive_text()), 403, 'forbidden')
        self.assertFalse(self.events())

    def test_a_closed_feature_refuses_the_hook(self):
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=False)
        self.assertError(self.post(tt.receive_text()), 403, 'feature_not_included')
        self.assertFalse(self.events())

    def test_an_oversized_body_is_413(self):
        response = self.post(None, raw=OVERSIZED)
        self.assertEqual(response.status_code, 413)
        self.assertFalse(self.events())

    def test_a_malformed_body_is_refused_like_a_bad_signature(self):
        response = self.url_open(HOOK, data=b'not json', headers={
            'Content-Type': 'application/json', 'Tiktok-Signature': tt.signed(b'not json', tt.CLIENT_SECRET, int(time.time())),
        }, method='POST')
        self.assertError(response, 403, 'forbidden')

    def test_without_the_app_secret_a_delivery_is_refused(self):
        with patch.dict(os.environ, {'LIWAN_TIKTOK_CLIENT_SECRET': ''}):
            self.assertError(self.post(tt.receive_text()), 403, 'forbidden')
        self.assertFalse(self.events())
