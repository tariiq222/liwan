# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The shared relay binding of a TikTok account (D13): connect binds, delete unbinds, the cron retries."""
import base64
import hashlib
import hmac
import json
import os
import time
from datetime import timedelta
from unittest.mock import patch

import requests

from odoo import fields
from odoo.tests import tagged
from odoo.tests.common import HOST

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.adapters import tiktok
from odoo.addons.liwan_inbox.models import channel_tiktok
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE

RELAY_URL = 'http://tiktok-relay:8090'
PROXY_TOKEN = 'test-only-relay-proxy-token-0123456789'
REDIRECT_URI = 'https://liwan.test/api/v1/inbox/tiktok/callback'
CALLBACK = '/api/v1/inbox/tiktok/callback'
ACCESS_TOKEN = 'tiktok-access-token-relay'
REFRESH_TOKEN = 'tiktok-refresh-token-relay'
OTHER_BUSINESS_ID = 'business-open-id-other'


class Answer:
    """The relay's answer as `requests` exposes it: a status and its `ok` property."""

    def __init__(self, status_code=200):
        self.status_code = status_code

    @property
    def ok(self):
        return self.status_code < 400


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokRelay(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, {
            'LIWAN_TIKTOK_CLIENT_KEY': tt.CLIENT_KEY,
            'LIWAN_TIKTOK_CLIENT_SECRET': tt.CLIENT_SECRET,
            'LIWAN_TIKTOK_REDIRECT_URI': REDIRECT_URI,
        })
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)

    def relay(self, url=RELAY_URL, token=PROXY_TOKEN):
        """The operator's relay configuration for one deployment, restored at the end of the test."""
        return patch.dict(os.environ, {'LIWAN_TIKTOK_RELAY_URL': url, 'LIWAN_TIKTOK_RELAY_TOKEN': token})

    def grant(self, open_id=tt.BUSINESS_ID):
        now = fields.Datetime.now()
        return tiktok.TokenGrant(
            open_id=open_id,
            scopes=frozenset(tiktok.SCOPES),
            access_token=ACCESS_TOKEN,
            refresh_token=REFRESH_TOKEN,
            expires_at=now + timedelta(days=1),
            refresh_expires_at=now + timedelta(days=365),
        )

    def state(self):
        """A state signed the way the connect route signs it: base64url JSON, a dot, its hex HMAC."""
        values = {
            'c': self.env.company.id, 'u': self.manager.id, 'ch': 0, 'n': 'TikTok shop', 'd': 0,
            'h': HOST, 'x': int(time.time()) + 600,
        }
        payload = base64.urlsafe_b64encode(
            json.dumps(values, separators=(',', ':'), sort_keys=True).encode(),
        ).decode().rstrip('=')
        return f'{payload}.{hmac.new(tt.CLIENT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()}'

    def make_tiktok(self, business_id=tt.BUSINESS_ID, bound=False, state='connected'):
        return self.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': business_id,
            'state': state, 'tiktok_bound': bound,
        })

    def channels(self):
        return self.env['liwan.inbox.channel'].search([('kind', '=', 'tiktok')])

    def connect_callback(self):
        """Run the OAuth callback with only the provider answers mocked; returns the HTTP answer."""
        self.login(self.manager)
        with patch.object(tiktok, 'exchange_code', return_value=self.grant()), \
                patch.object(tiktok, 'business_profile', return_value=tiktok.Profile('liwan_shop', 'Liwan Shop')):
            return self.url_open(f'{CALLBACK}?code=auth-code-1&state={self.state()}', method='GET', allow_redirects=False)

    def test_connect_binds_the_account_with_the_tenant_database(self):
        with self.relay(), patch.object(channel_tiktok.requests, 'request', return_value=Answer()) as request:
            response = self.connect_callback()
        self.assertEqual(response.status_code, 302, response.text)
        channel = self.channels()
        self.assertEqual(len(channel), 1)
        self.assertTrue(channel.tiktok_bound)
        self.assertEqual(request.call_count, 1)
        args, kwargs = request.call_args
        self.assertEqual(args, ('PUT', f'{RELAY_URL}/internal/tiktok/bindings/{tt.BUSINESS_ID}'))
        self.assertEqual(kwargs['headers'], {'X-Liwan-Proxy-Token': PROXY_TOKEN})
        self.assertEqual(kwargs['json'], {'tenant_id': self.env.cr.dbname})
        self.assertNotIn(PROXY_TOKEN, str(kwargs['json']))

    def test_connect_makes_no_relay_call_without_its_url(self):
        with self.relay(url=''), patch.object(channel_tiktok.requests, 'request') as request:
            response = self.connect_callback()
        self.assertEqual(response.status_code, 302, response.text)
        request.assert_not_called()
        self.assertFalse(self.channels().tiktok_bound)

    def test_a_relay_without_its_token_stays_unused(self):
        channel = self.make_tiktok()
        with self.relay(token=''), patch.object(channel_tiktok.requests, 'request') as request:
            self.assertFalse(channel._liwan_tiktok_bind())
        request.assert_not_called()
        self.assertFalse(channel.tiktok_bound)

    def test_deleting_a_channel_unbinds_it(self):
        channel = self.make_tiktok(bound=True)
        with self.relay(), patch.object(channel_tiktok.requests, 'request', return_value=Answer()) as request:
            channel.unlink()
        self.assertFalse(self.channels())
        args, kwargs = request.call_args
        self.assertEqual(args, ('DELETE', f'{RELAY_URL}/internal/tiktok/bindings/{tt.BUSINESS_ID}'))
        # The relay token proves no tenant, so the unbind names this one, as the bind does.
        self.assertEqual(kwargs['json'], {'tenant_id': self.env.cr.dbname})
        self.assertNotIn(PROXY_TOKEN, str(kwargs['json']))

    def test_a_bound_channel_is_not_registered_again(self):
        self.make_tiktok(bound=True)
        with self.relay(), patch.object(channel_tiktok.requests, 'request') as request:
            self.env['liwan.inbox.channel']._liwan_retry_tiktok_bindings()
        request.assert_not_called()

    def test_the_cron_retries_a_channel_the_relay_refused(self):
        channel = self.make_tiktok()
        with self.relay(), patch.object(channel_tiktok.requests, 'request', return_value=Answer(503)) as request:
            self.env['liwan.inbox.channel']._liwan_retry_tiktok_bindings()
        self.assertEqual(request.call_count, 1)
        self.assertFalse(self.reload(channel).tiktok_bound)
        with self.relay(), patch.object(channel_tiktok.requests, 'request', return_value=Answer()) as request:
            self.env['liwan.inbox.channel']._liwan_retry_tiktok_bindings()
        self.assertEqual(request.call_count, 1)
        self.assertTrue(self.reload(channel).tiktok_bound)

    def test_a_binding_conflict_leaves_the_channel_unbound(self):
        channel = self.make_tiktok()
        with self.relay(), patch.object(channel_tiktok.requests, 'request', return_value=Answer(409)):
            self.assertFalse(channel._liwan_tiktok_bind())
        self.assertFalse(channel.tiktok_bound)

    def test_an_unreachable_relay_leaves_the_channel_unbound(self):
        channel = self.make_tiktok()
        with self.relay(), patch.object(
            channel_tiktok.requests, 'request', side_effect=requests.ConnectionError('down'),
        ):
            self.assertFalse(channel._liwan_tiktok_bind())
        self.assertFalse(channel.tiktok_bound)

    def test_reconnecting_another_account_unbinds_the_old_one(self):
        channel = self.make_tiktok(bound=True)
        with self.relay(), patch.object(channel_tiktok.requests, 'request', return_value=Answer()) as request:
            channel._liwan_tiktok_store(self.grant(open_id=OTHER_BUSINESS_ID))
        self.assertEqual(channel.tiktok_business_id, OTHER_BUSINESS_ID)
        self.assertFalse(channel.tiktok_bound)
        args, kwargs = request.call_args
        self.assertEqual(args, ('DELETE', f'{RELAY_URL}/internal/tiktok/bindings/{tt.BUSINESS_ID}'))
        self.assertEqual(kwargs['json'], {'tenant_id': self.env.cr.dbname})

    def test_a_refused_deletion_keeps_the_relay_binding(self):
        """A channel with conversations cannot be deleted, so its binding must not be removed."""
        channel = self.make_tiktok(bound=True)
        self.make_conversation(channel=channel)
        with self.relay(), patch.object(channel_tiktok.requests, 'request') as request:
            with self.assertRaises(LiwanAccessRule):
                channel.unlink()
        request.assert_not_called()
        self.assertTrue(self.reload(channel).tiktok_bound)
