# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_appointments.hooks import (
    AccessTokenLogFilter,
    mask_access_tokens,
    post_load,
)

SECRETS = (
    # Every public path family that carries a secret in the request line: the requester's booking link, the payer's pay
    # link, the public catalog image (its token is a path segment), the WhatsApp handshake and a gateway callback.
    ('GET /book/42?access_token=0f8b6a1c-77aa-4c2e-9e1f-1a2b3c4d5e6f HTTP/1.1', '0f8b6a1c-77aa-4c2e-9e1f-1a2b3c4d5e6f'),
    ('GET /api/v1/public/appointments/bookings/42?access_token=book-token HTTP/1.1', 'book-token'),
    ('GET /pay/invoice/7?access_token=tok_en-1 HTTP/1.1', 'tok_en-1'),
    ('GET /pay/order/9/status?access_token=tok-order HTTP/1.1', 'tok-order'),
    ('GET /api/v1/public/payments/invoices/7?access_token=tok-api HTTP/1.1', 'tok-api'),
    ('GET /api/v1/public/payments/orders/9?foo=1&access_token=abc&bar=2 HTTP/1.1', 'abc'),
    ('GET /api/v1/public/appointments/bookings/42?ACCESS_TOKEN=UPPER HTTP/1.1', 'UPPER'),
    ('GET /api/v1/public/appointments/bookings/42?token=short HTTP/1.1', 'short'),
    ('GET /api/v1/public/inbox/catalog/images/9/abcdef0123 HTTP/1.1', 'abcdef0123'),
    ('GET /api/v1/inbox/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=handshake&hub.challenge=1 HTTP/1.1', 'handshake'),
    ('GET /api/v1/public/payments/hooks/paymob/webhook?hmac=deadbeef HTTP/1.1', 'deadbeef'),
    ('GET /api/v1/public/payments/hooks/paymob/return?signature=sig-value HTTP/1.1', 'sig-value'),
    ('POST /api/v1/public/account/password/reset?token=reset-value HTTP/1.1', 'reset-value'),
    # The token is not the first parameter: the mask still sees it.
    ('GET /pay/invoice/7?lang=ar&access_token=later-value HTTP/1.1', 'later-value'),
)


@tagged('post_install', '-at_install', 'liwan')
class TestAccessTokenLogMask(TransactionCase):
    """#543: a secret travels in the query string of every public route, and werkzeug writes the request line to its log."""

    def test_a_request_line_keeps_its_route_and_loses_the_token(self):
        line = 'GET /api/v1/public/appointments/bookings/42?access_token=0f8b6a1c-77aa-4c2e-9e1f-1a2b3c4d5e6f HTTP/1.1'
        masked = mask_access_tokens(line)
        self.assertNotIn('0f8b6a1c-77aa-4c2e-9e1f-1a2b3c4d5e6f', masked)
        self.assertIn('/api/v1/public/appointments/bookings/42', masked)
        self.assertIn('access_token=***', masked)
        self.assertIn('HTTP/1.1', masked)

    def test_every_public_path_family_and_parameter_is_masked(self):
        for line, secret in SECRETS:
            with self.subTest(line=line):
                masked = mask_access_tokens(line)
                self.assertNotIn(secret, masked)
                self.assertIn('***', masked)
                # The method, the route and the protocol survive, so the log stays usable.
                self.assertTrue(masked.startswith(line.split(' ')[0] + ' '))
                self.assertTrue(masked.endswith('HTTP/1.1'))

    def test_a_line_without_a_token_is_unchanged(self):
        for line in (
            'GET /api/v1/appointments/bookings?state=confirmed HTTP/1.1',
            'GET /pay/invoice/7?lang=ar HTTP/1.1',
            'GET /api/v1/public/appointments/bookings/42 HTTP/1.1',
            'GET /api/v1/inbox/hooks/whatsapp?hub.mode=subscribe&hub.challenge=42 HTTP/1.1',
            # A lookalike parameter name is not a secret.
            'GET /api/v1/public/x?monkey=2&key2=3 HTTP/1.1',
        ):
            with self.subTest(line=line):
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

    def test_the_filter_masks_a_pay_link_and_a_gateway_hmac_too(self):
        for message, secret in (
            ('"GET /pay/invoice/7?access_token=pays-secret HTTP/1.1" 200 -', 'pays-secret'),
            ('"GET /api/v1/public/payments/hooks/paymob/webhook?hmac=hook-secret HTTP/1.1" 200 -', 'hook-secret'),
        ):
            with self.subTest(message=message):
                record = logging.LogRecord('werkzeug', logging.INFO, __file__, 1, message, None, None)
                AccessTokenLogFilter().filter(record)
                self.assertNotIn(secret, record.getMessage())

    def test_the_filter_is_installed_once_on_the_werkzeug_logger(self):
        filters = [item for item in logging.getLogger('werkzeug').filters if isinstance(item, AccessTokenLogFilter)]
        self.assertEqual(len(filters), 1)
        # A second install (an upgrade) does not stack a duplicate filter.
        post_load()
        filters = [item for item in logging.getLogger('werkzeug').filters if isinstance(item, AccessTokenLogFilter)]
        self.assertEqual(len(filters), 1)


@tagged('post_install', '-at_install', 'liwan')
class TestEveryPublicFamilyLogsNoSecret(LiwanApiCase):
    """#543 end to end: the request line of each public path family reaches the werkzeug log masked."""

    def _logged(self, path):
        """The werkzeug lines written while ``path`` is requested, captured on the real logger."""
        records = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record.getMessage())

        logger = logging.getLogger('werkzeug')
        handler = Capture()
        logger.addHandler(handler)
        self.addCleanup(logger.removeHandler, handler)
        self.url_open(path)
        return [line for line in records if path.split('?')[0] in line]

    def test_the_payer_pay_link_is_masked(self):
        lines = self._logged('/pay/invoice/7?access_token=pay-link-secret')
        self.assertTrue(lines)
        for line in lines:
            self.assertNotIn('pay-link-secret', line)
            self.assertIn('access_token=***', line)

    def test_the_public_api_token_is_masked(self):
        lines = self._logged('/api/v1/public/payments/invoices/7?access_token=api-secret')
        self.assertTrue(lines)
        for line in lines:
            self.assertNotIn('api-secret', line)
            self.assertIn('access_token=***', line)
