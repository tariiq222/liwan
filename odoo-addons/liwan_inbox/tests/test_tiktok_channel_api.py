# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A TikTok channel refuses every WhatsApp-only route, and its own connection test reads the TikTok profile."""
from datetime import timedelta
from unittest.mock import patch

import requests

from odoo import fields
from odoo.tests import tagged

from . import tiktok_payloads as tt
from .common import LiwanInboxCase
from odoo.addons.liwan_inbox.adapters import errors, tiktok, whatsapp

ACCESS_TOKEN = 'tiktok-access-token-api'
REFRESH_TOKEN = 'tiktok-refresh-token-api'
REASON = 'inbox_channel_kind_unsupported'
API = '/api/v1/inbox'
# What a create needs so the body passes the field check and the channel kind is what refuses it.
CAMPAIGN_CREATE = {
    'name': 'Spring', 'params': [], 'header_attachment_id': None, 'scheduled_at': None, 'send_within_hours': False, 'daily_cap': 0,
}


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokChannelApi(LiwanInboxCase):
    """One TikTok channel: the WhatsApp surface refuses it, and its connection test is TikTok's own profile call."""

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
        cls.template = cls.make_template(channel=cls.tiktok)
        cls.flow = cls.env['liwan.inbox.flow'].create({
            'channel_id': cls.tiktok.id, 'name': 'Signup', 'provider_flow_id': 'flow-1',
        })
        cls.audience = cls.env['liwan.inbox.audience'].create({'name': 'Everyone'})
        cls.campaign = cls.env['liwan.inbox.campaign'].create({
            'name': 'Spring', 'channel_id': cls.tiktok.id,
            'template_id': cls.template.id, 'audience_id': cls.audience.id,
        })
        contact = cls.env['liwan.inbox.contact'].create({
            'name': 'Customer', 'company_id': cls.tiktok.owner_company_id.id,
        })
        identity = cls.env['liwan.inbox.contact.identity'].create({
            'contact_id': contact.id, 'channel_kind': 'tiktok', 'address': tt.SENDER_ID,
            'company_id': cls.tiktok.owner_company_id.id,
        })
        cls.conversation = cls.env['liwan.inbox.conversation'].create({
            'channel_id': cls.tiktok.id, 'contact_id': contact.id, 'identity_id': identity.id,
            'company_id': cls.tiktok.owner_company_id.id,
        })

    def setUp(self):
        super().setUp()
        self.login(self.manager)

    def whatsapp_routes(self):
        """Every WhatsApp-only route of liwan_inbox, with the body that reaches its guard."""
        channel = f'{API}/channels/{self.tiktok.id}'
        template = f'{API}/templates/{self.template.id}'
        flow = f'{API}/flows/{self.flow.id}'
        campaign = f'{API}/campaigns/{self.campaign.id}'
        return [
            ('GET', f'{channel}/ref'),
            ('GET', f'{channel}/templates'), ('POST', f'{channel}/templates'),
            ('POST', f'{channel}/templates/sync'), ('POST', f'{channel}/templates/uploads'),
            ('GET', template), ('PATCH', template), ('DELETE', template),
            ('GET', f'{channel}/flows'), ('POST', f'{channel}/flows'), ('POST', f'{channel}/flows/sync'),
            ('GET', flow), ('PATCH', flow), ('DELETE', flow),
            ('POST', f'{flow}/publish'), ('POST', f'{flow}/deprecate'), ('POST', f'{flow}/copy'),
            ('GET', f'{flow}/preview'), ('GET', f'{flow}/submissions'),
            ('GET', f'{API}/conversations/{self.conversation.id}/flow-submissions'),
            ('POST', f'{API}/campaigns'), ('POST', f'{API}/campaigns/preview'),
            ('GET', campaign), ('PATCH', campaign), ('DELETE', campaign),
            ('POST', f'{campaign}/launch'), ('POST', f'{campaign}/pause'), ('POST', f'{campaign}/resume'),
            ('POST', f'{campaign}/cancel'), ('POST', f'{campaign}/retry'), ('POST', f'{campaign}/test'),
            ('GET', f'{campaign}/recipients'),
            ('GET', f'{channel}/alerts'),
            ('GET', f'{channel}/profile'), ('PATCH', f'{channel}/profile'),
            ('PUT', f'{channel}/profile/picture'), ('POST', f'{channel}/display-name'),
            ('POST', f'{channel}/two-step-pin'), ('POST', f'{channel}/register'),
            ('POST', f'{channel}/template-insights'), ('POST', f'{channel}/analytics/sync'),
            ('GET', f'{channel}/sending'), ('PATCH', f'{channel}/sending'), ('POST', f'{channel}/sending/refresh'),
        ]

    def test_whatsapp_only_routes_refuse_tiktok(self):
        with patch.object(requests, 'request') as outbound:
            for method, path in self.whatsapp_routes():
                body = None
                if path == f'{API}/campaigns':
                    body = {**CAMPAIGN_CREATE, 'channel_id': self.tiktok.id, 'template_id': self.template.id, 'audience_id': self.audience.id}
                elif path == f'{API}/campaigns/preview':
                    body = {'template_id': self.template.id, 'params': []}
                result = self.api(method, path, json=body)
                self.assertEqual(result.status_code, 422, f'{method} {path}: {result.text}')
                self.assertEqual(result.json().get('code'), 'invalid', f'{method} {path}: {result.text}')
                self.assertEqual(result.json().get('details'), {'reason': REASON}, f'{method} {path}: {result.text}')
        self.assertEqual(outbound.call_count, 0, 'a WhatsApp-only route reached the provider for a TikTok channel')

    def test_the_connection_test_reads_the_tiktok_profile(self):
        profile = tiktok.Profile('liwan_shop', 'Liwan Shop')
        with patch.object(tiktok, 'business_profile', return_value=profile) as business_profile, \
                patch.object(whatsapp, 'get_business_profile') as whatsapp_profile:
            result = self.api('POST', f'{API}/channels/{self.tiktok.id}/test')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['state'], body['last_error'], body['tiktok_username']), ('connected', None, 'liwan_shop'))
        business_profile.assert_called_once()
        credentials = business_profile.call_args.args[0]
        self.assertEqual((credentials.business_id, credentials.access_token), (tt.BUSINESS_ID, ACCESS_TOKEN))
        self.assertFalse(whatsapp_profile.called)

    def test_a_failed_tiktok_connection_test_marks_the_channel_error(self):
        error = errors.ProviderError('Invalid access token', retryable=False)
        with patch.object(tiktok, 'business_profile', side_effect=error):
            result = self.api('POST', f'{API}/channels/{self.tiktok.id}/test')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['state'], body['last_error']), ('error', 'Invalid access token'))

    def test_the_channel_create_stays_whatsapp_only(self):
        result = self.api('POST', f'{API}/channels', json={
            'name': 'TikTok by hand', 'kind': 'tiktok', 'phone_number_id': '400000000001',
            'business_account_id': '500000000001', 'access_token': 'x' * 20, 'app_secret': 'y' * 20,
        })
        self.assertEqual(result.status_code, 422, result.text)
        self.assertEqual(result.json().get('field'), 'kind')
