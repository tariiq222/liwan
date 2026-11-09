# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_appointments.hooks import (
    AccessTokenLogFilter,
    mask_access_tokens,
    post_load,
)


@tagged('post_install', '-at_install', 'liwan')
class TestAccessTokenLogMask(TransactionCase):
    """#543: the requester's token travels in the query string, and werkzeug writes the request line to its log."""

    def test_a_request_line_keeps_its_path_and_loses_the_token(self):
        line = 'GET /api/v1/public/appointments/bookings/42?access_token=0f8b6a1c-77aa-4c2e-9e1f-1a2b3c4d5e6f HTTP/1.1'
        masked = mask_access_tokens(line)
        self.assertNotIn('0f8b6a1c-77aa-4c2e-9e1f-1a2b3c4d5e6f', masked)
        self.assertIn('/api/v1/public/appointments/bookings/42', masked)
        self.assertIn('access_token=***', masked)
        self.assertIn('HTTP/1.1', masked)

    def test_every_token_parameter_and_case_is_masked(self):
        for line, secret in (
            ('GET /pay/order/7?access_token=tok_en-1 HTTP/1.1', 'tok_en-1'),
            ('GET /api/v1/public/x?foo=1&access_token=abc&bar=2 HTTP/1.1', 'abc'),
            ('GET /api/v1/public/x?ACCESS_TOKEN=UPPER HTTP/1.1', 'UPPER'),
            ('GET /api/v1/public/x?token=short HTTP/1.1', 'short'),
        ):
            with self.subTest(line=line):
                masked = mask_access_tokens(line)
                self.assertNotIn('=%s' % secret, masked)
                self.assertIn('=***', masked)

    def test_a_line_without_a_token_is_unchanged(self):
        line = 'GET /api/v1/appointments/bookings?state=confirmed HTTP/1.1'
        self.assertEqual(mask_access_tokens(line), line)

    def test_the_filter_masks_the_formatted_arguments_of_a_record(self):
        record = logging.LogRecord('werkzeug', logging.INFO, __file__, 1, '"%s" %s %s', (
            'GET /api/v1/public/appointments/bookings/9?access_token=secret-value HTTP/1.1', '200', '-',
        ), None)
        AccessTokenLogFilter().filter(record)
        self.assertNotIn('secret-value', record.getMessage())
        self.assertEqual(record.getMessage(), '"GET /api/v1/public/appointments/bookings/9?access_token=*** HTTP/1.1" 200 -')
        # The filter never drops a record.
        self.assertTrue(AccessTokenLogFilter().filter(record))

    def test_the_filter_is_installed_once_on_the_werkzeug_logger(self):
        filters = [item for item in logging.getLogger('werkzeug').filters if isinstance(item, AccessTokenLogFilter)]
        self.assertEqual(len(filters), 1)
        # A second install (an upgrade) does not stack a duplicate filter.
        post_load()
        filters = [item for item in logging.getLogger('werkzeug').filters if isinstance(item, AccessTokenLogFilter)]
        self.assertEqual(len(filters), 1)
