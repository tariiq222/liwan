# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The /api/v1/customers routes: sharing between branches, the conflict protocol, the gates and the settings."""
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_core.models.protected_write import marked
from odoo.addons.liwan_customers.models.res_partner import PARTY_MARKER
from odoo.addons.liwan_customers.tests.common import (
    CANDIDATES,
    COUNTRIES,
    CUSTOMERS,
    EXPORT,
    PHONE_E164,
    PHONE_LOCAL,
    SETTINGS,
    CustomersCase,
)

NOT_FOUND = 999999999


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersRoutes(CustomersCase):

    def test_an_establishment_customer_is_found_from_another_branch(self):
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Shared customer', 'phone': PHONE_LOCAL})
        self.assertEqual(customer['company'], None)
        self.assertEqual(customer['phone'], PHONE_E164)
        self.sign_in('cu_b_staff')
        self.assertIn(customer['id'], self.listed_ids('Shared'))
        self.assertEqual(self.candidate_ids(PHONE_LOCAL), [customer['id']])
        self.assertEqual(self.api('GET', f'{CUSTOMERS}/{customer["id"]}').status_code, 200)

    def test_a_branch_customer_is_hidden_from_a_sibling_branch(self):
        self.settings.sharing = 'branch'
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Branch customer', 'phone': PHONE_LOCAL})
        self.assertEqual(customer['company'], {'id': self.branch_a.id, 'name': self.branch_a.name})
        self.assertIn(customer['id'], self.listed_ids('Branch'))
        self.sign_in('cu_b_staff')
        self.assertNotIn(customer['id'], self.listed_ids('Branch'))
        self.assertEqual(self.candidate_ids(PHONE_LOCAL), [])
        self.assertEqual(self.api('GET', f'{CUSTOMERS}/{customer["id"]}').status_code, 404)
        # The sibling does not see it and may create its own customer with the same phone.
        own = self.created({'name': 'B customer', 'phone': PHONE_LOCAL})
        self.assertEqual(own['company']['id'], self.branch_b.id)

    def test_a_shared_phone_offers_every_customer_and_create_new_makes_another(self):
        self.sign_in('cu_a_staff')
        first = self.created({'name': 'Mother', 'phone': PHONE_LOCAL})
        conflict = self.create_customer({'name': 'Son', 'phone': PHONE_E164})
        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertEqual(conflict.json()['code'], 'conflict')
        self.assertEqual(conflict.json()['details'], {
            'candidates': [{'id': first['id'], 'name': 'Mother', 'phone_last4': '4567'}],
        })
        second = self.created({'name': 'Son', 'phone': PHONE_E164, 'create_new': True})
        again = self.create_customer({'name': 'Daughter', 'phone': PHONE_LOCAL})
        self.assertEqual(again.status_code, 409)
        self.assertEqual({item['id'] for item in again.json()['details']['candidates']}, {first['id'], second['id']})
        third = self.created({'name': 'Daughter', 'phone': PHONE_LOCAL, 'create_new': True})
        self.assertEqual(set(self.candidate_ids(PHONE_LOCAL)), {first['id'], second['id'], third['id']})

    def test_a_refused_create_writes_nothing(self):
        self.sign_in('cu_a_staff')
        self.created({'name': 'Existing', 'phone': PHONE_LOCAL})
        before = self.env['res.partner'].search_count([('liwan_party', '=', True)])
        self.assertEqual(self.create_customer({'name': 'Duplicate', 'phone': PHONE_LOCAL}).status_code, 409)
        self.assertEqual(self.env['res.partner'].search_count([('liwan_party', '=', True)]), before)

    def test_every_form_of_the_number_finds_the_same_customer(self):
        self.branch_b.country_id = self.env.ref('base.ae')
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'One number', 'phone': PHONE_LOCAL})
        self.sign_in('cu_b_staff')
        for form in (PHONE_LOCAL, '%2B966501234567', '966501234567', '٠٥٠١٢٣٤٥٦٧', '۰۵۰۱۲۳۴۵۶۷'):
            with self.subTest(form=form):
                self.assertEqual(self.candidate_ids(form), [customer['id']])

    def test_an_invalid_phone_is_refused(self):
        self.sign_in('cu_a_staff')
        for phone in ('12', 'not a phone', '+9990000'):
            with self.subTest(phone=phone):
                response = self.create_customer({'name': 'Bad phone', 'phone': phone})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual((response.json()['code'], response.json()['field']), ('invalid_phone', 'phone'))
        response = self.candidates('12')
        self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid_phone'))

    def test_the_wire_shape_and_the_list_filters(self):
        self.sign_in('cu_a_staff')
        company = self.created({'name': 'Trading house', 'is_company': True, 'email': 'house@example.test'})
        contact = self.created({'name': 'House contact', 'parent_id': company['id'], 'phone': '0551234567'})
        self.assertEqual(contact, {
            'id': contact['id'], 'name': 'House contact', 'phone': '+966551234567', 'email': None,
            'is_company': False, 'parent': {'id': company['id'], 'name': 'Trading house'}, 'active': True,
            'company': None, 'properties': [],
        })
        self.assertEqual(self.listed_ids('house@example'), [company['id']])
        self.assertEqual(self.listed_ids('0551234567'), [contact['id']])
        listing = self.api('GET', f'{CUSTOMERS}?limit=1&offset=0').json()
        self.assertEqual((len(listing['items']), listing['total']), (1, 2))
        archived = self.api('POST', f'{CUSTOMERS}/{contact["id"]}/archive')
        self.assertEqual(archived.json()['active'], False)
        self.assertEqual(self.listed_ids(), [company['id']])
        self.assertEqual(
            [item['id'] for item in self.api('GET', f'{CUSTOMERS}?archived=true').json()['items']], [contact['id']],
        )
        restored = self.api('POST', f'{CUSTOMERS}/{contact["id"]}/restore')
        self.assertEqual(restored.json()['active'], True)

    def test_a_parent_must_be_a_company_party(self):
        self.sign_in('cu_a_staff')
        person = self.created({'name': 'Person'})
        for parent_id in (person['id'], self.root_company.partner_id.id, self.a_staff.partner_id.id, NOT_FOUND):
            with self.subTest(parent_id=parent_id):
                response = self.create_customer({'name': 'Contact', 'parent_id': parent_id})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json()['field'], 'parent_id')

    def test_a_parent_must_share_the_customers_scope(self):
        branch_parent = self.env['res.partner'].create(
            {'name': 'Branch A company', 'is_company': True, 'liwan_party': True, 'company_id': self.branch_a.id},
        )
        shared_parent = self.env['res.partner'].create({'name': 'Shared company', 'is_company': True, 'liwan_party': True})
        self.sign_in('cu_a_staff')
        refused = self.create_customer({'name': 'Shared contact', 'parent_id': branch_parent.id})
        self.assertEqual((refused.status_code, refused.json()['field']), (422, 'parent_id'), refused.text)
        shared = self.created({'name': 'Shared contact', 'parent_id': shared_parent.id})
        moved = self.api('PATCH', f'{CUSTOMERS}/{shared["id"]}', {'parent_id': branch_parent.id})
        self.assertEqual((moved.status_code, moved.json()['field']), (422, 'parent_id'), moved.text)
        self.settings.sharing = 'branch'
        self.assertEqual(self.created({'name': 'Branch contact', 'parent_id': branch_parent.id})['parent']['id'], branch_parent.id)
        self.assertEqual(self.created({'name': 'Branch contact 2', 'parent_id': shared_parent.id})['parent']['id'], shared_parent.id)

    def test_a_customers_manager_without_finance_renames_a_party_with_a_bank_account(self):
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Banked customer'})
        bank = self.env['res.partner.bank'].create({
            'acc_number': 'SA0380000000608010167519', 'partner_id': customer['id'], 'acc_holder_name': 'Banked customer',
        })
        renamed = self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'name': 'Banked customer renamed'})
        self.assertEqual(renamed.status_code, 200, renamed.text)
        self.assertEqual(bank.acc_holder_name, 'Banked customer renamed')
        as_staff = bank.with_user(self.a_staff).with_company(self.branch_a)
        for vals in ({'acc_holder_name': 'Around the service'}, {'acc_number': 'SA4420000001234567891234'}):
            with self.subTest(vals=vals), self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
                as_staff.write(vals)
        with marked(self.env, {PARTY_MARKER: [customer['id']]}), self.assertRaises(AccessError):
            as_staff.write({'acc_number': 'SA4420000001234567891234'})

    def test_a_strict_payload(self):
        self.sign_in('cu_a_staff')
        for payload in ({}, {'name': ''}, {'name': 'X', 'vat': '1'}, {'name': 'X', 'is_company': 'yes'},
                        {'name': 'X', 'email': 'not-mail'}, {'name': 'X', 'create_new': 1}):
            with self.subTest(payload=payload):
                self.assertEqual(self.create_customer(payload).status_code, 422)
        customer = self.created({'name': 'Patched'})
        self.assertEqual(self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'create_new': True}).status_code, 422)
        patched = self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'name': 'Renamed', 'phone': PHONE_LOCAL})
        self.assertEqual((patched.json()['name'], patched.json()['phone']), ('Renamed', PHONE_E164))
        cleared = self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'phone': None})
        self.assertIsNone(cleared.json()['phone'])

    def test_a_system_administrator_edits_and_archives_through_the_routes(self):
        self.sign_in('wc_root_admin')
        customer = self.created({'name': 'Admin customer', 'phone': PHONE_LOCAL})
        patched = self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'name': 'Admin renamed', 'email': 'a@example.test'})
        self.assertEqual(patched.status_code, 200, patched.text)
        archived = self.api('POST', f'{CUSTOMERS}/{customer["id"]}/archive')
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False))

    def test_the_service_marker_never_covers_a_user_partner_for_an_administrator(self):
        partner = self.member.partner_id
        with marked(self.env, {PARTY_MARKER: partner.ids}), self.assertRaisesRegex(
                AccessError, 'use_protected_liwan_access_operation'):
            partner.with_user(self.root_admin).write({'phone': PHONE_E164})

    def test_each_route_refuses_a_caller_without_its_capability(self):
        customer = self.env['liwan.customers.service']._liwan_create({'name': 'Gated', 'phone': PHONE_LOCAL})
        detail = f'{CUSTOMERS}/{customer.id}'
        calls = (
            ('GET', CUSTOMERS, None), ('GET', detail, None), ('POST', CUSTOMERS, {'name': 'X'}),
            ('PATCH', detail, {'name': 'X'}), ('POST', f'{detail}/archive', None), ('POST', f'{detail}/restore', None),
            ('GET', SETTINGS, None), ('PATCH', SETTINGS, {'sharing': 'branch', 'revision': 1}),
            ('GET', EXPORT, None), ('GET', COUNTRIES, None), ('GET', f'{CANDIDATES}?phone={PHONE_LOCAL}', None),
        )
        self.sign_in('cu_nobody')
        for method, path, payload in calls:
            with self.subTest(method=method, path=path):
                response = self.api(method, path, payload)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)
        self.sign_in('cu_picker')
        for method, path, payload in calls[:-1]:
            with self.subTest(picker=path, method=method):
                self.assertEqual(self.api(method, path, payload).status_code, 403)

    def test_each_route_is_closed_without_a_registered_feature(self):
        self.patch(type(self.env['liwan.customers.service']), '_liwan_customers_feature_keys', lambda model: ())
        self.sign_in('wc_root_admin')
        for method, path in (('GET', CUSTOMERS), ('GET', f'{CUSTOMERS}/1'), ('POST', CUSTOMERS),
                             ('PATCH', f'{CUSTOMERS}/1'), ('POST', f'{CUSTOMERS}/1/archive'),
                             ('POST', f'{CUSTOMERS}/1/restore'), ('GET', SETTINGS), ('PATCH', SETTINGS),
                             ('GET', EXPORT), ('GET', COUNTRIES), ('GET', f'{CANDIDATES}?phone={PHONE_LOCAL}')):
            with self.subTest(method=method, path=path):
                response = self.api(method, path, {} if method != 'GET' else None)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))

    def test_a_pick_holder_gets_the_name_and_the_last_digits_only(self):
        customer = self.env['liwan.customers.service']._liwan_create({
            'name': 'Picked', 'phone': PHONE_LOCAL, 'email': 'picked@example.test',
        })
        self.sign_in('cu_picker')
        response = self.candidates(PHONE_LOCAL)
        self.assertEqual(response.json(), {'items': [{'id': customer.id, 'name': 'Picked', 'phone_last4': '4567'}], 'total': 1})
        self.assertEqual(self.api('GET', f'{CUSTOMERS}/{customer.id}').status_code, 403)

    def test_accounts_and_companies_are_never_customers(self):
        invitee = new_test_user(self.env, login='cu_invitee', groups='base.group_user')
        outsider = self.env['res.partner'].create({'name': 'Not a party'})
        for partner in (invitee.partner_id, self.root_company.partner_id, self.branch_a.partner_id, outsider):
            partner.phone = PHONE_E164
        customer = self.env['liwan.customers.service']._liwan_create({'name': 'Real customer', 'phone': PHONE_LOCAL})
        self.sign_in('cu_a_staff')
        self.assertEqual(self.candidate_ids(PHONE_LOCAL), [customer.id])
        self.assertEqual(self.listed_ids(), [customer.id])
        for partner in (invitee.partner_id, self.root_company.partner_id, outsider):
            with self.subTest(partner=partner.name):
                self.assertEqual(self.api('GET', f'{CUSTOMERS}/{partner.id}').status_code, 404)
                self.assertEqual(self.api('PATCH', f'{CUSTOMERS}/{partner.id}', {'name': 'X'}).status_code, 404)

    def test_settings_belong_to_the_root_company(self):
        self.sign_in('cu_a_settings')
        self.assertEqual(self.api('PATCH', SETTINGS, {'sharing': 'branch', 'revision': 1}).status_code, 403)
        self.sign_in('cu_root_settings')
        read = self.api('GET', SETTINGS).json()
        self.assertEqual(read, {
            'sharing': 'establishment', 'party_kinds': 'both', 'phone_country': None, 'fields': [],
            'field_limits': {'max_properties': 50, 'max_options': 100, 'max_label': 64},
            'can_manage': True, 'revision': read['revision'],
        })
        uae = self.env.ref('base.ae')
        changed = self.api('PATCH', SETTINGS, {'phone_country_id': uae.id, 'revision': read['revision']})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()['phone_country'], {'id': uae.id, 'code': 'AE', 'name': uae.name})
        self.assertEqual(changed.json()['revision'], read['revision'] + 1)
        stale = self.api('PATCH', SETTINGS, {'sharing': 'branch', 'revision': read['revision']})
        self.assertEqual((stale.status_code, stale.json()['code']), (409, 'conflict'))
        branch = self.api('PATCH', SETTINGS, {'sharing': 'branch', 'phone_country_id': None, 'revision': read['revision'] + 1})
        self.assertEqual(
            {key: branch.json()[key] for key in ('sharing', 'phone_country', 'revision')},
            {'sharing': 'branch', 'phone_country': None, 'revision': read['revision'] + 2},
        )
        for payload in ({'sharing': 'group', 'revision': 3}, {'revision': 3}, {'sharing': 'branch'},
                        {'sharing': 'branch', 'revision': 3, 'extra': 1}, {'phone_country_id': NOT_FOUND, 'revision': 3},
                        {'party_kinds': 'nobody', 'revision': 3}):
            with self.subTest(payload=payload):
                self.assertEqual(self.api('PATCH', SETTINGS, payload).status_code, 422)

    def test_changing_sharing_with_a_customer_present_is_refused(self):
        service = self.env['liwan.customers.service']
        house = service._liwan_create({'name': 'Archived house', 'is_company': True})
        contact = service._liwan_create({'name': 'Archived contact', 'parent_id': house.id})
        service._liwan_archive(contact)
        service._liwan_archive(house)
        self.sign_in('cu_root_settings')
        revision = self.settings.revision
        response = self.api('PATCH', SETTINGS, {'sharing': 'branch', 'revision': revision})
        self.assertEqual((response.status_code, response.json()['code']), (409, 'sharing_transfer_required'))
        self.assertEqual(self.settings.sharing, 'establishment')
        # The phone country is not the sharing: it changes while customers exist.
        country = self.api('PATCH', SETTINGS, {'phone_country_id': self.env.ref('base.sa').id, 'revision': revision})
        self.assertEqual(country.status_code, 200, country.text)

    def test_a_branch_customer_the_root_manager_cannot_read_still_blocks_a_sharing_change(self):
        self.settings.sharing = 'branch'
        customer = self.env['liwan.customers.service'].with_company(self.branch_a)._liwan_create({'name': 'Owned by A'})
        self.assertEqual(customer.company_id, self.branch_a)
        self.assertFalse(self.env['res.partner'].with_user(self.root_settings).search_count([('id', '=', customer.id)]))
        self.sign_in('cu_root_settings')
        response = self.api('PATCH', SETTINGS, {'sharing': 'establishment', 'revision': self.settings.revision})
        self.assertEqual((response.status_code, response.json()['code']), (409, 'sharing_transfer_required'))
        self.assertEqual(self.settings.sharing, 'branch')

    def test_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                set_probe_feature(self)
                self.sign_in('cu_a_staff')
                customer = self.created({'name': f'Mode {mode}', 'phone': PHONE_LOCAL, 'create_new': True})
                self.assertIn(customer['id'], self.listed_ids(f'Mode {mode}'))
                self.assertIn(customer['id'], self.candidate_ids(PHONE_LOCAL))
                self.assertEqual(self.api('POST', f'{CUSTOMERS}/{customer["id"]}/archive').status_code, 200)
                self.sign_in('cu_root_settings')
                self.assertEqual(self.api('GET', SETTINGS).status_code, 200)
                self.sign_in('cu_exporter')
                self.assertEqual(self.api('GET', EXPORT).status_code, 200)
