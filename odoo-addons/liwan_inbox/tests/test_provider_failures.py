# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The provider boundary: which failures may be retried without risking a duplicate send."""
from unittest.mock import patch

import requests

from odoo.tests import BaseCase, tagged

from odoo.addons.liwan_inbox.adapters import whatsapp


@tagged('post_install', '-at_install', 'liwan')
class TestProviderFailures(BaseCase):

    def call(self, error):
        credentials = whatsapp.Credentials(phone_number_id='12345', business_account_id='67890', access_token='token')
        with patch.object(requests, 'request', side_effect=error):
            with self.assertRaises(whatsapp.ProviderError) as caught:
                whatsapp._call('POST', whatsapp._graph('messages'), credentials)
        return caught.exception

    def test_a_read_timeout_is_unconfirmed_and_not_retried(self):
        error = self.call(requests.exceptions.ReadTimeout('the answer arrived too late'))
        self.assertFalse(error.retryable)
        self.assertEqual(error.code, whatsapp.UNCERTAIN_CODE)

    def test_a_connection_error_is_retried(self):
        self.assertTrue(self.call(requests.exceptions.ConnectionError('refused')).retryable)

    def test_a_connect_timeout_is_retried(self):
        self.assertTrue(self.call(requests.exceptions.ConnectTimeout('never reached')).retryable)
