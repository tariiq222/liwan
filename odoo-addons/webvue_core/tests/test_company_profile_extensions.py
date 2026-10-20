# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.tests import TransactionCase, tagged

GOOD = {'name': 'font', 'section': 'identity', 'kind': 'selection'}


@tagged('post_install', '-at_install', 'webvue')
class TestCompanyProfileExtensions(TransactionCase):
    """A company profile extension is checked when it is read: a bad declaration fails loudly."""

    def _specs(self, spec):
        company = self.env['res.company']
        with patch.object(type(company), '_webvue_company_profile_extensions', return_value=[spec]):
            return company._webvue_company_profile_extension_specs()

    def test_a_good_declaration_passes_and_names_its_field(self):
        self.assertEqual(self._specs(GOOD), [GOOD])
        company = self.env['res.company']
        with patch.object(type(company), '_webvue_company_profile_extensions', return_value=[GOOD]):
            self.assertEqual(company._webvue_company_profile_extension_fields(), {'font'})

    def test_a_bad_declaration_raises(self):
        for spec in (
            {**GOOD, 'name': 'no_such_field'},
            {**GOOD, 'name': 'city', 'kind': 'text'},
            {**GOOD, 'name': 'report_header', 'kind': 'text'},
            {**GOOD, 'name': 'country_id', 'kind': 'text'},
            {**GOOD, 'name': 'currency_id', 'kind': 'text'},
            {**GOOD, 'section': 'contact'},
            {**GOOD, 'kind': 'text'},
            {**GOOD, 'kind': 'number'},
        ):
            with self.subTest(spec=spec), self.assertRaises(ValueError):
                self._specs(spec)
