# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The TikTok adapter: the webhook signature, OAuth payloads and every event shape it parses."""
import calendar
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import BaseCase, tagged

from . import tiktok_payloads as tt
from odoo.addons.liwan_inbox.adapters import errors, tiktok

CREDENTIALS = tiktok.Credentials(tt.BUSINESS_ID, 'access-token-1')
CONFIG = tiktok.AppConfig(tt.CLIENT_KEY, tt.CLIENT_SECRET, 'https://liwan.test/api/v1/inbox/tiktok/callback')
TOKEN_ANSWER = {
    'open_id': tt.BUSINESS_ID,
    'scope': 'user.info.basic,message.list.read',
    'access_token': 'access-1',
    'refresh_token': 'refresh-1',
    'expires_in': 86400,
    'refresh_token_expires_in': 31536000,
}


def response(body=None, status=200, content=b'', headers=None):
    answer = MagicMock()
    answer.status_code = status
    answer.json.return_value = body if body is not None else {}
    answer.content = content
    answer.headers = headers or {}
    return answer


@tagged('post_install', '-at_install', 'liwan')
class TestTikTokAdapter(BaseCase):

    def parse(self, payload, business_id=tt.BUSINESS_ID):
        return tiktok.parse_event(payload, business_id)

    def test_signature_window(self):
        raw = tt.raw(tt.receive_text())
        header = tt.signed(raw)
        self.assertTrue(tiktok.verify_signature(tt.CLIENT_SECRET, raw, header, tt.CREATE_TIME + 5))
        self.assertFalse(tiktok.verify_signature(tt.CLIENT_SECRET, raw, header, tt.CREATE_TIME + 6))
        self.assertFalse(tiktok.verify_signature(tt.CLIENT_SECRET, raw + b' ', header, tt.CREATE_TIME))
        self.assertFalse(tiktok.verify_signature('another-secret', raw, header, tt.CREATE_TIME))
        digest = header.split('s=')[1]
        for incomplete in ('', 't=%d' % tt.CREATE_TIME, 's=%s' % digest, 't=,s=%s' % digest, 't=x,s=%s' % digest):
            self.assertFalse(
                tiktok.verify_signature(tt.CLIENT_SECRET, raw, incomplete, tt.CREATE_TIME),
                'accepted the incomplete header %r' % incomplete,
            )

    def test_parse_every_event(self):
        share_url = 'https://www.tiktok.com/player/v1/7234567890123456789'
        sticker_url = 'https://cdn.tiktok.com/sticker/1.webp?x-expires=1790000000'
        fixtures = [
            ('text', tt.receive_text(body='Hi there'), tiktok.InboundMessage, {
                'provider_id': 'msg-text-1', 'conversation_id': tt.CONVERSATION_ID, 'kind': 'text',
                'body': 'Hi there', 'sender_id': tt.SENDER_ID, 'sender_name': tt.SENDER_NAME,
                'echo': False, 'auto': False, 'media_id': None, 'option_id': None,
            }),
            ('image', tt.receive_image(), tiktok.InboundMessage, {
                'kind': 'image', 'media_id': 'media-image-1', 'media_type': 'IMAGE', 'body': '',
            }),
            ('video', tt.receive_video(), tiktok.InboundMessage, {
                'kind': 'video', 'media_id': 'media-video-1', 'media_type': 'VIDEO',
            }),
            ('share_post', tt.receive_share_post(), tiktok.InboundMessage, {'kind': 'text', 'body': share_url}),
            ('sticker', tt.receive_sticker(), tiktok.InboundMessage, {'kind': 'sticker', 'body': sticker_url}),
            ('emoji', tt.receive_emoji(), tiktok.InboundMessage, {'kind': 'sticker', 'body': 'https://cdn.tiktok.com/emoji/1.png'}),
            ('template', tt.receive_template(), tiktok.InboundMessage, {'kind': 'interactive', 'body': 'Pick one'}),
            ('button_click', tt.receive_button_click(), tiktok.InboundMessage, {
                'kind': 'text', 'option_id': 'opt_yes', 'context_id': 'am-reply-1',
            }),
            ('echo', tt.send_echo(body='Replied from the TikTok app'), tiktok.InboundMessage, {
                'kind': 'text', 'body': 'Replied from the TikTok app', 'echo': True, 'auto': False,
            }),
            ('auto_welcome', tt.send_auto_welcome(), tiktok.InboundMessage, {'echo': True, 'auto': True}),
            ('reaction', tt.receive_reaction(), tiktok.Reaction, {
                'conversation_id': tt.CONVERSATION_ID, 'target_id': 'msg-text-1', 'emoji': '👍',
            }),
            ('reaction_removed', tt.receive_reaction(operation='REMOVE'), tiktok.Reaction, {'emoji': None}),
            ('customer_read', tt.mark_read(), tiktok.ReadUpTo, {'conversation_id': tt.CONVERSATION_ID}),
            ('eu_notice', tt.eu_notice(), tiktok.EuNotice, {}),
            ('referral_ad', tt.referral(source='ad'), tiktok.Referral, {
                'conversation_id': tt.CONVERSATION_ID, 'sender_id': tt.SENDER_ID, 'sender_name': tt.SENDER_NAME,
                'source': 'ad', 'ref': 'ad-1',
            }),
            ('referral_short_link', tt.referral(source='short_link', ref='campaign_1'), tiktok.Referral, {
                'source': 'short_link', 'ref': 'campaign_1',
            }),
            ('audit_update', tt.auto_message_audit_update(), tiktok.AutoMessageChanged, {}),
            ('config_update', tt.auto_message_config_update(action='DISABLE'), tiktok.AutoMessageChanged, {}),
        ]
        for name, payload, expected_type, fields in fixtures:
            with self.subTest(fixture=name):
                items = self.parse(payload)
                self.assertEqual(len(items), 1, 'parsed %r into %r' % (name, items))
                item = items[0]
                self.assertIsInstance(item, expected_type)
                for field, value in fields.items():
                    self.assertEqual(getattr(item, field), value, '%s of %s' % (field, name))
        text = self.parse(tt.receive_text())[0]
        self.assertIsInstance(text.sent_at, datetime)
        self.assertEqual(calendar.timegm(text.sent_at.timetuple()), tt.CREATE_TIME)
        read = self.parse(tt.mark_read(last_read_timestamp=tt.SENT_AT))[0]
        self.assertEqual(calendar.timegm(read.read_at.timetuple()), tt.CREATE_TIME)

    def test_parse_ignores_other_events_and_businesses(self):
        self.assertEqual(self.parse(tt.receive_text(), business_id='another-business'), [])
        self.assertEqual(self.parse({'event': 'comment.update', 'user_openid': tt.BUSINESS_ID, 'content': '{}'}), [])
        self.assertEqual(self.parse({}), [])

    def test_business_read_is_ignored(self):
        self.assertEqual(self.parse(tt.mark_read(by_customer=False)), [])
        self.assertEqual(len(self.parse(tt.mark_read(by_customer=True))), 1)

    def test_exchange_and_refresh_payloads(self):
        with patch.object(requests, 'request', return_value=response(tt.answer(TOKEN_ANSWER))) as request:
            grant = tiktok.exchange_code(CONFIG, 'auth-code-1')
        self.assertEqual(request.call_args.args[0], 'POST')
        self.assertEqual(request.call_args.args[1], tiktok.API_BASE + '/tt_user/oauth2/token/')
        self.assertEqual(request.call_args.kwargs['json'], {
            'client_id': tt.CLIENT_KEY,
            'client_secret': tt.CLIENT_SECRET,
            'grant_type': 'authorization_code',
            'auth_code': 'auth-code-1',
            'redirect_uri': CONFIG.redirect_uri,
        })
        self.assertNotIn('Access-Token', request.call_args.kwargs['headers'])
        self.assertEqual(grant.open_id, tt.BUSINESS_ID)
        self.assertEqual(grant.scopes, frozenset({'user.info.basic', 'message.list.read'}))
        self.assertEqual((grant.access_token, grant.refresh_token), ('access-1', 'refresh-1'))
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        self.assertAlmostEqual((grant.expires_at - now).total_seconds(), 86400, delta=5)
        self.assertAlmostEqual((grant.refresh_expires_at - now).total_seconds(), 31536000, delta=5)

        with patch.object(requests, 'request', return_value=response(tt.answer(TOKEN_ANSWER))) as request:
            renewed = tiktok.refresh_tokens(CONFIG, 'refresh-1')
        self.assertEqual(request.call_args.args[1], tiktok.API_BASE + '/tt_user/oauth2/refresh_token/')
        self.assertEqual(request.call_args.kwargs['json'], {
            'client_id': tt.CLIENT_KEY,
            'client_secret': tt.CLIENT_SECRET,
            'grant_type': 'refresh_token',
            'refresh_token': 'refresh-1',
        })
        self.assertEqual(renewed.refresh_token, 'refresh-1')
        self.assertAlmostEqual((renewed.expires_at - datetime.now(timezone.utc).replace(tzinfo=None)).total_seconds(), 86400, delta=5)

    def test_error_classification(self):
        cases = [
            ('server', response({'code': 50000, 'message': 'internal'}, status=500), True, 50000),
            ('rate_limit', response({'code': 40133, 'message': 'too many'}, status=429), True, 40133),
            ('refused', response({'code': 10001, 'message': 'bad parameter'}, status=200), False, 10001),
            ('client', response({'code': 10002, 'message': 'invalid token'}, status=401), False, 10002),
        ]
        for name, answer, retryable, code in cases:
            with self.subTest(case=name), patch.object(requests, 'request', return_value=answer):
                with self.assertRaises(errors.ProviderError) as caught:
                    tiktok.exchange_code(CONFIG, 'auth-code-1')
                self.assertEqual(caught.exception.retryable, retryable)
                self.assertEqual(caught.exception.code, code)

        malformed = response()
        malformed.json.side_effect = ValueError('not json')
        with patch.object(requests, 'request', return_value=malformed):
            with self.assertRaises(errors.ProviderError) as caught:
                tiktok.exchange_code(CONFIG, 'auth-code-1')
        self.assertFalse(caught.exception.retryable)

        no_data = response({'code': 0, 'message': 'OK'})
        with patch.object(requests, 'request', return_value=no_data):
            with self.assertRaises(errors.ProviderError) as caught:
                tiktok.exchange_code(CONFIG, 'auth-code-1')
        self.assertFalse(caught.exception.retryable)

    def test_app_config_requires_all_three(self):
        environ = {
            'LIWAN_TIKTOK_CLIENT_KEY': tt.CLIENT_KEY,
            'LIWAN_TIKTOK_CLIENT_SECRET': tt.CLIENT_SECRET,
            'LIWAN_TIKTOK_REDIRECT_URI': CONFIG.redirect_uri,
        }
        config = tiktok.app_config(environ)
        self.assertEqual(config, CONFIG)
        for missing in environ:
            with self.subTest(missing=missing):
                self.assertIsNone(tiktok.app_config({key: value for key, value in environ.items() if key != missing}))
                self.assertIsNone(tiktok.app_config({**environ, missing: '  '}))
        self.assertIsNone(tiktok.app_config({}))

    def test_business_profile(self):
        with patch.object(requests, 'request', return_value=response(tt.answer({
            'username': 'liwan.shop', 'display_name': 'Liwan Shop',
        }))) as request:
            profile = tiktok.business_profile(CREDENTIALS)
        self.assertEqual(profile, tiktok.Profile('liwan.shop', 'Liwan Shop'))
        self.assertEqual(request.call_args.args[1], tiktok.API_BASE + '/business/get/')
        self.assertEqual(request.call_args.kwargs['params'], {
            'business_id': tt.BUSINESS_ID, 'fields': 'username,display_name,profile_image',
        })
        self.assertEqual(request.call_args.kwargs['headers']['Access-Token'], 'access-token-1')
