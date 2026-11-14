# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A TikTok channel reads its token through its connection; the refresh itself is the integrations service's."""
import os
from datetime import timedelta
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from . import tiktok_payloads as tt
from .common import LiwanInboxCase, tiktok_grant
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors
from odoo.addons.liwan_inbox.models.constants import TIKTOK_FEATURE
from odoo.addons.liwan_integrations_sa.providers import errors as integration_errors
from odoo.addons.liwan_integrations_sa.providers import tiktok as integration_tiktok

BUSINESS_ID = 'business-open-id-tokens'
NEW_ACCESS = 'new-access-token-1'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokTokens(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        env_patch = patch.dict(os.environ, {
            'LIWAN_TIKTOK_CLIENT_KEY': tt.CLIENT_KEY,
            'LIWAN_TIKTOK_CLIENT_SECRET': tt.CLIENT_SECRET,
            'LIWAN_TIKTOK_REDIRECT_URI': 'https://liwan.test/api/v1/integrations/oauth/tiktok/callback',
        })
        env_patch.start()
        cls.addClassCleanup(env_patch.stop)

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)

    def test_the_credentials_are_the_connections_account_and_token(self):
        channel = self.make_tiktok_channel(BUSINESS_ID)
        with patch.object(integration_tiktok, 'refresh_tokens') as refresh:
            credentials = channel._liwan_credentials()
        self.assertEqual(refresh.call_count, 0)
        self.assertEqual((credentials.business_id, credentials.access_token), (BUSINESS_ID, 'tiktok-access-token-1'))

    def test_a_token_near_its_deadline_is_refreshed_by_the_service(self):
        channel = self.make_tiktok_channel(BUSINESS_ID, tiktok_grant(open_id=BUSINESS_ID, expires_in=timedelta(minutes=1)))
        grant = tiktok_grant(open_id=BUSINESS_ID, access_token=NEW_ACCESS)
        with patch.object(integration_tiktok, 'refresh_tokens', return_value=grant) as refresh:
            credentials = channel._liwan_credentials()
        self.assertEqual(refresh.call_count, 1)
        self.assertEqual(credentials.access_token, NEW_ACCESS)

    def test_a_refused_authorization_asks_for_a_reconnect(self):
        channel = self.make_tiktok_channel(BUSINESS_ID, tiktok_grant(open_id=BUSINESS_ID, expires_in=timedelta(minutes=1)))
        refused = integration_errors.ProviderError('invalid refresh token', retryable=False)
        message = None
        with patch.object(integration_tiktok, 'refresh_tokens', side_effect=refused):
            try:
                channel._liwan_credentials()
            except UserError as error:
                # Odoo's assertRaises would roll back the state the call wrote.
                message = str(error)
        self.assertIn('again', (message or '').lower())
        self.assertEqual(channel.connection_id.state, 'error')

    def test_a_transient_failure_reaches_the_caller_as_a_retryable_inbox_error(self):
        channel = self.make_tiktok_channel(BUSINESS_ID, tiktok_grant(open_id=BUSINESS_ID, expires_in=timedelta(minutes=1)))
        transient = integration_errors.ProviderError('rate limited', retryable=True, code=429)
        with patch.object(integration_tiktok, 'refresh_tokens', side_effect=transient), \
                self.assertRaises(errors.ProviderError) as raised:
            channel._liwan_credentials()
        self.assertEqual((raised.exception.retryable, raised.exception.code, str(raised.exception)), (True, 429, 'rate limited'))
        self.assertEqual(channel.connection_id.state, 'connected')

    def test_a_disabled_connection_gives_no_credentials(self):
        channel = self.make_tiktok_channel(BUSINESS_ID)
        channel.connection_id.state = 'disabled'
        with self.assertRaises(UserError):
            channel._liwan_credentials()
        self.assertFalse(channel._liwan_can_send())
