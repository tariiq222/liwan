# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Connecting a TikTok business account: the signed authorization URL and its callback."""
import base64
import hashlib
import hmac
import json
import os
import time
from datetime import timedelta
from unittest.mock import patch
from urllib.parse import parse_qs, quote, urlparse

from odoo import fields
from odoo.tests import tagged
from odoo.tests.common import HOST

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import tiktok
from odoo.addons.liwan_inbox.models import secret_box
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE

REDIRECT_URI = 'https://liwan.test/api/v1/inbox/tiktok/callback'
CONNECT = '/api/v1/inbox/channels/tiktok/connect'
CALLBACK = '/api/v1/inbox/tiktok/callback'
SETTINGS_PATH = '/settings/apps/inbox'
ACCESS_TOKEN = 'tiktok-access-token-1'
REFRESH_TOKEN = 'tiktok-refresh-token-1'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokOAuth(LiwanInboxCase):

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

    def grant(self, open_id=tt.BUSINESS_ID, scopes=None):
        now = fields.Datetime.now()
        return tiktok.TokenGrant(
            open_id=open_id,
            scopes=frozenset(tiktok.SCOPES if scopes is None else scopes),
            access_token=ACCESS_TOKEN,
            refresh_token=REFRESH_TOKEN,
            expires_at=now + timedelta(days=1),
            refresh_expires_at=now + timedelta(days=365),
        )

    def state(self, **overrides):
        """A state signed the way the connect route signs it, for the refusal cases."""
        values = {
            'c': self.env.company.id, 'u': self.manager.id, 'ch': 0, 'n': 'TikTok shop', 'd': 0,
            'h': HOST, 'x': int(time.time()) + 600, **overrides,
        }
        payload = base64.urlsafe_b64encode(
            json.dumps(values, separators=(',', ':'), sort_keys=True).encode(),
        ).decode().rstrip('=')
        signature = hmac.new(tt.CLIENT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return f'{payload}.{signature}'

    def connect(self, **payload):
        return self.api('POST', CONNECT, {'name': 'TikTok shop', **payload})

    def connect_state(self, **payload):
        response = self.connect(**payload)
        self.assertEqual(response.status_code, 200, response.text)
        return parse_qs(urlparse(response.json()['authorize_url']).query)['state'][0]

    def callback(self, state, code='auth-code-1'):
        return self.url_open(
            f'{CALLBACK}?code={code}&state={state}', method='GET', allow_redirects=False,
        )

    def redirects_to_error(self, response, reason):
        self.assertEqual(response.status_code, 302, response.text)
        self.assertEqual(response.headers['Location'], f'{SETTINGS_PATH}?tiktok_error={reason}')

    def channels(self):
        return self.env['liwan.inbox.channel'].search([('kind', '=', 'tiktok')])

    def answer(self, grant=None):
        """Exchange and profile answers of a successful callback, without any network call."""
        return (
            patch.object(tiktok, 'exchange_code', return_value=grant or self.grant()),
            patch.object(tiktok, 'business_profile', return_value=tiktok.Profile('liwan_shop', 'Liwan Shop')),
        )

    def test_connect_returns_a_signed_authorize_url(self):
        self.login(self.manager)
        response = self.connect(department_id=self.department.id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(list(response.json()), ['authorize_url'])
        parsed = urlparse(response.json()['authorize_url'])
        self.assertEqual((parsed.scheme, parsed.netloc, parsed.path), ('https', 'www.tiktok.com', '/v2/auth/authorize'))
        query = parse_qs(parsed.query)
        self.assertEqual(query['response_type'], ['code'])
        self.assertEqual(query['client_key'], [tt.CLIENT_KEY])
        self.assertEqual(query['redirect_uri'], [REDIRECT_URI])
        self.assertEqual(query['scope'], [','.join(tiktok.SCOPES)])
        payload, _, signature = query['state'][0].partition('.')
        expected = hmac.new(tt.CLIENT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(signature, expected)
        values = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        self.assertEqual(
            (values['c'], values['u'], values['ch'], values['n'], values['d'], values['h']),
            (self.env.company.id, self.manager.id, 0, 'TikTok shop', self.department.id, HOST),
        )
        self.assertGreater(values['x'], int(time.time()))

    def test_connect_needs_channel_management_and_the_tiktok_feature(self):
        self.login(self.agent)
        self.assertError(self.connect(), 403, 'forbidden')
        self.login(self.manager)
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=False)
        self.assertError(self.connect(), 403, 'feature_not_included')
        self.assertFalse(self.channels())

    def test_connect_without_the_app_configuration_is_422(self):
        self.login(self.manager)
        with patch.dict(os.environ, {'LIWAN_TIKTOK_CLIENT_KEY': ''}):
            response = self.connect()
        self.assertError(response, 422, 'invalid')
        self.assertEqual(response.json()['details']['reason'], 'inbox_tiktok_not_configured')

    def test_connect_only_reconnects_a_tiktok_channel(self):
        self.login(self.manager)
        self.assertError(self.connect(channel_id=self.channel.id), 422, 'invalid')

    def test_callback_creates_a_connected_channel_with_encrypted_tokens(self):
        self.login(self.manager)
        exchange, profile = self.answer()
        with exchange, profile:
            response = self.callback(self.connect_state())
        channel = self.channels()
        self.assertEqual(len(channel), 1)
        self.assertEqual(response.status_code, 302, response.text)
        self.assertEqual(response.headers['Location'], f'{SETTINGS_PATH}/channels/{channel.id}')
        self.assertEqual(
            (channel.kind, channel.state, channel.tiktok_business_id, channel.tiktok_username),
            ('tiktok', 'connected', tt.BUSINESS_ID, 'liwan_shop'),
        )
        self.assertEqual(channel.owner_company_id, self.env.company)
        self.assertTrue(channel.token_expires_at and channel.refresh_expires_at)
        self.assertNotIn(ACCESS_TOKEN, channel.access_token_enc)
        self.assertNotIn(REFRESH_TOKEN, channel.refresh_token_enc)
        self.assertEqual(secret_box.decrypt(self.env, channel.access_token_enc), ACCESS_TOKEN)
        self.assertEqual(secret_box.decrypt(self.env, channel.refresh_token_enc), REFRESH_TOKEN)
        # The never-returned tokens appear in no part of the redirect answer.
        self.assertNotIn(ACCESS_TOKEN, response.text)
        self.assertNotIn(REFRESH_TOKEN, response.text)

    def test_a_tampered_expired_or_foreign_state_is_refused(self):
        self.login(self.manager)
        good = self.state()
        tampered = good[:-1] + ('0' if good[-1] != '0' else '1')
        expired = self.state(x=int(time.time()) - 1)
        foreign = self.state(u=self.agent2.id)
        exchange, profile = self.answer()
        with exchange, profile:
            for state in (tampered, expired, foreign, 'not-a-state'):
                self.assertError(self.callback(state), 403, 'forbidden')
        self.assertFalse(self.channels())

    def test_a_non_ascii_state_is_refused_not_raised(self):
        # A query string decodes to latin-1, so a `%FF` reaches the callback as a non-ASCII str; comparing
        # it with the ASCII signature raises TypeError and the callback would answer 500 instead of 403.
        self.login(self.manager)
        payload, _, signature = self.state().partition('.')
        exchange, profile = self.answer()
        with exchange, profile:
            for state in (f'{payload}.%FF{signature}', f'{payload}.\u00e9{signature}'):
                self.assertError(self.callback(quote(state, safe='%.')), 403, 'forbidden')

    def test_a_missing_scope_redirects_to_the_error_page(self):
        self.login(self.manager)
        exchange, profile = self.answer(self.grant(scopes={'user.info.basic', 'message.list.read'}))
        with exchange, profile:
            response = self.callback(self.state())
        self.redirects_to_error(response, 'inbox_tiktok_scopes_missing')
        self.assertFalse(self.channels())

    def test_the_same_account_twice_redirects_as_taken(self):
        existing = self.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': tt.BUSINESS_ID, 'state': 'connected',
        })
        self.login(self.manager)
        exchange, profile = self.answer()
        with exchange, profile:
            response = self.callback(self.state())
        self.redirects_to_error(response, 'inbox_tiktok_account_taken')
        self.assertEqual(self.channels().ids, existing.ids)

    def test_reconnect_updates_the_same_channel(self):
        channel = self.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': tt.BUSINESS_ID,
            'state': 'error', 'last_error': 'reconnect the account',
        })
        self.login(self.manager)
        state = self.connect_state(channel_id=channel.id)
        exchange, profile = self.answer()
        with exchange, profile:
            response = self.callback(state)
        self.assertEqual(response.headers['Location'], f'{SETTINGS_PATH}/channels/{channel.id}')
        self.assertEqual(self.channels().ids, channel.ids)
        channel = self.reload(channel)
        self.assertEqual((channel.state, channel.last_error), ('connected', False))
        self.assertEqual(channel.tiktok_username, 'liwan_shop')
        self.assertEqual(secret_box.decrypt(self.env, channel.access_token_enc), ACCESS_TOKEN)
