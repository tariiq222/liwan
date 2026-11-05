# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestCountryArabicNames(TransactionCase):
    """Every country the shared lookup offers has an Arabic name, so no picker shows English to an Arabic user."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env['res.lang']._activate_lang('ar_001')
        cls.env['ir.module.module'].search([('name', 'in', ('base', 'liwan_api'))])._update_translations(['ar_001'])

    def test_every_country_has_an_arabic_name(self):
        countries = self.env['res.country'].with_context(active_test=False).search([])
        arabic = {country.id: country.name for country in countries.with_context(lang='ar_001')}
        english = {country.id: country.name for country in countries.with_context(lang='en_US')}
        untranslated = sorted(english[key] for key in english if arabic[key] == english[key])
        self.assertEqual(untranslated, [])

    def test_reloading_odoo_terms_keeps_the_arabic_names(self):
        self.env['ir.module.module'].search([('name', '=', 'base')])._update_translations(['ar_001'], overwrite=True)
        self.env.invalidate_all()
        self.assertEqual(self.env.ref('base.tr').with_context(lang='ar_001').name, 'تركيا')

    def test_an_arabic_name_the_company_edited_is_kept(self):
        country = self.env.ref('base.sz').with_context(lang='ar_001')
        country.name = 'مملكة إسواتيني'
        self.env['ir.module.module'].search([('name', '=', 'liwan_api')])._update_translations(['ar_001'])
        self.env.invalidate_all()
        self.assertEqual(country.name, 'مملكة إسواتيني')
