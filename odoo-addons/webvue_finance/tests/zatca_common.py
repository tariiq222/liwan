# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A stand-in for the ZATCA gateway, patched in where stock ``l10n_sa_edi`` calls ``requests.request``.

The fake only answers the sandbox developer-portal URL and fails the test on any other URL, so a
mocked test can never reach (or be mistaken for) a live environment. It issues real certificates
for the CSR it receives, so stock's certificate/key compatibility checks and XML signing run for real.
"""
import base64
import datetime
import json
from unittest.mock import patch

import requests
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from lxml import etree

from .test_finance_zatca import secret_keys
from .write_common import PASSWORD, WebVueFinanceWriteCase

REQUESTS_REQUEST = 'requests.request'
SANDBOX_URL = 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/'
SANDBOX_OTP = '123345'
FAKE_SECRET = 'FAKE-CSID-SECRET-DO-NOT-LEAK'
SELLER_VAT = '399999999900003'
BUYER_VAT = '399999999800003'
CAC = '{urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2}'
CBC = '{urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2}'
PASS = {'status': 'PASS', 'warningMessages': [], 'errorMessages': []}
WARNING = {
    'type': 'WARNING', 'code': 'BR-KSA-08', 'category': 'KSA', 'status': 'WARNING',
    'message': 'The seller identification must exist only once with one of the scheme IDs',
}
ERROR = {
    'type': 'ERROR', 'code': 'BR-KSA-F-06-C01', 'category': 'KSA', 'status': 'ERROR',
    'message': 'The invoice type code is not valid for this document',
}


def reply(status, payload, text=None):
    """A requests.Response as stock reads it (status, reason, text and json)."""
    response = requests.Response()
    response.status_code = status
    response.reason = 'ZATCA'
    response.url = SANDBOX_URL
    response._content = (text if text is not None else json.dumps(payload)).encode()
    return response


def results(status='PASS', warnings=(), errors=()):
    return {'status': status, 'warningMessages': list(warnings), 'errorMessages': list(errors)}


class FakeZatca:
    """The gateway. ``answers`` maps an endpoint to a callable(body) -> Response (or raising);
    ``calls`` records ``(endpoint, method)``."""

    def __init__(self):
        self.calls = []
        self.answers = {}
        self._ca_key = ec.generate_private_key(ec.SECP256K1())
        self._public_key = None

    def endpoints(self):
        return [endpoint for endpoint, _method in self.calls]

    def _certificate(self, public_key):
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'TST-FAKE-ZATCA')])
        now = datetime.datetime.now(datetime.UTC)
        certificate = (
            x509.CertificateBuilder()
            .subject_name(name).issuer_name(name).public_key(public_key)
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=365))
            .sign(self._ca_key, hashes.SHA256())
        )
        der = certificate.public_bytes(serialization.Encoding.DER)
        return base64.b64encode(base64.b64encode(der)).decode()

    def _ccsid(self, body):
        csr = x509.load_pem_x509_csr(base64.b64decode(json.loads(body)['csr']))
        self._public_key = csr.public_key()
        return reply(200, {
            'requestID': 1234567890123, 'dispositionMessage': 'ISSUED',
            'binarySecurityToken': self._certificate(self._public_key), 'secret': FAKE_SECRET,
        })

    def _pcsid(self, _body):
        return reply(200, {
            'requestID': 30368, 'dispositionMessage': 'ISSUED',
            'binarySecurityToken': self._certificate(self._public_key), 'secret': FAKE_SECRET,
        })

    @staticmethod
    def _compliance(_body):
        return reply(200, {'validationResults': PASS, 'reportingStatus': 'REPORTED', 'clearanceStatus': 'CLEARED'})

    @staticmethod
    def _clearance(body):
        """Like ZATCA: the cleared invoice is the submitted one with the QR code stamped in."""
        root = etree.fromstring(base64.b64decode(json.loads(body)['invoice']))
        if not root.xpath('//*[local-name()="ID"][text()="QR"]'):  # a standard invoice is submitted without it
            reference = etree.Element(f'{CAC}AdditionalDocumentReference')
            etree.SubElement(reference, f'{CBC}ID').text = 'QR'
            attachment = etree.SubElement(reference, f'{CAC}Attachment')
            etree.SubElement(attachment, f'{CBC}EmbeddedDocumentBinaryObject', mimeCode='text/plain')
            root.xpath('//*[local-name()="AdditionalDocumentReference"]')[-1].addnext(reference)
        root.xpath('//*[local-name()="ID"][text()="QR"]/following-sibling::*/*')[0].text = 'RkFLRS1RUg=='
        cleared = base64.b64encode(etree.tostring(root)).decode()
        return reply(200, {'validationResults': PASS, 'clearanceStatus': 'CLEARED', 'clearedInvoice': cleared})

    @staticmethod
    def _reporting(_body):
        return reply(200, {'validationResults': PASS, 'reportingStatus': 'REPORTED'})

    def __call__(self, method, url, data=None, headers=None, timeout=None, **_kwargs):
        assert url.startswith(SANDBOX_URL), f'a test reached {url}, which is not the ZATCA sandbox'
        endpoint = url[len(SANDBOX_URL):]
        self.calls.append((endpoint, method))
        defaults = {
            'compliance': self._ccsid, 'production/csids': self._pcsid, 'compliance/invoices': self._compliance,
            'invoices/clearance/single': self._clearance, 'invoices/reporting/single': self._reporting,
        }
        return {**defaults, **self.answers}[endpoint](data)

    def patched(self):
        return patch(REQUESTS_REQUEST, self)


def unreachable(_body):
    message = 'HTTPSConnectionPool: Max retries exceeded (connection refused)'
    raise requests.exceptions.ConnectionError(message)


def answer(status, payload):
    return lambda _body: reply(status, payload)


class WebVueZatcaCase(WebVueFinanceWriteCase):
    """Company A with a complete Saudi identity and ZATCA sales journal, plus a B2B and a B2C buyer.

    The shared fixture sells through journals without the ZATCA format; this class links it back and
    leaves the sales journal not onboarded: each test onboards it (or not) through the routes.
    """

    SECRET_PARTS = (FAKE_SECRET, 'BEGIN', 'binarySecurityToken')

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        saudi_arabia = cls.env.ref('base.sa')
        state = cls.env['res.country.state'].search([('country_id', '=', saudi_arabia.id)], limit=1)
        cls.company.write({
            'vat': SELLER_VAT, 'company_registry': '1010000000', 'street': 'King Fahd Road',
            'city': 'Riyadh', 'zip': '12345', 'state_id': state.id,
        })
        cls.sale_journal = cls._journal(cls.company, 'sale')
        cls.sale_journal.edi_format_ids = cls.env.ref('l10n_sa_edi.edi_sa_zatca')
        address = {'country_id': saudi_arabia.id, 'state_id': state.id, 'city': 'Riyadh', 'zip': '12222', 'street': 'Olaya St'}
        cls.b2b_buyer = cls.env['res.partner'].create({
            'name': 'Al Noor Company', 'company_type': 'company', 'vat': BUYER_VAT, **address,
            'l10n_sa_edi_building_number': '1234', 'l10n_sa_edi_plot_identification': '1234',
            'l10n_sa_edi_additional_identification_scheme': 'CRN', 'l10n_sa_edi_additional_identification_number': '1010010000',
        })
        cls.b2c_buyer = cls.env['res.partner'].create({'name': 'Sara Individual', 'company_type': 'person', **address})
        cls.submitter = cls.user_with('zatca_submitter', ['finance.zatca.read', 'finance.zatca.submit', 'finance.invoices.read'])
        cls.reader = cls.user_with('zatca_reader', ['finance.zatca.read', 'finance.invoices.read'])
        cls.env['webvue.integration.connection']._webvue_ensure_default_connections()

    def setUp(self):
        super().setUp()
        self.zatca = FakeZatca()

    def onboard(self, journal=None, otp=SANDBOX_OTP):
        with self.zatca.patched():
            return self.api('POST', f'/api/v1/finance/zatca/journals/{(journal or self.sale_journal).id}/onboard', json={'otp': otp})

    def onboarded_journal(self):
        result = self.onboard()
        self.assertEqual(result.status_code, 200, result.text)
        return self.sale_journal

    def sale_invoice(self, partner=None):
        """A posted Saudi invoice of 1000 SAR + 15% VAT through the API; its ZATCA document waits in ``to_send``."""
        body = self.invoice_body(partner_id=(partner or self.b2b_buyer).id, invoice_date=self.today())
        with self.zatca.patched():
            return self.posted_invoice(body)

    @staticmethod
    def today():
        riyadh = datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=3)
        return (riyadh - datetime.timedelta(days=1)).date().isoformat()

    def submit(self, invoice, action='submit'):
        with self.zatca.patched():
            return self.api('POST', f'/api/v1/finance/invoices/{invoice["id"]}/zatca/{action}', json={})

    def assertNoSecrets(self, result):  # noqa: N802
        text = result.text
        for part in self.SECRET_PARTS:
            self.assertNotIn(part, text)
        self.assertEqual(secret_keys(result.json()), set())

    def force_api_mode(self, mode):
        """Set the company api mode behind the ORM, as an old database row would hold it."""
        self.env.cr.execute('UPDATE res_company SET l10n_sa_api_mode = %s WHERE id = %s', [mode, self.company.id])
        self.company.invalidate_recordset(['l10n_sa_api_mode'])

    def login_as(self, login):
        self.authenticate(login, PASSWORD)
