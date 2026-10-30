# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import re
from types import SimpleNamespace
from unittest.mock import patch

from odoo.tests import tagged

from .common import MANAGER_LOGIN, MANAGER_PASSWORD, LiwanFinanceCase
from .write_common import INVOICES, LiwanFinanceWriteCase
from odoo.addons.liwan_finance.serializers.setup import dump_setup
from odoo.addons.liwan_finance.serializers.zatca import dump_zatca_readiness

SECRET_KEY = re.compile(r'secret|token|password|csr|certificate|csid|credential|otp|^key$|private', re.IGNORECASE)
# The only key naming a secret holds a boolean: whether the private key exists.
PRESENCE_FLAGS = {'private_key_present'}
SECRET_VALUE = 'TOP-SECRET-MATERIAL'
JOURNAL_KEYS = {'journal', 'onboarded', 'state'}
ZATCA_KEYS = {'api_mode', 'private_key_present', 'journals', 'onboarded'}


def secret_keys(value):
    """Every dict key in a nested JSON value that looks like it names a secret."""
    if isinstance(value, dict):
        found = {key for key in value if SECRET_KEY.search(key) and key not in PRESENCE_FLAGS}
        return found.union(*(secret_keys(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(secret_keys(item) for item in value))
    return set()


def fake_journal(journal_id, ready, checks_passed):
    """A sale journal whose onboarding fields all hold secret material."""
    return SimpleNamespace(
        id=journal_id, name=f'Journal {journal_id}',
        l10n_sa_compliance_checks_passed=checks_passed,
        l10n_sa_production_csid_json=SECRET_VALUE, l10n_sa_compliance_csid_json=SECRET_VALUE,
        l10n_sa_csr=SECRET_VALUE,
        _l10n_sa_ready_to_submit_einvoices=lambda: SECRET_VALUE if ready else False,
    )


def fake_company(journals, has_key=True):
    env = {'account.journal': SimpleNamespace(search=lambda domain: journals)}
    return SimpleNamespace(
        id=1, env=env, l10n_sa_api_mode='sandbox',
        l10n_sa_private_key_id=SECRET_VALUE if has_key else False,
    )


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceZatcaReadiness(LiwanFinanceCase):

    def setUp(self):
        super().setUp()
        self.authenticate(MANAGER_LOGIN, MANAGER_PASSWORD)

    def _setup(self):
        result = self.api('GET', '/api/v1/finance/setup')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_the_real_company_reports_its_readiness_in_the_setup(self):
        zatca = dump_zatca_readiness(self.company)
        self.assertEqual(set(zatca), ZATCA_KEYS)
        self.assertEqual(self._setup()['zatca'], zatca)

    def test_each_sale_journal_reports_its_onboarding_state(self):
        company = fake_company([fake_journal(1, ready=True, checks_passed=True), fake_journal(2, False, True),
                                fake_journal(3, False, False)])
        zatca = dump_zatca_readiness(company)
        self.assertEqual(set(zatca), ZATCA_KEYS)
        self.assertEqual(
            [(row['journal']['id'], row['onboarded'], row['state']) for row in zatca['journals']],
            [(1, True, 'onboarded'), (2, False, 'compliance_checked'), (3, False, 'not_started')],
        )
        self.assertEqual((zatca['api_mode'], zatca['private_key_present'], zatca['onboarded']), ('sandbox', True, False))
        for row in zatca['journals']:
            self.assertEqual(set(row), JOURNAL_KEYS)

    def test_the_company_is_onboarded_only_with_a_key_and_every_journal_onboarded(self):
        ready = [fake_journal(1, True, True)]
        self.assertTrue(dump_zatca_readiness(fake_company(ready))['onboarded'])
        self.assertFalse(dump_zatca_readiness(fake_company(ready, has_key=False))['onboarded'])
        self.assertFalse(dump_zatca_readiness(fake_company([]))['onboarded'])

    def test_a_company_that_is_not_onboarded_blocks_setup(self):
        zatca = {'onboarded': False}
        with patch('odoo.addons.liwan_finance.serializers.setup.dump_zatca_readiness', return_value=zatca):
            body = dump_setup(self.company)
        self.assertIn('zatca_not_onboarded', body['blockers'])
        self.assertFalse(body['ready'])

    def test_no_secret_key_or_value_reaches_any_serializer_output(self):
        company = fake_company([fake_journal(1, True, True), fake_journal(2, False, False)])
        fake = dump_zatca_readiness(company)
        self.assertEqual(secret_keys(fake), set())
        self.assertNotIn(SECRET_VALUE, json.dumps(fake))
        self.assertEqual(secret_keys(dump_zatca_readiness(self.company)), set())
        self.assertEqual(secret_keys(self._setup()), set())
        report = self.api('GET', '/api/v1/finance/reports/vat?date_from=2026-10-01&date_to=2026-10-31').json()
        self.assertEqual(secret_keys(report), set())

    def test_the_guard_itself_catches_a_leak(self):
        leaked = {'journals': [{'l10n_sa_production_csid_json': 'x', 'private_key': 'y'}], 'private_key_present': True}
        self.assertEqual(secret_keys(leaked), {'l10n_sa_production_csid_json', 'private_key'})


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceZatcaRealModule(LiwanFinanceWriteCase):
    """The real l10n_sa_edi refusal. The shared fixture sells through journals without the ZATCA
    format; this class links the format back, so the Saudi company's sales journal is not
    ZATCA-onboarded and Odoo refuses to post: the route answers 422 ``zatca_not_onboarded``.
    No onboarding or network call is made.
    """

    def test_posting_on_a_journal_that_is_not_onboarded_is_a_422_zatca_not_onboarded(self):
        draft = self.create_invoice()
        self._journal(self.company, 'sale').edi_format_ids = self.env.ref('l10n_sa_edi.edi_sa_zatca')
        result = self.api('POST', f'{INVOICES}/{draft["id"]}/post', json={})
        self.assertRefused(result, 422, 'zatca_not_onboarded')
        self.assertIn('not onboarded', result.json()['details']['detail'])
        self.assertEqual(self.env['account.move'].browse(draft['id']).state, 'draft')
