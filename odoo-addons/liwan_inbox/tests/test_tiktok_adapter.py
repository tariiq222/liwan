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


def streamed(content, status=200, headers=None):
    """A download answer read in chunks through `iter_content`, as a streamed request delivers it."""
    answer = MagicMock()
    answer.status_code = status
    answer.headers = headers or {'Content-Type': 'image/jpeg'}
    answer.iter_content.side_effect = lambda size: iter([content[i:i + size] for i in range(0, len(content), size)])
    answer.closed = False
    answer.close.side_effect = lambda: setattr(answer, 'closed', True)
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
        # The window is symmetric: a delivery dated in the future is refused like a stale one.
        self.assertTrue(tiktok.verify_signature(tt.CLIENT_SECRET, raw, header, tt.CREATE_TIME - 5))
        self.assertFalse(tiktok.verify_signature(tt.CLIENT_SECRET, raw, header, tt.CREATE_TIME - 6))
        self.assertFalse(tiktok.verify_signature(tt.CLIENT_SECRET, raw + b' ', header, tt.CREATE_TIME))
        self.assertFalse(tiktok.verify_signature('another-secret', raw, header, tt.CREATE_TIME))
        digest = header.split('s=')[1]
        for incomplete in ('', 't=%d' % tt.CREATE_TIME, 's=%s' % digest, 't=,s=%s' % digest, 't=x,s=%s' % digest):
            self.assertFalse(
                tiktok.verify_signature(tt.CLIENT_SECRET, raw, incomplete, tt.CREATE_TIME),
                'accepted the incomplete header %r' % incomplete,
            )

    def test_non_ascii_header_is_refused_not_raised(self):
        # WSGI decodes request headers as latin-1, so a byte of 0x80 or above arrives as a non-ASCII
        # str; comparing it with the ASCII digest raises TypeError and the webhook answers 500 instead
        # of refusing the delivery.
        raw = tt.raw(tt.receive_text())
        digest = tt.signed(raw).split('s=')[1]
        for hostile in ('t=%d,s=%%C3%%A9%02X' % (tt.CREATE_TIME, 0xFF), 't=%d,s=\u00e9%s' % (tt.CREATE_TIME, digest)):
            with self.subTest(header=hostile):
                self.assertFalse(tiktok.verify_signature(tt.CLIENT_SECRET, raw, hostile, tt.CREATE_TIME))

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

    def test_send_text_with_quote(self):
        answer = response(tt.answer({'message': {'message_id': 'msg-out-1'}}))
        with patch.object(requests, 'request', return_value=answer) as request:
            provider_id = tiktok.send_text(CREDENTIALS, tt.CONVERSATION_ID, 'Hello', context_id='msg-1')
        self.assertEqual(provider_id, 'msg-out-1')
        self.assertEqual(request.call_args.args[:2], ('POST', tiktok.API_BASE + '/business/message/send/'))
        self.assertEqual(request.call_args.kwargs['headers']['Access-Token'], 'access-token-1')
        self.assertEqual(request.call_args.kwargs['json'], {
            'business_id': tt.BUSINESS_ID,
            'recipient_type': 'CONVERSATION',
            'recipient': tt.CONVERSATION_ID,
            'message_type': 'TEXT',
            'text': {'body': 'Hello'},
            'referenced_message_info': {'referenced_message_id': 'msg-1'},
        })
        with patch.object(requests, 'request', return_value=answer) as request:
            tiktok.send_text(CREDENTIALS, tt.CONVERSATION_ID, 'Hello')
        self.assertNotIn('referenced_message_info', request.call_args.kwargs['json'])

    def test_send_buttons_validates_limits(self):
        buttons = [tiktok.Button('opt_1', 'Yes')]
        with patch.object(requests, 'request') as request:
            with self.assertRaises(ValueError):
                tiktok.send_buttons(CREDENTIALS, tt.CONVERSATION_ID, 'Pick one', buttons * 4)
            with self.assertRaises(ValueError):
                tiktok.send_buttons(CREDENTIALS, tt.CONVERSATION_ID, 'Pick one', [tiktok.Button('opt_1', 'a' * 21)])
            with self.assertRaises(ValueError):
                tiktok.send_buttons(CREDENTIALS, tt.CONVERSATION_ID, 'a' * 41, buttons)
            with self.assertRaises(ValueError):
                tiktok.send_buttons(CREDENTIALS, tt.CONVERSATION_ID, 'Pick one', [tiktok.Button('a' * 41, 'Yes')])
        request.assert_not_called()
        answer = response(tt.answer({'message': {'message_id': 'msg-card-1'}}))
        card = [tiktok.Button('opt_1', 'Yes'), tiktok.Button('opt_2', 'No'), tiktok.Button('opt_3', 'Later')]
        with patch.object(requests, 'request', return_value=answer) as request:
            self.assertEqual(tiktok.send_buttons(CREDENTIALS, tt.CONVERSATION_ID, 'Pick one', card), 'msg-card-1')
        self.assertEqual(request.call_args.kwargs['json'], {
            'business_id': tt.BUSINESS_ID,
            'recipient_type': 'CONVERSATION',
            'recipient': tt.CONVERSATION_ID,
            'message_type': 'TEMPLATE',
            'template': {
                'type': 'QA_BUTTON_CARD',
                'title': 'Pick one',
                'buttons': [
                    {'type': 'REPLY', 'title': 'Yes', 'id': 'opt_1'},
                    {'type': 'REPLY', 'title': 'No', 'id': 'opt_2'},
                    {'type': 'REPLY', 'title': 'Later', 'id': 'opt_3'},
                ],
            },
        })

    def test_upload_then_send_image(self):
        image = b'\x89PNG\r\n\x1a\n'
        with patch.object(requests, 'request', return_value=response(tt.answer({'media_id': 'media-image-9'}))) as request:
            media_id = tiktok.upload_image(CREDENTIALS, 'photo.png', 'image/png', image)
        self.assertEqual(media_id, 'media-image-9')
        self.assertEqual(request.call_args.args[1], tiktok.API_BASE + '/business/message/media/upload/')
        self.assertEqual(request.call_args.kwargs['data'], {'business_id': tt.BUSINESS_ID, 'media_type': 'IMAGE'})
        self.assertEqual(request.call_args.kwargs['files'], {'file': ('photo.png', image, 'image/png')})
        with patch.object(requests, 'request', return_value=response(tt.answer({'message': {'message_id': 'msg-image-2'}}))) as request:
            self.assertEqual(tiktok.send_image(CREDENTIALS, tt.CONVERSATION_ID, media_id), 'msg-image-2')
        self.assertEqual(request.call_args.kwargs['json'], {
            'business_id': tt.BUSINESS_ID,
            'recipient_type': 'CONVERSATION',
            'recipient': tt.CONVERSATION_ID,
            'message_type': 'IMAGE',
            'image': {'media_id': 'media-image-9'},
        })
        with patch.object(requests, 'request') as request:
            with self.assertRaises(ValueError):
                tiktok.upload_image(CREDENTIALS, 'doc.pdf', 'application/pdf', b'%PDF')
            with self.assertRaises(ValueError):
                tiktok.upload_image(CREDENTIALS, 'photo.png', 'image/png', b'x' * (tiktok.IMAGE_MAX_BYTES + 1))
        request.assert_not_called()

    def test_send_action(self):
        answer = response(tt.answer({'message': {'message_id': ''}}))
        with patch.object(requests, 'request', return_value=answer) as request:
            self.assertIsNone(tiktok.send_action(CREDENTIALS, tt.CONVERSATION_ID, 'MARK_READ'))
        self.assertEqual(request.call_args.kwargs['json'], {
            'business_id': tt.BUSINESS_ID,
            'recipient_type': 'CONVERSATION',
            'recipient': tt.CONVERSATION_ID,
            'message_type': 'SENDER_ACTION',
            'sender_action': 'MARK_READ',
        })
        with patch.object(requests, 'request', return_value=answer) as request:
            tiktok.send_action(CREDENTIALS, tt.CONVERSATION_ID, 'TYPING')
        self.assertEqual(request.call_args.kwargs['json']['sender_action'], 'TYPING')
        with self.assertRaises(ValueError):
            tiktok.send_action(CREDENTIALS, tt.CONVERSATION_ID, 'DANCE')

    def fetch(self, url, *downloads):
        """`fetch_media` against a metadata answer naming `url`; returns the result or the error, and the GET mock."""
        metadata = response(tt.answer({'download_url': url}))
        with patch.object(requests, 'request', return_value=metadata), patch.object(requests, 'get', side_effect=downloads) as get:
            try:
                result = tiktok.fetch_media(CREDENTIALS, tt.CONVERSATION_ID, 'msg-image-1', 'media-image-1', 'IMAGE')
            except errors.ProviderError as error:
                result = error
        return result, get

    def test_fetch_media_sends_both_token_headers_to_a_tiktok_host(self):
        content = streamed(b'image-bytes', headers={'Content-Type': 'image/jpeg; charset=binary'})
        metadata = response(tt.answer({'download_url': 'https://cdn.tiktok.com/file/1'}))
        with patch.object(requests, 'request', return_value=metadata) as request, patch.object(requests, 'get', return_value=content) as get:
            media = tiktok.fetch_media(CREDENTIALS, tt.CONVERSATION_ID, 'msg-image-1', 'media-image-1', 'IMAGE')
        self.assertEqual(media, tiktok.Media(b'image-bytes', 'image/jpeg'))
        self.assertEqual(request.call_args.args[:2], ('POST', tiktok.API_BASE + '/business/message/media/download/'))
        self.assertEqual(request.call_args.kwargs['json'], {
            'business_id': tt.BUSINESS_ID,
            'conversation_id': tt.CONVERSATION_ID,
            'message_id': 'msg-image-1',
            'media_id': 'media-image-1',
            'media_type': 'IMAGE',
        })
        self.assertEqual(get.call_args.args, ('https://cdn.tiktok.com/file/1',))
        self.assertEqual(get.call_args.kwargs['headers'], {'Access-Token': 'access-token-1', 'x-user': 'access-token-1'})
        self.assertFalse(get.call_args.kwargs['allow_redirects'])
        self.assertTrue(get.call_args.kwargs['stream'], 'the body is streamed, never buffered whole')
        self.assertTrue(content.closed)

    def test_fetch_media_never_sends_the_token_to_an_untrusted_url(self):
        for url in (
            'http://cdn.tiktok.com/file/1',
            'https://evil.example/x',
            'https://nottiktok.com/x',
            'https://cdn.tiktok.com.evil.example/x',
            'https://cdn.tiktok.com@evil.example/x',
            'https://evil.example\\.cdn.tiktok.com',
            'https://cdn.tiktok.com:8443/x',
        ):
            with self.subTest(url=url):
                result, get = self.fetch(url)
                self.assertIsInstance(result, errors.ProviderError)
                self.assertFalse(result.retryable)
                get.assert_not_called()

    def test_fetch_media_follows_a_redirect_only_to_a_trusted_host(self):
        redirect = streamed(b'', status=302, headers={'Location': 'https://evil.example/steal'})
        result, get = self.fetch('https://cdn.tiktok.com/file/1', redirect)
        self.assertIsInstance(result, errors.ProviderError)
        self.assertEqual(get.call_count, 1, 'the untrusted hop never receives a request')
        self.assertTrue(redirect.closed)

        redirect = streamed(b'', status=302, headers={'Location': '/other/2'})
        result, get = self.fetch('https://cdn.tiktok.com/file/1', redirect, streamed(b'bytes'))
        self.assertEqual(result, tiktok.Media(b'bytes', 'image/jpeg'))
        self.assertEqual([call.args[0] for call in get.call_args_list], ['https://cdn.tiktok.com/file/1', 'https://cdn.tiktok.com/other/2'])
        self.assertEqual(get.call_args.kwargs['headers']['x-user'], 'access-token-1')

        for location in ('https://evil.example\\.cdn.tiktok.com/steal', None):
            with self.subTest(location=location):
                redirect = streamed(b'', status=302, headers={'Location': location} if location else {})
                result, get = self.fetch('https://cdn.tiktok.com/file/1', redirect)
                self.assertIsInstance(result, errors.ProviderError)
                self.assertFalse(result.retryable)
                self.assertEqual(get.call_count, 1)

    def test_fetch_media_refuses_a_redirect_loop(self):
        hops = [streamed(b'', status=302, headers={'Location': 'https://cdn.tiktok.com/again'}) for _ in range(5)]
        result, get = self.fetch('https://cdn.tiktok.com/file/1', *hops)
        self.assertIsInstance(result, errors.ProviderError)
        self.assertFalse(result.retryable)
        self.assertEqual(get.call_count, 4)

    def test_fetch_media_refuses_a_body_over_the_cap(self):
        oversized = streamed(b'x' * (tiktok.MAX_MEDIA_BYTES + 1))
        result, _get = self.fetch('https://cdn.tiktok.com/file/2', oversized)
        self.assertIsInstance(result, errors.ProviderError)
        self.assertEqual((str(result), result.retryable), ('media is too large', False))
        self.assertTrue(oversized.closed, 'the download response is closed even when the body is refused')

    def test_fetch_media_trusts_only_tiktok_owned_domains(self):
        for host, trusted in (
            ('tiktok.com', True), ('v16.tiktokcdn.com', True), ('p16.tiktokcdn-us.com', True), ('a.b.tiktokv.com', True),
            ('nottiktok.com', False), ('tiktok.com.evil.example', False), ('tiktokcdn.org', False),
        ):
            with self.subTest(host=host):
                self.assertEqual(tiktok._media_host(host), trusted)

    def test_a_server_error_on_a_send_is_unconfirmed_but_not_on_a_typing_action(self):
        down = response({'code': 50000, 'message': 'internal'}, status=503)
        with patch.object(requests, 'request', return_value=down):
            with self.assertRaises(errors.ProviderError) as sent:
                tiktok.send_text(CREDENTIALS, tt.CONVERSATION_ID, 'hi')
            with self.assertRaises(errors.ProviderError) as acted:
                tiktok.send_action(CREDENTIALS, tt.CONVERSATION_ID, 'TYPING')
        self.assertEqual((sent.exception.retryable, sent.exception.unconfirmed), (False, True))
        self.assertEqual((acted.exception.retryable, acted.exception.unconfirmed), (True, False))

    def test_a_rate_limit_on_a_send_stays_retryable(self):
        limited = response({'code': 40133, 'message': 'too many'}, status=429)
        with patch.object(requests, 'request', return_value=limited):
            with self.assertRaises(errors.ProviderError) as sent:
                tiktok.send_text(CREDENTIALS, tt.CONVERSATION_ID, 'hi')
        self.assertEqual((sent.exception.retryable, sent.exception.unconfirmed), (True, False))

    def test_image_send_capable(self):
        capable = response(tt.answer({
            'capability_infos': [{'capability_type': 'IMAGE_SEND', 'capability_result': True}],
        }))
        with patch.object(requests, 'request', return_value=capable) as request:
            self.assertTrue(tiktok.image_send_capable(CREDENTIALS, tt.CONVERSATION_ID))
        self.assertEqual(request.call_args.args[1], tiktok.API_BASE + '/business/message/capabilities/get/')
        self.assertEqual(request.call_args.kwargs['params'], {
            'business_id': tt.BUSINESS_ID,
            'conversation_id': tt.CONVERSATION_ID,
            'conversation_type': 'SINGLE',
            'capability_types': '["IMAGE_SEND"]',
        })
        refused = response(tt.answer({
            'capability_infos': [{'capability_type': 'IMAGE_SEND', 'capability_result': False}],
        }))
        with patch.object(requests, 'request', return_value=refused):
            self.assertFalse(tiktok.image_send_capable(CREDENTIALS, tt.CONVERSATION_ID))

    def test_list_conversations_paginates(self):
        first = response(tt.answer({
            'conversations': [tt.conversation_item()], 'has_more': True, 'cursor': 120,
        }))
        last = response(tt.answer({
            'conversations': [tt.conversation_item('conv-2')], 'has_more': False, 'cursor': 0,
        }))
        with patch.object(requests, 'request', side_effect=[first, last]) as request:
            conversations, cursor = tiktok.list_conversations(CREDENTIALS, 'SINGLE', 0)
            self.assertEqual([item['conversation_id'] for item in conversations], [tt.CONVERSATION_ID])
            self.assertEqual(cursor, 120)
            self.assertEqual(request.call_args.kwargs['params'], {
                'business_id': tt.BUSINESS_ID, 'conversation_type': 'SINGLE', 'limit': 100, 'cursor': 0,
            })
            conversations, cursor = tiktok.list_conversations(CREDENTIALS, 'SINGLE', cursor)
            self.assertEqual([item['conversation_id'] for item in conversations], ['conv-2'])
            self.assertIsNone(cursor)
            self.assertEqual(request.call_args.kwargs['params']['cursor'], 120)

    def test_list_messages_encodes_plus(self):
        answer = response(tt.answer({
            'participants': [tt.participant(), tt.participant('BUSINESS_ACCOUNT', tt.BUSINESS_ID, 'liwan')],
            'messages': [
                tt.rest_message('TEXT', {'body': 'Hi'}),
                tt.rest_message('IMAGE', {'media_id': 'media-image-1'}, message_id='msg-2'),
            ],
        }))
        with patch.object(requests, 'request', return_value=answer) as request:
            participants, messages = tiktok.list_messages(CREDENTIALS, tt.CONVERSATION_ID)
        url = request.call_args.args[1]
        self.assertTrue(url.startswith(tiktok.API_BASE + '/business/message/content/list/?'))
        self.assertIn('conversation_id=conv%2B1', url)
        self.assertNotIn('conv+1', url)
        self.assertEqual(len(participants), 2)
        self.assertEqual([message.kind for message in messages], ['text', 'image'])
        self.assertEqual(messages[0].body, 'Hi')
        self.assertEqual(messages[0].sender_name, tt.SENDER_NAME)
        self.assertEqual(messages[1].media_id, 'media-image-1')

    def test_auto_message_crud_payloads(self):
        listing = response(tt.answer({
            'business_id': tt.BUSINESS_ID,
            'operation_status': 'ENABLE',
            'auto_messages': [tt.auto_message_item()],
        }))
        created = response(tt.answer({'auto_message': {'auto_message_id': 'am-2'}}))
        empty = response(tt.answer({}))
        question = {'suggested_question': {'question': 'Do you deliver?', 'answer': 'Yes.'}}
        prompt = {'chat_prompt': {'title': 'Order', 'content': 'I want to order'}}
        with patch.object(requests, 'request', side_effect=[listing, created, empty, empty, empty, empty]) as request:
            status, items = tiktok.get_auto_messages(CREDENTIALS, 'SUGGESTED_QUESTION')
            self.assertEqual((status, items[0]['auto_message_id']), ('ENABLE', 'am-1'))
            created_id = tiktok.create_auto_message(CREDENTIALS, 'SUGGESTED_QUESTION', question)
            self.assertEqual(created_id, 'am-2')
            tiktok.update_auto_message(CREDENTIALS, 'CHAT_PROMPT', 'am-3', prompt)
            tiktok.delete_auto_message(CREDENTIALS, 'CHAT_PROMPT', 'am-3')
            tiktok.set_auto_message_status(CREDENTIALS, 'SUGGESTED_QUESTION', True)
            tiktok.set_auto_message_status(CREDENTIALS, 'CHAT_PROMPT', False)
        calls = request.call_args_list
        self.assertEqual(calls[0].args[:2], ('GET', tiktok.API_BASE + '/business/message/auto_message/get/'))
        self.assertEqual(calls[0].kwargs['params'], {
            'business_id': tt.BUSINESS_ID, 'auto_message_type': 'SUGGESTED_QUESTION',
        })
        self.assertEqual(calls[1].args[1], tiktok.API_BASE + '/business/message/auto_message/create/')
        self.assertEqual(calls[1].kwargs['json'], {
            'business_id': tt.BUSINESS_ID, 'auto_message_type': 'SUGGESTED_QUESTION', **question,
        })
        self.assertEqual(calls[2].args[1], tiktok.API_BASE + '/business/message/auto_message/update/')
        self.assertEqual(calls[2].kwargs['json'], {
            'business_id': tt.BUSINESS_ID, 'auto_message_type': 'CHAT_PROMPT', 'auto_message_id': 'am-3', **prompt,
        })
        self.assertEqual(calls[3].args[1], tiktok.API_BASE + '/business/message/auto_message/delete/')
        self.assertEqual(calls[3].kwargs['json'], {
            'business_id': tt.BUSINESS_ID, 'auto_message_type': 'CHAT_PROMPT', 'auto_message_id': 'am-3',
        })
        self.assertEqual(calls[4].args[1], tiktok.API_BASE + '/business/message/auto_message/status/update/')
        self.assertEqual(calls[4].kwargs['json']['operation_status'], 'ENABLE')
        self.assertEqual(calls[5].kwargs['json']['operation_status'], 'DISABLE')

    def test_webhook_admin_calls(self):
        found = response(tt.answer({'callback_url': 'https://liwan.test/api/v1/inbox/hooks/tiktok'}))
        missing = response(tt.answer({}))
        empty = response(tt.answer({}))
        callback = 'https://liwan.test/api/v1/inbox/hooks/tiktok'
        with patch.object(requests, 'request', side_effect=[found, missing, empty, empty]) as request:
            self.assertEqual(tiktok.webhook_show(CONFIG), callback)
            self.assertIsNone(tiktok.webhook_show(CONFIG))
            tiktok.webhook_register(CONFIG, callback)
            tiktok.webhook_delete(CONFIG)
        calls = request.call_args_list
        self.assertEqual(calls[0].args[:2], ('GET', tiktok.API_BASE + '/business/webhook/list/'))
        self.assertEqual(calls[0].kwargs['params'], {
            'app_id': tt.CLIENT_KEY, 'secret': tt.CLIENT_SECRET, 'event_type': 'DIRECT_MESSAGE',
        })
        self.assertNotIn('Access-Token', calls[0].kwargs['headers'])
        self.assertEqual(calls[2].args[1], tiktok.API_BASE + '/business/webhook/update/')
        self.assertEqual(calls[2].kwargs['json'], {
            'app_id': tt.CLIENT_KEY, 'secret': tt.CLIENT_SECRET, 'event_type': 'DIRECT_MESSAGE',
            'callback_url': callback,
        })
        self.assertEqual(calls[3].args[1], tiktok.API_BASE + '/business/webhook/delete/')
        self.assertEqual(calls[3].kwargs['json'], {
            'app_id': tt.CLIENT_KEY, 'secret': tt.CLIENT_SECRET, 'event_type': 'DIRECT_MESSAGE',
        })
