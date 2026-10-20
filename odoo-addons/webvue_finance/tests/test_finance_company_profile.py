# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import WebVueApiCase

PASSWORD = 'finance_company_profile_pass_123'
ADMIN = 'finance_company_profile_admin'
ROUTE = '/api/v1/admin/company'
EXTENSIONS = {
    'l10n_sa_edi_building_number': ('address', 'text'),
    'l10n_sa_edi_plot_identification': ('address', 'text'),
    'l10n_sa_edi_additional_identification_scheme': ('identity', 'selection'),
    'l10n_sa_edi_additional_identification_number': ('identity', 'text'),
}


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceCompanyProfile(WebVueApiCase):
    """Finance adds the Saudi e-invoicing identity to the generic company profile."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        new_test_user(cls.env, login=ADMIN, password=PASSWORD, groups='webvue_core.group_customer_admin')

    def setUp(self):
        super().setUp()
        self.authenticate(ADMIN, PASSWORD)

    def test_the_profile_lists_the_four_saudi_fields_as_extensions(self):
        extensions = {item['name']: item for item in self.api('GET', ROUTE).json()['extensions']}
        self.assertEqual({name: (item['section'], item['kind']) for name, item in extensions.items()}, EXTENSIONS)
        scheme = extensions['l10n_sa_edi_additional_identification_scheme']
        self.assertIn('CRN', [option['value'] for option in scheme['options']])
        self.assertEqual(extensions['l10n_sa_edi_building_number']['label'], 'Building number')
        self.assertEqual(
            {name: item.get('inputmode') for name, item in extensions.items()},
            {
                'l10n_sa_edi_building_number': 'numeric', 'l10n_sa_edi_plot_identification': 'numeric',
                'l10n_sa_edi_additional_identification_scheme': None, 'l10n_sa_edi_additional_identification_number': None,
            },
        )

    def test_the_extension_fields_write_through_the_guard(self):
        response = self.api('PATCH', ROUTE, {
            'l10n_sa_edi_building_number': '1234', 'l10n_sa_edi_plot_identification': '5678',
            'l10n_sa_edi_additional_identification_scheme': 'CRN',
            'l10n_sa_edi_additional_identification_number': '1010000000',
        })
        self.assertEqual(response.status_code, 200, response.text)
        values = {item['name']: item['value'] for item in response.json()['extensions']}
        self.assertEqual(values, {
            'l10n_sa_edi_building_number': '1234', 'l10n_sa_edi_plot_identification': '5678',
            'l10n_sa_edi_additional_identification_scheme': 'CRN',
            'l10n_sa_edi_additional_identification_number': '1010000000',
        })
        company = self.env.company
        company.invalidate_recordset()
        self.assertEqual(
            (company.partner_id.l10n_sa_edi_plot_identification, company.l10n_sa_edi_additional_identification_scheme),
            ('5678', 'CRN'),
        )

    def test_the_extension_validation_is_kept(self):
        for body, field in (
            ({'l10n_sa_edi_additional_identification_scheme': 'XXX'}, 'l10n_sa_edi_additional_identification_scheme'),
            ({'l10n_sa_edi_building_number': 'x' * 300}, 'l10n_sa_edi_building_number'),
        ):
            with self.subTest(body=body):
                response = self.api('PATCH', ROUTE, body)
                self.assertEqual((response.status_code, response.json()['field']), (422, field))
