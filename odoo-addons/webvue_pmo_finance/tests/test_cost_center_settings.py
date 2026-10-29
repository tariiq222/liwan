# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import PmoFinanceCase

URL = '/api/v1/settings/projects'
MODE = 'webvue_pmo_finance_cost_center_mode'


@tagged('post_install', '-at_install', 'webvue')
class TestCostCenterSettings(PmoFinanceCase):

    def setUp(self):
        super().setUp()
        self.login_as(self.settings_admin)

    def test_the_mode_is_shown_and_written_through_the_pmo_settings(self):
        extensions = self.get_ok(URL)['extensions']
        self.assertEqual(len(extensions), 1)
        extension = extensions[0]
        self.assertEqual(
            {key: extension[key] for key in ('name', 'kind', 'value')},
            {'name': MODE, 'kind': 'selection', 'value': 'manual'},
        )
        self.assertEqual([option['value'] for option in extension['options']], ['auto', 'manual'])
        self.assertTrue(extension['label'] and extension['help'])
        patched = self.api('PATCH', URL, {MODE: 'auto'})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['extensions'][0]['value'], 'auto')
        self.assertEqual(self.company.webvue_pmo_finance_cost_center_mode, 'auto')
        self.assertEqual(self.get_ok(URL)['extensions'][0]['value'], 'auto')

    def test_a_value_outside_the_options_is_refused(self):
        for bad in ('sometimes', None, True, ['auto']):
            response = self.api('PATCH', URL, {MODE: bad})
            self.assertEqual((response.status_code, response.json()['field']), (422, MODE), bad)
        self.assertEqual(self.company.webvue_pmo_finance_cost_center_mode, 'manual')

    def test_the_mode_is_hidden_while_finance_is_switched_off(self):
        self.switch_finance(False)
        self.assertEqual(self.get_ok(URL)['extensions'], [])
        refused = self.api('PATCH', URL, {MODE: 'auto'})
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'unknown_field'))

    def test_the_mode_cannot_be_written_while_finance_is_only_retained_for_reading(self):
        self.switch_finance(False, retained=True)
        self.assertEqual(len(self.get_ok(URL)['extensions']), 1)
        refused = self.api('PATCH', URL, {MODE: 'auto'})
        self.assertEqual((refused.status_code, refused.json()['code']), (403, 'feature_not_included'))
        self.assertEqual(self.company.webvue_pmo_finance_cost_center_mode, 'manual')

    def test_the_labels_come_in_arabic_for_an_arabic_user(self):
        self.env['res.lang']._activate_lang('ar_001')
        self.env['ir.module.module']._load_module_terms(['webvue_pmo_finance'], ['ar_001'])
        self.settings_admin.lang = 'ar_001'
        self.login_as(self.settings_admin)  # the session keeps the language it was opened with
        extension = self.get_ok(URL)['extensions'][0]
        self.assertEqual(extension['label'], 'مراكز تكلفة المشاريع')
        self.assertEqual([option['label'] for option in extension['options']], ['تلقائي', 'يدوي'])

    def test_the_company_field_is_not_writable_outside_the_settings_operation(self):
        with self.assertRaises(AccessError):
            self.company.write({MODE: 'auto'})
        self.login_as(self.reader)
        self.assertEqual(self.api('PATCH', URL, {MODE: 'auto'}).status_code, 403)
