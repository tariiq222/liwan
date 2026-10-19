# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One live smoke test against ZATCA's SANDBOX (developer portal), skipped unless asked for.

    WEBVUE_ZATCA_SANDBOX=1 python3 -B tools/odoo_test.py --addons webvue_finance --no-dependents

It needs outbound HTTPS to gw-fatoora.zatca.gov.sa. The company keeps the ``sandbox`` api mode, the
data is fictitious and the sandbox accepts the OTP the stock wizard proposes; nothing here can reach
the simulation or production environments (the routes refuse any other api mode).
"""
import logging
import os
import unittest
from unittest.mock import patch

import requests

from odoo.tests import tagged
from odoo.tests.common import _super_send

from .zatca_common import SANDBOX_OTP, WebVueZatcaCase

_logger = logging.getLogger(__name__)
LIVE = os.environ.get('WEBVUE_ZATCA_SANDBOX') == '1'


@tagged('post_install', '-at_install', 'webvue')
@unittest.skipUnless(LIVE, 'set WEBVUE_ZATCA_SANDBOX=1 to call the live ZATCA sandbox')
class TestFinanceZatcaSandboxSmoke(WebVueZatcaCase):

    def setUp(self):
        super().setUp()
        # Odoo's test runner blocks every external HTTP request; this one test is the exception.
        patcher = patch.object(requests.Session, 'send', _super_send)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_onboard_then_clear_a_standard_invoice_and_report_a_simplified_one(self):
        self.assertEqual(self.company.l10n_sa_api_mode, 'sandbox')
        result = self.api('POST', f'/api/v1/finance/zatca/journals/{self.sale_journal.id}/onboard', json={'otp': SANDBOX_OTP})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()['onboarded'])
        self.assertNoSecrets(result)
        for partner, mode in ((self.b2b_buyer, 'clearance'), (self.b2c_buyer, 'reporting')):
            invoice = self.posted_invoice(self.invoice_body(partner_id=partner.id, invoice_date=self.today()))
            submitted = self.api('POST', f'/api/v1/finance/invoices/{invoice["id"]}/zatca/submit', json={})
            self.assertEqual(submitted.status_code, 200, submitted.text)
            body = submitted.json()
            self.assertEqual((body['state'], body['mode']), ('accepted', mode), submitted.text)
            self.assertNoSecrets(submitted)
            _logger.info('ZATCA sandbox %s: %s', mode, body)
