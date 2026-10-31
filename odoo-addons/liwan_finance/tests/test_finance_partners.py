# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PARTNERS, SAUDI_VAT, LiwanFinanceWriteCase

PARTNER_KEYS = {
    'id', 'name', 'vat', 'company_registry', 'street', 'city', 'state', 'country', 'is_company',
    'customer', 'vendor', 'active',
}


@tagged('post_install', '-at_install', 'liwan')
class TestFinancePartners(LiwanFinanceWriteCase):

    def _create(self, **fields):
        result = self.api('POST', PARTNERS, json={'name': 'Riyadh Builders', **fields})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def _ids(self, query=''):
        result = self.api('GET', f'{PARTNERS}{query}')
        self.assertEqual(result.status_code, 200, result.text)
        return {row['id'] for row in result.json()['items']}

    def test_creates_a_saudi_partner_in_the_current_company_with_the_whitelisted_shape(self):
        body = self._create(
            vat=SAUDI_VAT, company_registry='1010123456', street='King Fahd Rd', city='Riyadh',
            is_company=True, customer=True,
        )
        self.assertEqual(set(body), PARTNER_KEYS)
        self.assertEqual((body['vat'], body['company_registry'], body['is_company']), (SAUDI_VAT, '1010123456', True))
        self.assertEqual((body['customer'], body['vendor'], body['active']), (True, False, True))
        self.assertEqual(body['country'], {'id': self.env.ref('base.sa').id, 'name': 'Saudi Arabia'})
        partner = self.env['res.partner'].browse(body['id'])
        self.assertEqual((partner.company_id, partner.customer_rank), (self.company, 1))

    def test_a_vat_that_is_not_a_saudi_15_digit_number_is_a_422_invalid_vat(self):
        for vat in ('123', '400000000000003', '30000000000000x', '300000000000004'):
            with self.subTest(vat=vat):
                self.assertRefused(self.api('POST', PARTNERS, json={'name': 'Bad VAT', 'vat': vat}), 422, 'invalid_vat', 'vat')
        partner = self._create()
        self.assertRefused(
            self.api('PATCH', f'{PARTNERS}/{partner["id"]}', json={'vat': '12345'}), 422, 'invalid_vat', 'vat',
        )
        self.assertEqual(self.api('GET', f'{PARTNERS}/{partner["id"]}').json()['vat'], '')

    def test_patch_updates_only_the_sent_fields_and_the_rank_flags(self):
        partner = self._create(customer=True)
        result = self.api('PATCH', f'{PARTNERS}/{partner["id"]}', json={'city': 'Jeddah', 'vendor': True, 'customer': False})
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['city'], body['name'], body['customer'], body['vendor']), ('Jeddah', 'Riyadh Builders', False, True))

    def test_a_state_must_belong_to_the_partner_country(self):
        us_state = self.env['res.country.state'].search([('country_id', '=', self.env.ref('base.us').id)], limit=1)
        self.assertRefused(self.api('POST', PARTNERS, json={'name': 'X', 'state_id': us_state.id}), 422, 'invalid', 'state_id')
        saudi_state = self.env['res.country.state'].search([('country_id', '=', self.env.ref('base.sa').id)], limit=1)
        if saudi_state:
            self.assertEqual(self._create(state_id=saudi_state.id)['state']['id'], saudi_state.id)

    def test_bad_bodies_are_a_422_invalid(self):
        for body, field in (
            ({}, 'name'),
            ({'name': ''}, 'name'),
            ({'name': 'X', 'rank': 3}, 'rank'),
            ({'name': 'X', 'customer': 'yes'}, 'customer'),
            ({'name': 'X', 'country_id': 999999999}, 'country_id'),
            ({'name': 'X', 'city': 5}, 'city'),
        ):
            with self.subTest(body=body):
                self.assertRefused(self.api('POST', PARTNERS, json=body), 422, 'invalid', field)
        partner = self._create()
        self.assertRefused(self.api('PATCH', f'{PARTNERS}/{partner["id"]}', json={}), 422, 'invalid')

    def test_lists_filter_by_kind_text_and_archive_state(self):
        customer = self._create(name='Alpha Customer', customer=True, vat=SAUDI_VAT)
        vendor = self._create(name='Beta Vendor', vendor=True, company_registry='7001')
        self.assertIn(customer['id'], self._ids('?kind=customer'))
        self.assertNotIn(vendor['id'], self._ids('?kind=customer'))
        self.assertIn(vendor['id'], self._ids('?kind=vendor'))
        self.assertEqual(self._ids('?q=alpha') & {customer['id'], vendor['id']}, {customer['id']})
        self.assertEqual(self._ids(f'?q={SAUDI_VAT}'), {customer['id']})
        self.assertEqual(self._ids('?q=7001'), {vendor['id']})
        body = self.api('GET', f'{PARTNERS}?limit=1').json()
        self.assertEqual((set(body), len(body['items'])), ({'items', 'total'}, 1))
        self.assertGreater(body['total'], 1)
        for query in ('?kind=both', '?archived=maybe', '?limit=-1'):
            with self.subTest(query=query):
                self.assertRefused(self.api('GET', f'{PARTNERS}{query}'), 422, 'invalid')

    def test_archive_and_unarchive_move_a_partner_between_the_lists(self):
        partner = self._create()
        archived = self.api('POST', f'{PARTNERS}/{partner["id"]}/archive', json={})
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False))
        self.assertNotIn(partner['id'], self._ids())
        self.assertIn(partner['id'], self._ids('?archived=true'))
        self.assertEqual(self.api('GET', f'{PARTNERS}/{partner["id"]}').json()['active'], False)
        restored = self.api('POST', f'{PARTNERS}/{partner["id"]}/unarchive', json={})
        self.assertEqual(restored.json()['active'], True)
        self.assertIn(partner['id'], self._ids())

    def test_system_partners_are_neither_listed_nor_writable(self):
        system = {
            'user': self.employee.partner_id,
            'company': self.company.partner_id,
        }
        listed = self._ids('?limit=100')
        for kind, partner in system.items():
            route = f'{PARTNERS}/{partner.id}'
            with self.subTest(kind=kind):
                self.assertNotIn(partner.id, listed)
                for method, path, body in (
                    ('GET', route, None), ('PATCH', route, {'city': 'X'}),
                    ('POST', f'{route}/archive', {}), ('POST', f'{route}/unarchive', {}),
                ):
                    self.assertRefused(self.api(method, path, json=body), 404, 'not_found')
        self.assertIn(self.partner.id, listed)

    def test_an_employee_work_contact_is_neither_listed_nor_writable(self):
        if 'hr.employee' not in self.env:
            self.skipTest('hr is not installed in this database')
        contact = self.env['res.partner'].create({'name': 'Employee Contact'})
        self.env['hr.employee'].with_company(self.company).create({'name': 'Employee', 'work_contact_id': contact.id})
        self.assertNotIn(contact.id, self._ids('?limit=100'))
        self.assertRefused(self.api('PATCH', f'{PARTNERS}/{contact.id}', json={'city': 'X'}), 404, 'not_found')

    def test_there_is_no_delete(self):
        partner = self._create()
        self.assertNotEqual(self.api('DELETE', f'{PARTNERS}/{partner["id"]}').status_code, 200)
        self.assertTrue(self.env['res.partner'].browse(partner['id']).exists())

    def test_a_partner_of_another_company_is_a_404_everywhere(self):
        route = f'{PARTNERS}/{self.foreign_partner.id}'
        self.assertNotIn(self.foreign_partner.id, self._ids())
        for method, path in (
            ('GET', route), ('PATCH', route), ('POST', f'{route}/archive'), ('POST', f'{route}/unarchive'),
        ):
            with self.subTest(method=method, path=path):
                self.assertRefused(self.api(method, path, json={'city': 'X'} if method == 'PATCH' else {}), 404, 'not_found')
        self.assertRefused(self.api('GET', f'{PARTNERS}/999999999'), 404, 'not_found')
        self.assertIn(self.partner.id, self._ids())


@tagged('post_install', '-at_install', 'liwan')
class TestFinanceCompanyPartnersStayOut(LiwanFinanceWriteCase):
    """The partners of the tenant's own companies are not customers or vendors (issue #204)."""

    def _ids(self, query=''):
        result = self.api('GET', PARTNERS + query)
        self.assertEqual(result.status_code, 200, result.text)
        return {item['id'] for item in result.json()['items']}

    def test_no_company_partner_of_the_tenant_is_listed_even_of_a_company_the_user_is_not_in(self):
        hidden = {self.company.partner_id.id, self.other_company.partner_id.id}
        self.assertFalse(hidden & self._ids('?limit=100'))
        self.assertFalse(hidden & self._ids(f'?limit=100&q={self.other_company.name}'))

    def test_a_company_partner_cannot_be_opened_by_id(self):
        for partner in (self.company.partner_id, self.other_company.partner_id):
            with self.subTest(partner=partner.name):
                self.assertRefused(self.api('GET', f'{PARTNERS}/{partner.id}'), 404, 'not_found')

    def test_an_ordinary_partner_is_still_listed(self):
        self.assertIn(self.partner.id, self._ids('?limit=100'))
