# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The settings read rule, the party kinds and the tenant's custom fields on customers."""
from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.liwan_customers.tests.common import (
    COUNTRIES,
    CUSTOMERS,
    SETTINGS,
    CustomersCase,
)

SEGMENT = {
    'label': 'Segment', 'type': 'selection',
    'options': [{'label': 'Gold'}, {'label': 'Silver'}],
}
VIP = {'label': 'VIP', 'type': 'boolean'}
NOTE = {'label': 'Note', 'type': 'char'}


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersSettingsRead(CustomersCase):

    def test_a_customers_reader_reads_the_settings_but_cannot_manage(self):
        self.sign_in('cu_a_staff')
        read = self.api('GET', SETTINGS)
        self.assertEqual(read.status_code, 200, read.text)
        self.assertEqual((read.json()['can_manage'], read.json()['party_kinds']), (False, 'both'))
        self.assertEqual(self.api('PATCH', SETTINGS, {'party_kinds': 'companies', 'revision': read.json()['revision']}).status_code, 403)

    def test_a_branch_only_settings_manager_reads_without_managing(self):
        self.sign_in('cu_a_settings')
        read = self.api('GET', SETTINGS)
        self.assertEqual(read.status_code, 200, read.text)
        self.assertFalse(read.json()['can_manage'])
        for payload in ({'party_kinds': 'companies'}, {'fields': [NOTE]}):
            with self.subTest(payload=payload):
                response = self.api('PATCH', SETTINGS, {**payload, 'revision': read.json()['revision']})
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        self.assertEqual(self.settings.party_kinds, 'both')

    def test_a_root_manager_can_manage_and_a_reader_of_nothing_cannot_read(self):
        self.sign_in('cu_root_settings')
        self.assertTrue(self.api('GET', SETTINGS).json()['can_manage'])
        self.sign_in('wc_root_admin')
        self.assertTrue(self.api('GET', SETTINGS).json()['can_manage'])
        self.sign_in('cu_nobody')
        self.assertEqual(self.api('GET', SETTINGS).status_code, 403)

    def test_the_party_kinds_setting_is_written_and_read(self):
        self.sign_in('cu_root_settings')
        changed = self.api('PATCH', SETTINGS, {'party_kinds': 'companies', 'revision': self.settings.revision})
        self.assertEqual((changed.status_code, changed.json()['party_kinds']), (200, 'companies'))
        self.assertEqual(self.settings.party_kinds, 'companies')


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersCountriesAndKindFilter(CustomersCase):

    def test_countries_are_listed_by_name_in_one_shape(self):
        self.sign_in('cu_a_settings')
        response = self.api('GET', COUNTRIES)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        countries = self.env['res.country'].search([('code', '!=', False)])
        self.assertEqual(body['total'], len(body['items']))
        self.assertEqual(body['total'], len(countries))
        self.assertTrue(all(set(item) == {'id', 'code', 'name'} and len(item['code']) == 2 for item in body['items']))
        self.assertEqual([item['id'] for item in body['items']], self.env['res.country'].search([('code', '!=', False)], order='name').ids)
        saudi = self.env.ref('base.sa')
        self.assertIn({'id': saudi.id, 'code': 'SA', 'name': saudi.name}, body['items'])
        # The settings answer the same shape for the chosen country.
        self.settings.phone_country_id = saudi
        self.assertEqual(self.api('GET', SETTINGS).json()['phone_country'], {'id': saudi.id, 'code': 'SA', 'name': saudi.name})

    def test_a_customers_reader_cannot_list_countries(self):
        self.sign_in('cu_a_staff')
        self.assertEqual(self.api('GET', COUNTRIES).status_code, 403)

    def test_the_list_filters_on_is_company_and_combines_with_the_search(self):
        service = self.env['liwan.customers.service']
        house = service._liwan_create({'name': 'Alpha House', 'is_company': True})
        person = service._liwan_create({'name': 'Alpha Person'})
        self.sign_in('cu_a_staff')
        self.assertEqual(set(self.listed_ids('')), {house.id, person.id})
        for value, expected in (('true', [house.id]), ('false', [person.id])):
            with self.subTest(value=value):
                self.assertEqual(self.ids_of(f'is_company={value}'), expected)
        self.assertEqual(self.ids_of('is_company=true&q=Person'), [])
        self.assertEqual(self.ids_of('is_company=true&q=Alpha'), [house.id])
        for value in ('yes', '1', ''):
            with self.subTest(invalid=value):
                response = self.api('GET', f'{CUSTOMERS}?is_company={value}')
                self.assertEqual((response.status_code, response.json()['field']), (422, 'is_company'))

    def ids_of(self, query):
        response = self.api('GET', f'{CUSTOMERS}?{query}')
        self.assertEqual(response.status_code, 200, response.text)
        return [item['id'] for item in response.json()['items']]


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersPartyKinds(CustomersCase):

    def test_party_kinds_decide_what_a_new_top_level_customer_may_be(self):
        cases = {
            'both': {'individual': 201, 'company': 201},
            'individuals': {'individual': 201, 'company': 422},
            'companies': {'individual': 422, 'company': 201},
        }
        self.sign_in('cu_a_staff')
        for kinds, expected in cases.items():
            self.settings.party_kinds = kinds
            for kind, status in expected.items():
                with self.subTest(kinds=kinds, kind=kind):
                    response = self.create_customer({'name': f'{kinds} {kind}', 'is_company': kind == 'company'})
                    self.assertEqual(response.status_code, status, response.text)
                    if status == 422:
                        body = response.json()
                        self.assertEqual((body['code'], body['field']), ('invalid', 'is_company'))
                        self.assertEqual(body['details'], {'reason': 'party_kind_not_allowed'})

    def test_an_omitted_is_company_is_an_individual(self):
        self.settings.party_kinds = 'companies'
        self.sign_in('cu_a_staff')
        self.assertEqual(self.create_customer({'name': 'No kind'}).status_code, 422)
        self.settings.party_kinds = 'individuals'
        self.assertEqual(self.create_customer({'name': 'No kind'}).status_code, 201)

    def test_a_contact_under_a_company_passes_in_every_mode(self):
        house = self.env['liwan.customers.service']._liwan_create({'name': 'House', 'is_company': True})
        self.sign_in('cu_a_staff')
        for kinds in ('both', 'individuals', 'companies'):
            self.settings.party_kinds = kinds
            with self.subTest(kinds=kinds):
                self.created({'name': f'Contact {kinds}', 'parent_id': house.id})

    def test_existing_customers_and_edits_are_not_checked(self):
        service = self.env['liwan.customers.service']
        person = service._liwan_create({'name': 'Existing person'})
        self.settings.party_kinds = 'companies'
        self.sign_in('cu_a_staff')
        self.assertEqual(self.api('GET', f'{CUSTOMERS}/{person.id}').status_code, 200)
        self.assertEqual(self.api('PATCH', f'{CUSTOMERS}/{person.id}', {'name': 'Renamed'}).status_code, 200)
        self.assertEqual(self.api('PATCH', f'{CUSTOMERS}/{person.id}', {'is_company': False}).status_code, 200)
        # An application creating a customer inside its own action goes through the service, unchecked.
        self.assertTrue(service._liwan_resolve(values={'name': 'From an application'}))

    def test_the_refusal_comes_before_the_phone_conflict(self):
        self.env['liwan.customers.service']._liwan_create({'name': 'Holder', 'phone': '0501234567'})
        self.settings.party_kinds = 'companies'
        self.sign_in('cu_a_staff')
        response = self.create_customer({'name': 'Same phone', 'phone': '0501234567'})
        self.assertEqual((response.status_code, response.json()['field']), (422, 'is_company'))


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersFields(CustomersCase):

    def test_a_settings_manager_who_is_not_an_administrator_saves_the_definition(self):
        self.assertFalse(self.root_settings.has_group('base.group_system'))
        fields = self.define_fields(SEGMENT, VIP)
        self.assertEqual([(item['label'], item['type']) for item in fields], [('Segment', 'selection'), ('VIP', 'boolean')])
        self.assertEqual(
            [item['label'] for item in fields[0]['options']], ['Gold', 'Silver'],
        )
        stored = self.env['res.partner']._liwan_party_properties_definition()
        self.assertEqual([item['name'] for item in stored], [item['key'] for item in fields])
        # A reader of customers reads the same definition with the settings.
        self.sign_in('cu_a_staff')
        self.assertEqual(self.api('GET', SETTINGS).json()['fields'], fields)

    def test_the_settings_manager_reaches_the_customer_fields_row_only(self):
        self.define_fields(NOTE)
        other = self.env['ir.model.fields'].search([('ttype', '=', 'properties'), ('model', '!=', 'res.partner')], limit=1)
        if not other:
            self.skipTest('no other properties field is installed')
        row = self.env['properties.base.definition'].sudo().create({'properties_field_id': other.id})
        partner_row = self.env['properties.base.definition'].sudo()._get_definition_for_property_field(
            'res.partner', 'properties',
        )
        manager = self.env['properties.base.definition'].with_user(self.root_settings).with_company(self.root_company)
        self.assertEqual(manager.search([('id', 'in', (row | partner_row).ids)]), partner_row)
        with self.assertRaises(AccessError):
            manager.browse(row.id).write({'properties_definition': [{'name': 'x', 'string': 'X', 'type': 'char'}]})
        with self.assertRaises(AccessError):
            manager.browse(row.id).read(['properties_definition'])
        # A customers reader reads the customer fields and cannot write them.
        reader = self.env['properties.base.definition'].with_user(self.a_staff).with_company(self.branch_a)
        self.assertEqual(reader.search([('id', 'in', (row | partner_row).ids)]), partner_row)
        with self.assertRaises(AccessError):
            reader.browse(partner_row.id).write({'properties_definition': []})

    def test_a_value_is_saved_returned_on_list_and_detail_changed_and_cleared(self):
        fields = self.define_fields(SEGMENT, VIP, NOTE)
        segment, vip, note = (item['key'] for item in fields)
        gold = fields[0]['options'][0]['key']
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'With fields', 'properties': {segment: gold, vip: True, note: 'Prefers calls'}})
        expected = {item['key']: item['value'] for item in customer['properties']}
        self.assertEqual(expected, {segment: gold, vip: True, note: 'Prefers calls'})
        self.assertEqual([item['label'] for item in customer['properties']], ['Segment', 'VIP', 'Note'])
        detail = self.api('GET', f'{CUSTOMERS}/{customer["id"]}').json()
        self.assertEqual(detail['properties'], customer['properties'])
        listed = next(item for item in self.api('GET', CUSTOMERS).json()['items'] if item['id'] == customer['id'])
        self.assertEqual(listed['properties'], customer['properties'])
        # A patch changes only the fields it names.
        patched = self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'properties': {note: 'Prefers messages'}})
        self.assertEqual(patched.status_code, 200, patched.text)
        values = {item['key']: item['value'] for item in patched.json()['properties']}
        self.assertEqual(values, {segment: gold, vip: True, note: 'Prefers messages'})
        cleared = self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'properties': {note: None, segment: None}})
        values = {item['key']: item['value'] for item in cleared.json()['properties']}
        self.assertEqual(values, {segment: None, vip: True, note: None})
        # A patch without properties leaves the values alone.
        renamed = self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'name': 'Renamed'})
        self.assertEqual({item['key']: item['value'] for item in renamed.json()['properties']}, values)

    def test_values_are_checked_against_the_definition(self):
        fields = self.define_fields(SEGMENT, NOTE)
        segment, note = fields[0]['key'], fields[1]['key']
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Checked'})
        for properties in ({'unknown': 'x'}, {segment: 'not an option'}, {note: 5}, 'text', ['x']):
            with self.subTest(properties=properties):
                for response in (
                    self.create_customer({'name': 'Bad', 'properties': properties}),
                    self.api('PATCH', f'{CUSTOMERS}/{customer["id"]}', {'properties': properties}),
                ):
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertTrue(response.json()['field'].startswith('properties'))

    def test_the_list_filters_on_a_custom_field(self):
        fields = self.define_fields(SEGMENT, VIP)
        segment, vip = fields[0]['key'], fields[1]['key']
        gold, silver = (option['key'] for option in fields[0]['options'])
        self.sign_in('cu_a_staff')
        first = self.created({'name': 'Gold vip', 'properties': {segment: gold, vip: True}})
        second = self.created({'name': 'Silver', 'properties': {segment: silver, vip: False}})
        self.created({'name': 'Nothing'})
        self.assertEqual(self.filtered_ids(f'property.{segment}={gold}'), [first['id']])
        self.assertEqual(self.filtered_ids(f'property.{segment}={silver}&q=Silver'), [second['id']])
        self.assertEqual(self.filtered_ids(f'property.{vip}=true'), [first['id']])
        for query in (f'property.{segment}=nothing', 'property.unknown=1'):
            with self.subTest(query=query):
                response = self.api('GET', f'{CUSTOMERS}?{query}')
                self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'))

    def filtered_ids(self, query):
        response = self.api('GET', f'{CUSTOMERS}?{query}')
        self.assertEqual(response.status_code, 200, response.text)
        return [item['id'] for item in response.json()['items']]

    def test_removing_a_field_with_values_asks_first_and_changes_nothing(self):
        fields = self.define_fields(SEGMENT, NOTE, VIP, {'label': 'Score', 'type': 'integer'})
        segment, note, vip, score = (item['key'] for item in fields)
        gold = fields[0]['options'][0]['key']
        self.sign_in('cu_a_staff')
        first = self.created({'name': 'One', 'properties': {segment: gold, note: 'Keep me'}})
        second = self.created({'name': 'Two', 'properties': {note: 'Me too', vip: True}})
        self.api('POST', f'{CUSTOMERS}/{second["id"]}/archive')
        revision = self.settings.revision
        keep = [fields[0], fields[2], fields[3]]
        self.sign_in('cu_root_settings')
        refused = self.api('PATCH', SETTINGS, {'fields': keep, 'revision': revision})
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'custom_field_values_exist'), refused.text)
        self.assertEqual(refused.json()['details'], {'fields': [{'key': note, 'label': 'Note', 'count': 2}]})
        self.assertEqual(self.settings.revision, revision)
        self.assertEqual(
            [item['name'] for item in self.env['res.partner']._liwan_party_properties_definition()],
            [segment, note, vip, score],
        )
        self.assertEqual(self.stored_properties(first['id']).get(note), 'Keep me')
        # A field with no value goes without a question; the confirmation removes the others with their values.
        self.assertEqual(self.api('PATCH', SETTINGS, {'fields': fields[:3], 'revision': revision}).status_code, 200)
        confirmed = self.api('PATCH', SETTINGS, {
            'fields': [fields[0]], 'confirm_field_removal': True, 'revision': revision + 1,
        })
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual([item['key'] for item in confirmed.json()['fields']], [segment])
        self.assertEqual(self.stored_properties(first['id']), {segment: gold})
        self.assertNotIn(note, self.stored_properties(second['id']))
        self.assertNotIn(vip, self.stored_properties(second['id']))
        self.sign_in('cu_a_staff')
        self.assertEqual([item['key'] for item in self.api('GET', f'{CUSTOMERS}/{first["id"]}').json()['properties']], [segment])

    def stored_properties(self, partner_id):
        """The JSON the column holds, whatever the definition says."""
        self.env.flush_all()
        self.env.cr.execute('SELECT properties FROM res_partner WHERE id = %s', [partner_id])
        return self.env.cr.fetchone()[0] or {}

    def test_the_count_includes_parties_the_root_manager_cannot_read(self):
        fields = self.define_fields(NOTE)
        note = fields[0]['key']
        self.settings.sharing = 'branch'
        self.sign_in('cu_a_staff')
        owned = self.created({'name': 'Owned by A', 'properties': {note: 'Hidden from root'}})
        self.assertEqual(owned['company']['id'], self.branch_a.id)
        self.assertFalse(self.env['res.partner'].with_user(self.root_settings).search_count([('id', '=', owned['id'])]))
        self.sign_in('cu_root_settings')
        refused = self.api('PATCH', SETTINGS, {'fields': [], 'revision': self.settings.revision})
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertEqual(refused.json()['details']['fields'][0]['count'], 1)
        confirmed = self.api('PATCH', SETTINGS, {
            'fields': [], 'confirm_field_removal': True, 'revision': self.settings.revision,
        })
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(self.stored_properties(owned['id']), {})

    def test_a_confirmation_needs_a_definition_and_is_only_true(self):
        self.define_fields(NOTE)
        self.sign_in('cu_root_settings')
        revision = self.settings.revision
        for payload in ({'confirm_field_removal': True}, {'party_kinds': 'both', 'confirm_field_removal': True},
                        {'fields': [], 'confirm_field_removal': False}, {'fields': [], 'confirm_field_removal': 1}):
            with self.subTest(payload=payload):
                response = self.api('PATCH', SETTINGS, {**payload, 'revision': revision})
                self.assertEqual((response.status_code, response.json()['field']), (422, 'confirm_field_removal'))

    def test_a_definition_is_validated_against_the_current_one(self):
        fields = self.define_fields(NOTE)
        self.sign_in('cu_root_settings')
        revision = self.settings.revision
        for item in ({**NOTE, 'key': 'invented'}, {'label': 'X', 'type': 'many2one'}, {**fields[0], 'type': 'integer'},
                     {'label': '', 'type': 'char'}):
            with self.subTest(item=item):
                response = self.api('PATCH', SETTINGS, {'fields': [item], 'revision': revision})
                self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.settings.revision, revision)

    def test_a_users_partner_and_a_companys_partner_never_get_custom_field_values(self):
        fields = self.define_fields(NOTE)
        note = fields[0]['key']
        outsider = self.env['res.partner'].create({'name': 'Not a party'})
        partners = (self.a_staff.partner_id, self.root_company.partner_id, outsider)
        self.sign_in('cu_a_staff')
        for partner in partners:
            with self.subTest(partner=partner.name):
                self.assertEqual(self.api('GET', f'{CUSTOMERS}/{partner.id}').status_code, 404)
                response = self.api('PATCH', f'{CUSTOMERS}/{partner.id}', {'properties': {note: 'x'}})
                self.assertEqual(response.status_code, 404)
                self.assertFalse(self.stored_properties(partner.id).get(note))
        self.assertTrue(all(item['id'] not in {partner.id for partner in partners} for item in self.api('GET', CUSTOMERS).json()['items']))

    def test_a_value_cannot_be_written_around_the_service(self):
        fields = self.define_fields(NOTE)
        customer = self.env['liwan.customers.service']._liwan_create({'name': 'Guarded'})
        with self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
            customer.with_user(self.a_staff).with_company(self.branch_a).write({'properties': {fields[0]['key']: 'x'}})

    def test_both_commercial_modes(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                fields = self.define_fields(NOTE)
                self.sign_in('cu_a_staff')
                customer = self.created({'name': f'Mode {mode}', 'properties': {fields[0]['key']: mode}})
                self.assertEqual(customer['properties'][0]['value'], mode)
                self.assertFalse(self.api('GET', SETTINGS).json()['can_manage'])
                self.assertEqual(self.create_customer({'name': 'Kind', 'is_company': True}).status_code, 201)


DATE = {'label': 'Since', 'type': 'date'}
DATETIME = {'label': 'Seen', 'type': 'datetime'}
TOPICS = {'label': 'Topics', 'type': 'tags', 'options': [{'label': 'Alpha'}, {'label': 'Beta'}]}
COUNT = {'label': 'Count', 'type': 'integer'}


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersFieldValues(CustomersCase):

    def values_of(self, response):
        self.assertEqual(response.status_code, 200, response.text)
        return {item['key']: item['value'] for item in response.json()['properties']}

    def test_date_datetime_and_tags_survive_a_patch_of_another_field_and_clear_with_null(self):
        fields = self.define_fields(DATE, DATETIME, TOPICS, NOTE)
        since, seen, topics, note = (item['key'] for item in fields)
        alpha = fields[2]['options'][0]['key']
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Dated', 'properties': {
            since: '2026-03-04', seen: '2026-03-04T10:30:00Z', topics: [alpha], note: 'first',
        }})
        before = {item['key']: item['value'] for item in customer['properties']}
        self.assertEqual((before[since], before[topics]), ('2026-03-04', [alpha]))
        self.assertIsNotNone(before[seen])
        url = f'{CUSTOMERS}/{customer["id"]}'
        after = self.values_of(self.api('PATCH', url, {'properties': {note: 'second'}}))
        self.assertEqual(after, {**before, note: 'second'})
        for key, empty in ((since, None), (seen, None), (topics, [])):
            with self.subTest(key=key):
                self.assertEqual(self.values_of(self.api('PATCH', url, {'properties': {key: None}}))[key], empty)
        # Set again after clearing.
        again = self.values_of(self.api('PATCH', url, {'properties': {since: '2027-01-02', topics: [alpha]}}))
        self.assertEqual((again[since], again[topics]), ('2027-01-02', [alpha]))

    def test_a_confirmation_with_nothing_to_remove_succeeds(self):
        fields = self.define_fields(NOTE, VIP)
        self.sign_in('cu_root_settings')
        response = self.api('PATCH', SETTINGS, {
            'fields': [fields[0]], 'confirm_field_removal': True, 'revision': self.settings.revision,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([item['key'] for item in response.json()['fields']], [fields[0]['key']])

    def test_a_stale_revision_with_a_confirmation_conflicts_and_changes_nothing(self):
        fields = self.define_fields(NOTE, VIP)
        note = fields[0]['key']
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Kept', 'properties': {note: 'still here'}})
        self.sign_in('cu_root_settings')
        stale = self.settings.revision - 1
        response = self.api('PATCH', SETTINGS, {'fields': [], 'confirm_field_removal': True, 'revision': stale})
        self.assertEqual((response.status_code, response.json()['code']), (409, 'conflict'))
        self.assertEqual(len(self.env['res.partner']._liwan_party_properties_definition()), 2)
        self.assertEqual(self.env['res.partner'].browse(customer['id']).properties[note], 'still here')

    def test_a_removed_zero_is_a_value_that_is_counted_and_cleared(self):
        fields = self.define_fields(COUNT, NOTE)
        count = fields[0]['key']
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Zero', 'properties': {count: 0}})
        self.assertEqual(self.stored_properties(customer['id']).get(count), 0)
        self.sign_in('cu_root_settings')
        refused = self.api('PATCH', SETTINGS, {'fields': [fields[1]], 'revision': self.settings.revision})
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'custom_field_values_exist'))
        self.assertEqual(refused.json()['details'], {'fields': [{'key': count, 'label': 'Count', 'count': 1}]})
        confirmed = self.api('PATCH', SETTINGS, {
            'fields': [fields[1]], 'confirm_field_removal': True, 'revision': self.settings.revision,
        })
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertNotIn(count, self.stored_properties(customer['id']))

    def test_removing_an_option_clears_it_from_the_parties_that_hold_it(self):
        fields = self.define_fields(SEGMENT)
        segment = fields[0]['key']
        gold, silver = fields[0]['options']
        self.sign_in('cu_a_staff')
        golden = self.created({'name': 'Gold one', 'properties': {segment: gold['key']}})
        silvery = self.created({'name': 'Silver one', 'properties': {segment: silver['key']}})
        self.sign_in('cu_root_settings')
        changed = self.api('PATCH', SETTINGS, {
            'fields': [{**fields[0], 'options': [silver]}], 'revision': self.settings.revision,
        })
        # An option is not a field: no confirmation is asked, and what the API can no longer read is not kept.
        self.assertEqual(changed.status_code, 200, changed.text)
        self.sign_in('cu_a_staff')
        detail = self.api('GET', f'{CUSTOMERS}/{golden["id"]}').json()
        self.assertEqual([option['key'] for option in detail['properties'][0]['options']], [silver['key']])
        self.assertIsNone(detail['properties'][0]['value'])
        self.assertFalse(self.stored_properties(golden['id']).get(segment))
        self.assertEqual(self.stored_properties(silvery['id']).get(segment), silver['key'])

    def test_removing_a_tag_option_keeps_the_other_tags_of_a_party(self):
        fields = self.define_fields(TOPICS)
        topics = fields[0]['key']
        first, second = fields[0]['options'][:2]
        self.sign_in('cu_a_staff')
        customer = self.created({'name': 'Tagged', 'properties': {topics: [first['key'], second['key']]}})
        self.sign_in('cu_root_settings')
        kept = [option for option in fields[0]['options'] if option['key'] != first['key']]
        changed = self.api('PATCH', SETTINGS, {
            'fields': [{**fields[0], 'options': kept}], 'revision': self.settings.revision,
        })
        self.assertEqual(changed.status_code, 200, changed.text)
        self.sign_in('cu_a_staff')
        detail = self.api('GET', f'{CUSTOMERS}/{customer["id"]}').json()
        self.assertEqual(detail['properties'][0]['value'], [second['key']])
        self.assertEqual(self.stored_properties(customer['id']).get(topics), [second['key']])

    def stored_properties(self, partner_id):
        self.env.flush_all()
        self.env.cr.execute('SELECT properties FROM res_partner WHERE id = %s', [partner_id])
        return self.env.cr.fetchone()[0] or {}

    def test_a_settings_manager_outside_the_internal_group_reaches_the_customer_row_only(self):
        self.define_fields(NOTE)
        manage = self.env.ref('liwan_customers.group_cap_customers_settings_manage')
        user = self.env['res.users'].with_context(no_reset_password=True).create({
            'name': 'Outside', 'login': 'cu_outside', 'group_ids': [(6, 0, [manage.id])],
        })
        self.assertFalse(user.has_group('base.group_user'))
        other = self.env['ir.model.fields'].search([('ttype', '=', 'properties'), ('model', '!=', 'res.partner')], limit=1)
        if not other:
            self.skipTest('no other properties field is installed')
        row = self.env['properties.base.definition'].sudo().create({'properties_field_id': other.id})
        partner_row = self.env['properties.base.definition'].sudo()._get_definition_for_property_field(
            'res.partner', 'properties',
        )
        model = self.env['properties.base.definition'].with_user(user)
        self.assertEqual(model.search([('id', 'in', (row | partner_row).ids)]), partner_row)
        with self.assertRaises(AccessError):
            model.browse(row.id).write({'properties_definition': []})
        model.browse(partner_row.id).write({'properties_definition': []})
