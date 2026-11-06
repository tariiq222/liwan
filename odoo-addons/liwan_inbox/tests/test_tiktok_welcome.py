# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok welcome message: TikTok holds it, so switching it off switches it off at TikTok too."""
from datetime import timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_inbox.adapters import errors, tiktok
from odoo.addons.liwan_inbox.models.constants import AUTOMATION_FEATURE, TIKTOK_FEATURE

ACCESS_TOKEN = 'tiktok-access-token-welcome'
REFRESH_TOKEN = 'tiktok-refresh-token-welcome'
WELCOME_ID = 'am-welcome-1'
REASON_REFUSED = 'inbox_tiktok_auto_message_refused'


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokWelcome(LiwanInboxCase):
    """A TikTok welcome message that TikTok holds and reviews, switched on and off through the automation form."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        now = fields.Datetime.now()
        cls.tiktok = cls.env['liwan.inbox.channel'].create({
            'name': 'TikTok shop', 'kind': 'tiktok', 'tiktok_business_id': tt.BUSINESS_ID, 'state': 'connected',
        })
        cls.tiktok._liwan_tiktok_store(tiktok.TokenGrant(
            open_id=tt.BUSINESS_ID, scopes=frozenset(tiktok.SCOPES),
            access_token=ACCESS_TOKEN, refresh_token=REFRESH_TOKEN,
            expires_at=now + timedelta(days=1), refresh_expires_at=now + timedelta(days=365),
        ))

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key=TIKTOK_FEATURE, enabled=True)
        set_probe_feature(self, key=AUTOMATION_FEATURE, enabled=True)
        self.login(self.manager)

    def patch_automation(self, payload):
        return self.api('PATCH', f'/api/v1/inbox/channels/{self.tiktok.id}/automation', payload)

    def store_enabled_welcome(self):
        """The welcome an administrator has already saved: stored content and the TikTok item that holds it."""
        self.env['liwan.inbox.auto.message'].create({
            'purpose': 'welcome', 'channel_id': self.tiktok.id, 'body': 'Welcome to the shop',
        })
        self.tiktok.write({
            'welcome_enabled': True, 'tiktok_welcome_id': WELCOME_ID, 'tiktok_welcome_audit': 'approved',
        })

    def test_disabling_the_welcome_switches_it_off_at_tiktok(self):
        self.store_enabled_welcome()
        with patch.object(tiktok, 'set_auto_message_status') as status, \
                patch.object(tiktok, 'update_auto_message') as update, \
                patch.object(tiktok, 'create_auto_message') as create:
            response = self.patch_automation({'welcome': {'enabled': False}})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(status.call_args.args[1:], ('WELCOME_MESSAGE', False))
        self.assertEqual((update.call_count, create.call_count), (0, 0))
        self.tiktok.invalidate_recordset(['welcome_enabled'])
        self.assertFalse(self.tiktok.welcome_enabled)

    def test_the_full_form_does_not_update_a_disabled_welcome(self):
        self.store_enabled_welcome()
        with patch.object(tiktok, 'set_auto_message_status') as status, \
                patch.object(tiktok, 'update_auto_message') as update:
            response = self.patch_automation({
                'welcome': {'enabled': False, 'content': {'body': 'A new welcome to review'}},
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(status.call_count, 1)
        self.assertEqual(status.call_args.args[1:], ('WELCOME_MESSAGE', False))
        self.assertEqual(update.call_count, 0)
        self.assertEqual(self.tiktok._liwan_auto_message('welcome').body, 'A new welcome to review')

    def test_a_refusal_to_disable_the_welcome_is_422_not_500(self):
        self.store_enabled_welcome()
        with patch.object(tiktok, 'set_auto_message_status', side_effect=errors.ProviderError(
            'auto message refused', retryable=False, code=40001,
        )):
            response = self.patch_automation({'welcome': {'enabled': False}})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['details']['reason'], REASON_REFUSED)
        self.tiktok.invalidate_recordset(['welcome_enabled'])
        self.assertTrue(self.tiktok.welcome_enabled, 'a refused switch must not be stored as disabled')
