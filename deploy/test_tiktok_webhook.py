# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The operator's TikTok webhook script: URL derivation, payloads and secret-free output."""
import contextlib
import io
import unittest

from deploy import tiktok_webhook as tw

SHARED_REDIRECT = 'https://hooks.liwan.test/tiktok/oauth/callback'
DIRECT_REDIRECT = 'https://acme.liwan.test/api/v1/inbox/tiktok/callback'
CONFIG = {
    'LIWAN_TIKTOK_CLIENT_KEY': 'test-only-client-key',
    'LIWAN_TIKTOK_CLIENT_SECRET': 'test-only-client-secret',
    'LIWAN_TIKTOK_REDIRECT_URI': SHARED_REDIRECT,
}


class Response:
    def __init__(self, payload=None, status_code=200):
        self.status_code = status_code
        self.payload = {'code': 0, 'data': {}} if payload is None else payload

    def json(self):
        if isinstance(self.payload, Exception):
            raise self.payload
        return self.payload


def recorder(response=None):
    calls = []

    def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return response if response is not None else Response()

    return request, calls


class TestTikTokWebhook(unittest.TestCase):
    def test_the_webhook_url_follows_the_deployment_shape(self):
        self.assertEqual(tw.webhook_url(SHARED_REDIRECT), 'https://hooks.liwan.test/tiktok/webhook')
        self.assertEqual(tw.webhook_url(DIRECT_REDIRECT), 'https://acme.liwan.test/api/v1/inbox/hooks/tiktok')

    def test_an_unknown_or_insecure_callback_is_refused(self):
        for value in (
            'http://hooks.liwan.test/tiktok/oauth/callback',
            'https://hooks.liwan.test/other/callback',
            'https://hooks.liwan.test/tiktok/oauth/callback?code=x',
            'https:///tiktok/oauth/callback',
        ):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                tw.webhook_url(value)

    def test_a_missing_variable_is_named_without_its_value(self):
        environ = {**CONFIG, 'LIWAN_TIKTOK_CLIENT_SECRET': ''}
        with self.assertRaises(SystemExit) as caught:
            tw.environment(environ)
        self.assertIn('LIWAN_TIKTOK_CLIENT_SECRET', str(caught.exception))
        self.assertNotIn('test-only-client-key', str(caught.exception))

    def test_register_posts_the_app_and_the_derived_webhook_url(self):
        request, calls = recorder()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            tw.main(['register'], environ=CONFIG, request=request)
        self.assertEqual(len(calls), 1)
        method, url, kwargs = calls[0]
        self.assertEqual((method, url), ('POST', tw.API_BASE + '/business/webhook/update/'))
        self.assertEqual(kwargs['json'], {
            'app_id': CONFIG['LIWAN_TIKTOK_CLIENT_KEY'],
            'secret': CONFIG['LIWAN_TIKTOK_CLIENT_SECRET'],
            'event_type': tw.WEBHOOK_EVENT,
            'callback_url': 'https://hooks.liwan.test/tiktok/webhook',
        })
        self.assertIn('https://hooks.liwan.test/tiktok/webhook', output.getvalue())
        self.assertNotIn(CONFIG['LIWAN_TIKTOK_CLIENT_SECRET'], output.getvalue())

    def test_delete_posts_the_delete_endpoint(self):
        request, calls = recorder()
        with contextlib.redirect_stdout(io.StringIO()):
            tw.main(['delete'], environ=CONFIG, request=request)
        method, url, kwargs = calls[0]
        self.assertEqual((method, url), ('POST', tw.API_BASE + '/business/webhook/delete/'))
        self.assertEqual(kwargs['json']['event_type'], tw.WEBHOOK_EVENT)

    def test_show_prints_the_registered_url_or_its_absence(self):
        request, calls = recorder(Response({'code': 0, 'data': {'callback_url': 'https://hooks.liwan.test/tiktok/webhook'}}))
        with contextlib.redirect_stdout(io.StringIO()) as output:
            tw.main(['show'], environ=CONFIG, request=request)
        self.assertEqual(output.getvalue().strip(), 'https://hooks.liwan.test/tiktok/webhook')
        self.assertEqual(calls[0][0], 'GET')
        self.assertEqual(calls[0][2]['params']['app_id'], CONFIG['LIWAN_TIKTOK_CLIENT_KEY'])
        request, _calls = recorder(Response({'code': 0, 'data': {}}))
        with contextlib.redirect_stdout(io.StringIO()) as output:
            tw.main(['show'], environ=CONFIG, request=request)
        self.assertEqual(output.getvalue().strip(), 'no webhook registered')

    def test_a_provider_refusal_exits_without_reaching_the_log_with_the_secret(self):
        request, _calls = recorder(Response({'code': 10001, 'message': 'invalid app'}))
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stderr(io.StringIO()) as error:
            tw.main(['register'], environ=CONFIG, request=request)
        self.assertIn('invalid app', str(caught.exception))
        self.assertNotIn(CONFIG['LIWAN_TIKTOK_CLIENT_SECRET'], str(caught.exception) + error.getvalue())

    def test_a_malformed_provider_answer_exits(self):
        request, _calls = recorder(Response(ValueError('not json')))
        with self.assertRaises(SystemExit):
            tw.main(['register'], environ=CONFIG, request=request)

    def test_no_secret_is_accepted_on_the_command_line(self):
        with self.assertRaises(SystemExit) as caught, contextlib.redirect_stdout(io.StringIO()) as output:
            tw.main(['--help'], environ={}, request=None)
        self.assertEqual(caught.exception.code, 0)
        for key in tw.ENVIRONMENT_KEYS:
            self.assertIn(key, output.getvalue())
        self.assertNotIn('--secret', output.getvalue())
