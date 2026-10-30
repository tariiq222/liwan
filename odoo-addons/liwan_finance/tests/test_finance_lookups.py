# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .write_common import PASSWORD, LiwanFinanceWriteCase

COUNTRIES = '/api/v1/finance/countries'


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceLookups(LiwanFinanceWriteCase):

    def test_countries_are_a_paged_envelope_with_id_name_and_code(self):
        result = self.api('GET', COUNTRIES + '?limit=5').json()
        self.assertEqual(set(result), {'items', 'total'})
        self.assertEqual(len(result['items']), 5)
        self.assertGreater(result['total'], 200)
        self.assertEqual(set(result['items'][0]), {'id', 'name', 'code'})

    def test_q_matches_the_name_or_the_code(self):
        by_name = self.api('GET', COUNTRIES + '?q=saudi').json()
        self.assertEqual([item['code'] for item in by_name['items']], ['SA'])
        by_code = self.api('GET', COUNTRIES + '?q=SA').json()
        self.assertIn('SA', [item['code'] for item in by_code['items']])

    def test_states_of_a_country(self):
        us = self.env.ref('base.us')
        result = self.api('GET', f'{COUNTRIES}/{us.id}/states?q=california').json()
        self.assertEqual([item['code'] for item in result['items']], ['CA'])
        self.assertEqual(set(result['items'][0]), {'id', 'name', 'code'})
        self.assertGreater(self.api('GET', f'{COUNTRIES}/{us.id}/states').json()['total'], 40)
        stateless = self.env['res.country'].create({'name': 'Stateless Land', 'code': 'ZZ'})
        self.assertEqual(self.api('GET', f'{COUNTRIES}/{stateless.id}/states').json(), {'items': [], 'total': 0})

    def test_an_unknown_country_is_404(self):
        self.assertEqual(self.api('GET', f'{COUNTRIES}/0/states').status_code, 404)

    def test_names_come_in_the_language_of_the_request_user(self):
        self.env['res.lang']._activate_lang('ar_001')
        saudi = self.env.ref('base.sa')
        saudi.with_context(lang='ar_001').name = 'المملكة العربية السعودية'
        reader = self.user_with('finance_lookup_arabic', ['finance.partners.read'])
        reader.lang = 'ar_001'
        self.authenticate('finance_lookup_arabic', PASSWORD)
        arabic = self.api('GET', COUNTRIES + '?q=SA').json()['items']
        self.assertIn('المملكة العربية السعودية', [item['name'] for item in arabic])
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        english = self.api('GET', COUNTRIES + '?q=SA').json()['items']
        self.assertIn('Saudi Arabia', [item['name'] for item in english])

    def test_either_partners_read_or_setup_read_opens_the_lookups(self):
        for login, keys, allowed in (
            ('finance_lookup_partners', ['finance.partners.read'], True),
            ('finance_lookup_setup', ['finance.setup.read'], True),
            ('finance_lookup_invoices', ['finance.invoices.read'], False),
        ):
            with self.subTest(login=login):
                self.user_with(login, keys)
                self.authenticate(login, PASSWORD)
                for path in (COUNTRIES, f'{COUNTRIES}/{self.env.ref("base.us").id}/states'):
                    result = self.api('GET', path)
                    if allowed:
                        self.assertEqual(result.status_code, 200)
                    else:
                        self.assertRefused(result, 403, 'forbidden')

    def test_a_user_without_finance_access_is_403(self):
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        self.assertRefused(self.api('GET', COUNTRIES), 403, 'forbidden')
