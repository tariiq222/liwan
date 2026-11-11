# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Media downloads: the channel token only ever goes to the provider's own https hosts."""
from unittest.mock import MagicMock, patch

import requests

from odoo.tests import BaseCase, tagged

from odoo.addons.liwan_inbox.adapters import errors, media_download, whatsapp

CREDENTIALS = whatsapp.Credentials(phone_number_id='12345', business_account_id='67890', access_token='token-1')
MEDIA_URL = 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1'


def metadata(url=MEDIA_URL):
    answer = MagicMock(status_code=200)
    answer.json.return_value = {'url': url, 'mime_type': 'image/jpeg'}
    return answer


def body(content=b'', status=200, headers=None):
    answer = MagicMock(status_code=status)
    answer.headers = headers or {}
    answer.iter_content.side_effect = lambda size: iter([content[i:i + size] for i in range(0, len(content), size)])
    answer.closed = False
    answer.close.side_effect = lambda: setattr(answer, 'closed', True)
    return answer


@tagged('post_install', '-at_install', 'liwan')
class TestWhatsAppMediaDownload(BaseCase):

    def fetch(self, url, *downloads):
        with patch.object(requests, 'request', return_value=metadata(url)), patch.object(requests, 'get', side_effect=downloads) as get:
            try:
                result = whatsapp.fetch_media(CREDENTIALS, 'media-1')
            except errors.ProviderError as error:
                result = error
        return result, get

    def test_the_token_goes_to_the_media_host_without_following_redirects_blindly(self):
        download = body(b'jpeg-bytes')
        result, get = self.fetch(MEDIA_URL, download)
        self.assertEqual(result, whatsapp.Media(content=b'jpeg-bytes', mimetype='image/jpeg'))
        self.assertEqual(get.call_args.args, (MEDIA_URL,))
        self.assertEqual(get.call_args.kwargs['headers'], {'Authorization': 'Bearer token-1'})
        self.assertEqual(get.call_args.kwargs['timeout'], whatsapp.TIMEOUT_SECONDS)
        self.assertFalse(get.call_args.kwargs['allow_redirects'])
        self.assertTrue(download.closed)

    def test_an_untrusted_url_never_receives_the_token(self):
        for url in (
            'http://lookaside.fbsbx.com/x',
            'https://evil.example/x',
            'https://lookaside.fbsbx.com.evil.example/x',
            'https://lookaside.fbsbx.com@evil.example/x',
            'https://evil.example\\.lookaside.fbsbx.com',
            'https://lookaside.fbsbx.com:8443/x',
            'https://media.fbsbx.com/x',
        ):
            with self.subTest(url=url):
                result, get = self.fetch(url)
                self.assertIsInstance(result, errors.ProviderError)
                self.assertEqual((str(result), result.retryable), ('media url is not a trusted provider host', False))
                get.assert_not_called()

    def test_a_redirect_to_an_untrusted_host_is_not_followed(self):
        redirect = body(status=302, headers={'Location': 'https://evil.example/steal'})
        result, get = self.fetch(MEDIA_URL, redirect)
        self.assertIsInstance(result, errors.ProviderError)
        self.assertEqual(get.call_count, 1)
        self.assertTrue(redirect.closed)

    def test_a_redirect_to_the_media_host_is_followed_with_the_token(self):
        redirect = body(status=301, headers={'Location': 'https://lookaside.fbsbx.com/second'})
        result, get = self.fetch(MEDIA_URL, redirect, body(b'bytes'))
        self.assertEqual(result.content, b'bytes')
        self.assertEqual(get.call_args.args, ('https://lookaside.fbsbx.com/second',))
        self.assertEqual(get.call_args.kwargs['headers'], {'Authorization': 'Bearer token-1'})

    def test_a_body_over_the_cap_is_refused(self):
        oversized = body(b'x' * (whatsapp.MAX_MEDIA_BYTES + 1))
        result, _get = self.fetch(MEDIA_URL, oversized)
        self.assertEqual((str(result), result.retryable), ('media is too large', False))
        self.assertTrue(oversized.closed)

    def test_a_download_error_status_is_retryable_only_when_the_provider_may_recover(self):
        for status, retryable in ((404, False), (429, True), (503, True)):
            with self.subTest(status=status):
                result, _get = self.fetch(MEDIA_URL, body(status=status))
                self.assertEqual((type(result), result.retryable, result.unconfirmed), (errors.ProviderError, retryable, False))


@tagged('post_install', '-at_install', 'liwan')
class TestMediaDownloadHelper(BaseCase):

    def download(self, answer=None, deadline=60, max_bytes=100, **get):
        with patch.object(requests, 'get', return_value=answer, **get):
            try:
                return media_download.download(MEDIA_URL, lambda host: host == 'lookaside.fbsbx.com', {}, 5, deadline, max_bytes)
            except errors.ProviderError as error:
                return error

    def test_a_connection_failure_is_retryable_and_names_no_header(self):
        result = self.download(side_effect=requests.ConnectionError('reset by peer'))
        self.assertEqual((str(result), result.retryable), ('provider unreachable: ConnectionError', True))

    def test_a_failure_while_reading_the_body_is_retryable(self):
        answer = body()
        answer.iter_content.side_effect = requests.ConnectionError('cut')
        result = self.download(answer)
        self.assertEqual((str(result), result.retryable), ('media download failed: ConnectionError', True))
        self.assertTrue(answer.closed)

    def test_the_total_deadline_bounds_a_slow_download(self):
        answer = body(b'x' * 10)
        with patch.object(media_download.time, 'monotonic', side_effect=[0, 1000]):
            result = self.download(answer, deadline=60)
        self.assertEqual((str(result), result.retryable), ('media download timed out', True))
        self.assertTrue(answer.closed)

    def test_the_content_type_is_returned_as_the_provider_sent_it(self):
        answer = body(b'abc', headers={'Content-Type': 'image/png'})
        self.assertEqual(self.download(answer), (b'abc', 'image/png'))
