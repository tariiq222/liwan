# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""TikTok access tokens: one refresh near expiry, a locked channel row, and the reconnect error."""
import os
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import tagged

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.models import secret_box
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE

BUSINESS_ID = 'business-open-id-tokens'
REDIRECT_URI = 'https://liwan.test/api/v1/inbox/tiktok/callback'
OLD_ACCESS = 'old-access-token-1'
OLD_REFRESH = 'old-refresh-token-1'
NEW_ACCESS = 'new-access-token-1'
NEW_REFRESH = 'new-refresh-token-1'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokTokens(LiwanInboxCase):

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

    def make_tiktok(self, access_expires_in=timedelta(days=1), refresh_expires_in=timedelta(days=30)):
        now = fields.Datetime.now()
        return self.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': BUSINESS_ID, 'state': 'connected',
            'access_token_enc': secret_box.encrypt(self.env, OLD_ACCESS),
            'refresh_token_enc': secret_box.encrypt(self.env, OLD_REFRESH),
            'token_expires_at': now + access_expires_in,
            'refresh_expires_at': now + refresh_expires_in,
        })

    def refreshed(self):
        now = fields.Datetime.now()
        return tiktok.TokenGrant(
            open_id=BUSINESS_ID, scopes=frozenset(tiktok.SCOPES), access_token=NEW_ACCESS,
            refresh_token=NEW_REFRESH, expires_at=now + timedelta(days=1),
            refresh_expires_at=now + timedelta(days=30),
        )

    def test_a_token_far_from_its_margin_is_reused(self):
        channel = self.make_tiktok()
        with patch.object(tiktok, 'refresh_tokens') as refresh:
            credentials = channel._liwan_credentials()
        self.assertEqual(refresh.call_count, 0)
        self.assertEqual((credentials.business_id, credentials.access_token), (BUSINESS_ID, OLD_ACCESS))

    def test_a_token_near_its_margin_is_refreshed_once(self):
        channel = self.make_tiktok(access_expires_in=timedelta(minutes=1))
        grant = self.refreshed()
        with patch.object(tiktok, 'refresh_tokens', return_value=grant) as refresh:
            credentials = channel._liwan_credentials()
        self.assertEqual(refresh.call_count, 1)
        config, refresh_token = refresh.call_args.args
        self.assertEqual((config.client_key, refresh_token), (tt.CLIENT_KEY, OLD_REFRESH))
        self.assertEqual(credentials.access_token, NEW_ACCESS)
        self.assertEqual(secret_box.decrypt(self.env, channel.access_token_enc), NEW_ACCESS)
        self.assertEqual(secret_box.decrypt(self.env, channel.refresh_token_enc), NEW_REFRESH)
        self.assertEqual(channel.token_expires_at, grant.expires_at)
        self.assertEqual(channel.refresh_expires_at, grant.refresh_expires_at)
        self.assertEqual((channel.state, channel.last_error), ('connected', False))

    def test_two_callers_refresh_once(self):
        channel = self.make_tiktok(access_expires_in=timedelta(minutes=1))
        self.assertTrue(channel.token_expires_at)  # a caller that read the channel caches the old deadline
        grant = self.refreshed()
        with patch.object(tiktok, 'refresh_tokens', return_value=grant) as refresh:
            first = channel._liwan_credentials()
            second = channel._liwan_credentials()
        self.assertEqual(refresh.call_count, 1)
        self.assertEqual((first.access_token, second.access_token), (NEW_ACCESS, NEW_ACCESS))

    def test_the_channel_row_is_locked_before_the_refresh(self):
        channel = self.make_tiktok()
        statements = []
        execute = self.env.cr.execute

        def spy(query, params=None, **kwargs):
            statements.append(str(query))
            return execute(query, params, **kwargs)

        with patch.object(self.env.cr, 'execute', side_effect=spy):
            channel._liwan_credentials()
        self.assertTrue(any('FOR UPDATE' in statement.upper() for statement in statements))

    def test_an_expired_refresh_token_asks_for_a_reconnect(self):
        channel = self.make_tiktok(access_expires_in=timedelta(minutes=1), refresh_expires_in=timedelta(minutes=-1))
        with patch.object(tiktok, 'refresh_tokens') as refresh:
            message = self.reconnect_error(channel)
        self.assertEqual(refresh.call_count, 0)
        self.assertEqual(channel.state, 'error')
        self.assertIn('reconnect', channel.last_error.lower())
        self.assertIn('reconnect', message.lower())

    def test_a_refused_refresh_marks_the_channel_and_is_not_retried(self):
        channel = self.make_tiktok(access_expires_in=timedelta(minutes=1))
        refused = errors.ProviderError('invalid refresh token', retryable=False)
        with patch.object(tiktok, 'refresh_tokens', side_effect=refused) as refresh:
            self.reconnect_error(channel)
        self.assertEqual(refresh.call_count, 1)
        self.assertEqual(channel.state, 'error')
        self.assertIn('reconnect', channel.last_error.lower())
        self.assertEqual(secret_box.decrypt(self.env, channel.refresh_token_enc), OLD_REFRESH)

    def test_a_channel_without_tokens_asks_for_a_reconnect(self):
        channel = self.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': 'business-open-id-empty',
        })
        message = self.reconnect_error(channel)
        self.assertEqual(channel.state, 'error')
        self.assertIn('reconnect', message.lower())

    def reconnect_error(self, channel):
        """Call the credentials of `channel` and return the UserError message asking for a reconnect."""
        try:
            channel._liwan_credentials()
        except UserError as error:
            return str(error)
        message = 'the channel did not ask for a reconnect'
        raise AssertionError(message)
