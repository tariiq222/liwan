# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from io import BytesIO
from unittest.mock import patch

from PIL import Image

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import WebVueApiCase

PASSWORD = 'company_profile_pass_123'
ADMIN = 'company_profile_admin'
READER = 'company_profile_reader'
EMPLOYEE = 'company_profile_employee'
ROUTE = '/api/v1/admin/company'
VALID_VAT = '300000000000003'
PROFILE_KEYS = {
    'id', 'name', 'logo_url', 'report_header', 'company_registry', 'vat', 'saudi_fields',
    'l10n_sa_edi_additional_identification_scheme', 'l10n_sa_edi_additional_identification_number',
    'address', 'email', 'phone', 'website', 'currency', 'completeness',
}
ADDRESS_KEYS = {
    'street', 'street2', 'city', 'zip', 'state', 'country',
    'l10n_sa_edi_building_number', 'l10n_sa_edi_plot_identification',
}


def image_base64(image_format='PNG', size=(1, 1)):
    stream = BytesIO()
    Image.new('RGB', size, (0, 85, 255)).save(stream, format=image_format)
    return base64.b64encode(stream.getvalue()).decode()


@tagged('post_install', '-at_install', 'webvue')
class TestCompanyProfile(WebVueApiCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.saudi = cls.env.ref('base.sa')
        cls.state = cls.env['res.country.state'].search([('country_id', '=', cls.saudi.id)], limit=1)
        new_test_user(cls.env, login=ADMIN, password=PASSWORD, groups='webvue_core.group_customer_admin')
        new_test_user(cls.env, login=EMPLOYEE, password=PASSWORD, groups='webvue_core.group_employee')
        reader = new_test_user(cls.env, login=READER, password=PASSWORD, groups='webvue_core.group_employee')
        role = cls.env['webvue.access.role'].create({
            'key': 'company_profile_reader', 'name_ar': 'قارئ', 'name_en': 'Reader', 'type': 'custom',
            'permission_ids': [Command.set(cls.env['webvue.access.permission'].search([('key', '=', 'settings.company.read')]).ids)],
        })
        cls.env['webvue.access.service']._webvue_replace_assignments(
            reader, [{'role_id': role.id, 'company_id': cls.company.id}],
        )

    def _patch(self, body):
        return self.api('PATCH', ROUTE, body)

    def test_the_capabilities_gate_every_route(self):
        for login, allowed in ((EMPLOYEE, ()), (READER, ('GET',)), (ADMIN, ('GET', 'PATCH', 'POST'))):
            self.authenticate(login, PASSWORD)
            for method, path, body in (
                ('GET', ROUTE, None), ('PATCH', ROUTE, {'city': 'Riyadh'}), ('POST', f'{ROUTE}/logo', {'data': image_base64()}),
            ):
                with self.subTest(login=login, method=method):
                    status = self.api(method, path, body).status_code
                    if method in allowed:
                        self.assertEqual(status, 200)
                    else:
                        self.assertEqual(status, 403)

    def test_get_returns_the_whitelisted_profile(self):
        self.company.write({'name': 'Erada', 'vat': VALID_VAT, 'country_id': self.saudi.id, 'street': 'King Fahd Road'})
        self.authenticate(ADMIN, PASSWORD)
        body = self.api('GET', ROUTE).json()
        self.assertEqual(set(body), PROFILE_KEYS)
        self.assertEqual(set(body['address']), ADDRESS_KEYS)
        self.assertEqual((body['id'], body['name'], body['vat']), (self.company.id, 'Erada', VALID_VAT))
        self.assertEqual(body['address']['country'], {'id': self.saudi.id, 'name': self.saudi.name, 'code': 'SA'})
        self.assertEqual(set(body['currency']), {'id', 'name', 'symbol'})
        self.assertEqual(body['currency']['id'], self.company.currency_id.id)
        self.assertEqual(body['saudi_fields'], 'l10n_sa_edi_building_number' in self.company._fields)
        self.assertIsNone(body['logo_url'])
        self.assertIsNone(body['phone'])

    def test_patch_writes_every_editable_field_and_returns_the_profile(self):
        self.company.country_id = self.saudi
        self.authenticate(ADMIN, PASSWORD)
        payload = {
            'name': 'Erada Co', 'report_header': 'Built to last', 'company_registry': '1010000000', 'vat': VALID_VAT,
            'street': 'King Fahd Road', 'street2': 'Al Olaya', 'city': 'Riyadh', 'zip': '12211',
            'state_id': self.state.id,
            'email': 'info@erada.example', 'phone': '+966110000000', 'website': 'https://erada.example',
            'l10n_sa_edi_building_number': '1234', 'l10n_sa_edi_plot_identification': '5678',
            'l10n_sa_edi_additional_identification_scheme': 'CRN', 'l10n_sa_edi_additional_identification_number': '1010000000',
        }
        response = self._patch(payload)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['name'], body['report_header'], body['vat']), ('Erada Co', 'Built to last', VALID_VAT))
        self.assertEqual(body['address']['state'], {'id': self.state.id, 'name': self.state.name})
        self.assertEqual((body['address']['street2'], body['address']['l10n_sa_edi_building_number']), ('Al Olaya', '1234'))
        self.assertEqual((body['l10n_sa_edi_additional_identification_scheme'], body['email']), ('CRN', 'info@erada.example'))
        self.assertEqual(self.api('GET', ROUTE).json(), body)
        self.env.invalidate_all()
        self.assertEqual((self.company.name, self.company.partner_id.name, self.company.vat), ('Erada Co', 'Erada Co', VALID_VAT))
        self.assertEqual(self.company.l10n_sa_edi_plot_identification, '5678')

    def test_null_and_blank_clear_an_optional_field_but_not_the_name(self):
        self.company.write({'phone': '123', 'website': 'https://x.example'})
        self.authenticate(ADMIN, PASSWORD)
        body = self._patch({'phone': None, 'website': '  '}).json()
        self.assertEqual((body['phone'], body['website']), (None, None))
        response = self._patch({'name': ' '})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'name'))

    def test_invalid_bodies_are_422_and_change_nothing(self):
        other_state = self.env['res.country.state'].search([('country_id', '!=', self.saudi.id)], limit=1)
        self.company.write({'country_id': self.saudi.id, 'city': 'Before'})
        self.authenticate(ADMIN, PASSWORD)
        before = self.api('GET', ROUTE).json()
        for body, code, field in (
            ({}, 'invalid', None),
            ({'currency': 'USD'}, 'invalid', 'currency'),
            ({'logo': image_base64()}, 'invalid', 'logo'),
            ({'completeness': 1}, 'invalid', 'completeness'),
            ({'city': 'After', 'vat': 'not-a-vat'}, 'invalid_vat', 'vat'),
            ({'city': 'After', 'vat': 12}, 'invalid', 'vat'),
            ({'city': 'After', 'email': 'nope'}, 'invalid', 'email'),
            ({'city': 'After', 'phone': 'x' * 300}, 'invalid', 'phone'),
            ({'city': 'After', 'country_id': self.saudi.id}, 'invalid', 'country_id'),
            ({'country_id': None}, 'invalid', 'country_id'),
            ({'city': 'After', 'state_id': 999999999}, 'invalid', 'state_id'),
            ({'city': 'After', 'state_id': other_state.id}, 'invalid', 'state_id'),
            ({'city': 'After', 'l10n_sa_edi_additional_identification_scheme': 'XXX'}, 'invalid',
             'l10n_sa_edi_additional_identification_scheme'),
        ):
            with self.subTest(body=body):
                response = self._patch(body)
                self.assertEqual((response.status_code, response.json()['code']), (422, code), response.text)
                if field:
                    self.assertEqual(response.json()['field'], field)
        self.assertEqual(self.api('GET', ROUTE).json(), before)

    def test_the_country_is_read_only_and_the_state_must_belong_to_it(self):
        self.company.write({'country_id': self.saudi.id, 'state_id': False})
        self.authenticate(ADMIN, PASSWORD)
        other_country = self.env['res.country.state'].search([('country_id', '!=', self.saudi.id)], limit=1).country_id
        response = self._patch({'country_id': other_country.id})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'country_id'))
        self.assertEqual(self._patch({'state_id': self.state.id}).status_code, 200)
        self.env.invalidate_all()
        self.assertEqual(self.company.country_id, self.saudi)

    def test_the_logo_upload_sets_the_logo_and_counts_toward_completeness(self):
        self.authenticate(ADMIN, PASSWORD)
        before = self.api('GET', ROUTE).json()
        response = self.api('POST', f'{ROUTE}/logo', {'data': image_base64('PNG', (8, 8))})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertRegex(body['logo_url'], rf'^/web/binary/company_logo\?company={self.company.id}&v=.+$')
        self.assertEqual(body['completeness']['done'], before['completeness']['done'] + 1)
        self.assertEqual(self.api('POST', f'{ROUTE}/logo', {'data': image_base64('JPEG', (8, 8))}).status_code, 200)

    def test_the_logo_upload_refuses_bad_data(self):
        self.authenticate(ADMIN, PASSWORD)
        too_big = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'0' * (2 * 1024 * 1024)).decode()
        for body in (
            {}, {'data': ''}, {'data': 12}, {'data': '***not base64***'},
            {'data': base64.b64encode(b'plain text').decode()},
            {'data': image_base64('GIF')}, {'data': too_big}, {'data': image_base64(), 'name': 'logo.png'},
        ):
            with self.subTest(body=str(body)[:40]):
                response = self.api('POST', f'{ROUTE}/logo', body)
                self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), response.text)
        self.assertIsNone(self.api('GET', ROUTE).json()['logo_url'])

    def test_the_completeness_counts_the_filled_profile_fields(self):
        self.company.write({
            'company_registry': False, 'vat': False, 'street': False, 'city': False, 'zip': False,
            'email': False, 'phone': False, 'country_id': self.saudi.id,
        })
        self.authenticate(ADMIN, PASSWORD)
        empty = self.api('GET', ROUTE).json()['completeness']
        self.assertEqual(empty['done'], 2)
        full = self._patch({
            'company_registry': '1', 'vat': VALID_VAT, 'street': 's', 'city': 'c', 'zip': '12345',
            'email': 'a@b.co', 'phone': '1',
        }).json()['completeness']
        self.assertEqual((full['done'], full['total']), (empty['total'] - 1, empty['total']))

    def test_a_contact_under_the_company_partner_does_not_block_a_vat_change(self):
        self.company.country_id = self.saudi
        self.env['res.partner'].create({'name': 'Accountant', 'parent_id': self.company.partner_id.id})
        self.authenticate(ADMIN, PASSWORD)
        response = self._patch({'company_registry': '1010000001', 'vat': VALID_VAT})
        self.assertEqual(response.status_code, 200, response.text)

    def test_the_profile_write_goes_through_the_whole_write_chain(self):
        company_model = type(self.env['res.company'])
        original = company_model.write
        written = []

        def spy(records, vals):
            written.append(set(vals))
            return original(records, vals)

        self.authenticate(ADMIN, PASSWORD)
        with patch.object(company_model, 'write', spy):
            self.assertEqual(self._patch({'city': 'Riyadh'}).status_code, 200)
        self.assertEqual(written, [{'city'}])

    def test_the_address_lookup_lists_the_states_of_a_country(self):
        self.authenticate(READER, PASSWORD)
        states = self.api('GET', f'{ROUTE}/countries/{self.saudi.id}/states').json()
        self.assertIn(self.state.id, [state['id'] for state in states['items']])
        self.assertEqual(set(states['items'][0]), {'id', 'name', 'code'})
        self.assertEqual(self.api('GET', f'{ROUTE}/countries/999999999/states').status_code, 404)
        self.authenticate(EMPLOYEE, PASSWORD)
        self.assertEqual(self.api('GET', f'{ROUTE}/countries/{self.saudi.id}/states').status_code, 403)
        self.authenticate(READER, PASSWORD)
        # The company country is fixed at provisioning, so there is no country list for the profile.
        self.assertEqual(self.api('GET', f'{ROUTE}/countries').status_code, 404)

    def test_the_orm_still_refuses_profile_writes_outside_the_protected_helper(self):
        admin = self.env['res.users'].search([('login', '=', ADMIN)])
        company = self.company.with_user(admin)
        for vals in ({'name': 'Direct'}, {'vat': VALID_VAT}, {'logo': image_base64()}, {'city': 'Direct'}):
            with self.assertRaises(AccessError), self.cr.savepoint():
                company.write(vals)
        with self.assertRaises(AccessError), self.cr.savepoint():
            company.partner_id.write({'name': 'Direct', 'vat': VALID_VAT})

    def test_the_helper_acts_on_the_current_company_only_and_on_whitelisted_fields(self):
        admin = self.env['res.users'].search([('login', '=', ADMIN)])
        sibling = self.env['res.company'].create({'name': 'Profile Sibling'})
        with self.assertRaises(AccessError):
            sibling.with_user(admin)._webvue_write_company_profile({'city': 'Elsewhere'})
        for vals in ({}, {'currency_id': 1}, {'primary_color': '#123456'}, {'city': 'Riyadh', 'parent_id': sibling.id}):
            with self.subTest(vals=vals), self.assertRaises(AccessError):
                self.company.with_user(admin)._webvue_write_company_profile(vals)
        employee = self.env['res.users'].search([('login', '=', EMPLOYEE)])
        with self.assertRaises(AccessError):
            self.company.with_user(employee)._webvue_write_company_profile({'city': 'Riyadh'})
        self.assertNotEqual(self.company.city, 'Riyadh')
