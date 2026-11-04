# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Company-level custom fields (Odoo ``fields.Properties``) on CRM opportunities."""
import csv
import io

from odoo.tests import new_test_user, tagged

from .common import LiwanCrmCase
from odoo.addons.liwan_crm.serializers.export import _safe

SETTINGS_URL = '/api/v1/crm/settings'
LEADS_URL = '/api/v1/crm/opportunities'
EXPORT_URL = '/api/v1/crm/export'

# A fixed engine definition (known keys), for the tests that are not about key generation.
DEFINITION = [
    {'name': 'note', 'string': 'Note', 'type': 'char'},
    {'name': 'score', 'string': 'Score', 'type': 'integer'},
    {'name': 'tier', 'string': 'Tier', 'type': 'selection', 'selection': [['gold', 'Gold'], ['silver', 'Silver']]},
    {'name': 'topics', 'string': 'Topics', 'type': 'tags',
     'tags': [['a', 'Alpha', 0], ['b', 'Beta', 0], ['c', 'Gamma', 0]]},
    {'name': 'vip', 'string': 'VIP', 'type': 'boolean'},
]


def _item(key, label, type_, **extra):
    return {'key': key, 'label': label, 'type': type_, **extra}


@tagged('post_install', '-at_install', 'liwan')
class TestCrmProperties(LiwanCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company_b = cls.other_company
        cls.manager_b = new_test_user(
            cls.env, login='crm_manager_b', password='crm_manager_b_pass_123', name='CRM Manager B',
            groups='liwan_core.group_employee', company_id=cls.company_b.id,
        )
        cls.manager_b.company_ids = [(6, 0, [cls.company_b.id])]
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.manager_b, [{
            'role_id': cls.env.ref('liwan_crm.role_crm_manager').id, 'company_id': cls.company_b.id,
        }])
        cls.reader = cls.custom_user('crm_settings_reader', ['crm.settings.read'])

    # Helpers

    def define(self, items=DEFINITION, company=None):
        (company or self.company).write({'liwan_lead_properties_definition': items})

    def lead_with(self, user, values, **vals):
        lead = self.make_lead(user, **vals)
        lead.lead_properties = values
        return lead

    def settings(self):
        response = self.api('GET', SETTINGS_URL)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def patch_definition(self, revision, items):
        return self.api('PATCH', SETTINGS_URL, {'revision': revision, 'values': {'lead_properties': items}})

    def stored_definition(self, company=None):
        self.env.invalidate_all()
        return (company or self.company).liwan_lead_properties_definition or []

    def detail(self, lead):
        response = self.api('GET', f'{LEADS_URL}/{lead.id}')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def patch_lead(self, lead, properties):
        return self.api('PATCH', f'{LEADS_URL}/{lead.id}', {'properties': properties})

    def listed_ids(self, query, user=None):
        if user:
            self.as_user(user)
        response = self.api('GET', f'{LEADS_URL}?limit=200&{query}')
        self.assertEqual(response.status_code, 200, response.text)
        return {item['id'] for item in response.json()['items']}

    def assert_invalid(self, response, field):
        self.assertEqual(response.status_code, 422, response.text)
        body = response.json()
        self.assertEqual(body['code'], 'invalid')
        self.assertEqual(body['field'], field)

    # Settings

    def test_settings_round_trip_generates_keys_and_keeps_them_on_rename(self):
        self.as_manager()
        empty = self.settings()
        self.assertEqual(empty['values']['lead_properties'], [])
        self.assertEqual(empty['revision'], 0)
        self.assertEqual(empty['options']['property_types'], [
            'char', 'text', 'integer', 'float', 'boolean', 'date', 'datetime', 'selection', 'tags',
        ])
        self.assertEqual(empty['options']['property_limits'], {
            'max_properties': 50, 'max_options': 100, 'max_label': 64,
        })

        created = self.patch_definition(0, [
            {'label': 'Budget note', 'type': 'char'},
            {'label': 'Tier', 'type': 'selection', 'options': [{'label': 'Gold'}, {'label': 'Silver'}]},
            {'label': 'Interests', 'type': 'tags', 'options': [{'label': 'Cars'}, {'label': 'Boats'}]},
            {'label': 'VIP', 'type': 'boolean'},
        ])
        self.assertEqual(created.status_code, 200, created.text)
        body = created.json()
        self.assertEqual(body['revision'], 1)
        note, tier, interests, vip = body['values']['lead_properties']
        self.assertEqual((note['label'], note['type']), ('Budget note', 'char'))
        self.assertNotIn('options', note)
        self.assertEqual((tier['label'], tier['type']), ('Tier', 'selection'))
        self.assertEqual([option['label'] for option in tier['options']], ['Gold', 'Silver'])
        self.assertEqual([option['label'] for option in interests['options']], ['Cars', 'Boats'])
        self.assertEqual((vip['label'], vip['type']), ('VIP', 'boolean'))
        keys = [item['key'] for item in (note, tier, interests, vip)]
        option_keys = [option['key'] for option in tier['options'] + interests['options']]
        self.assertTrue(all(isinstance(key, str) and key for key in keys + option_keys))
        self.assertEqual(len(set(keys)), 4)
        self.assertEqual(len(set(option_keys)), 4)
        self.assertEqual(self.settings()['values']['lead_properties'], body['values']['lead_properties'])
        self.assertEqual([item['name'] for item in self.stored_definition()], keys)

        gold, silver = tier['options']
        renamed = self.patch_definition(1, [
            _item(note['key'], 'Budget remark', 'char'),
            _item(tier['key'], 'Tier', 'selection', options=[
                {'key': gold['key'], 'label': 'Gold plan'}, {'key': silver['key'], 'label': 'Silver'},
                {'label': 'Bronze'},
            ]),
            _item(interests['key'], 'Interests', 'tags', options=interests['options']),
            _item(vip['key'], 'VIP', 'boolean'),
        ])
        self.assertEqual(renamed.status_code, 200, renamed.text)
        again = renamed.json()
        self.assertEqual(again['revision'], 2)
        note2, tier2, interests2, vip2 = again['values']['lead_properties']
        self.assertEqual([item['key'] for item in (note2, tier2, interests2, vip2)], keys)
        self.assertEqual(note2['label'], 'Budget remark')
        self.assertEqual(tier2['options'][:2], [
            {'key': gold['key'], 'label': 'Gold plan'}, {'key': silver['key'], 'label': 'Silver'},
        ])
        self.assertEqual(tier2['options'][2]['label'], 'Bronze')
        self.assertNotIn(tier2['options'][2]['key'], option_keys)
        self.assertEqual(interests2['options'], interests['options'])

    def test_definition_changes_that_would_reinterpret_values_are_422(self):
        self.as_manager()
        created = self.patch_definition(0, [
            {'label': 'Budget note', 'type': 'char'}, {'label': 'Tier', 'type': 'selection', 'options': [{'label': 'Gold'}]},
        ]).json()
        note, tier = created['values']['lead_properties']
        before = self.settings()
        self.assert_invalid(
            self.patch_definition(1, [_item(note['key'], 'Budget note', 'integer'), tier]),
            'lead_properties[0].type',
        )
        self.assert_invalid(
            self.patch_definition(1, [{'label': 'Budget note', 'type': 'char', 'options': [{'label': 'x'}]}]),
            'lead_properties[0].options',
        )
        self.assert_invalid(
            self.patch_definition(1, [{'label': 'Tier', 'type': 'selection', 'options': []}]),
            'lead_properties[0].options',
        )
        self.assert_invalid(
            self.patch_definition(1, [_item('nonexistent', 'Ghost', 'char')]), 'lead_properties[0].key',
        )
        self.assert_invalid(
            self.patch_definition(1, [{'label': 'Odd', 'type': 'money'}]), 'lead_properties[0].type',
        )
        self.assertEqual(self.settings(), before)

    def test_reader_without_manage_cannot_patch_and_stale_revision_is_409(self):
        self.as_manager()
        created = self.patch_definition(0, [{'label': 'Note', 'type': 'char'}])
        self.assertEqual(created.status_code, 200, created.text)
        stored = self.stored_definition()

        self.as_user(self.reader)
        read = self.settings()
        self.assertEqual(len(read['values']['lead_properties']), 1)
        denied = self.patch_definition(1, [])
        self.assertEqual(denied.status_code, 403, denied.text)
        self.assertEqual(self.stored_definition(), stored)

        self.as_manager()
        stale = self.patch_definition(0, [])
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()['code'], 'conflict')
        self.assertEqual(self.stored_definition(), stored)
        self.assertEqual(self.settings()['revision'], 1)

    def test_preset_patch_leaves_lead_properties_untouched(self):
        self.as_manager()
        created = self.patch_definition(0, [{'label': 'Note', 'type': 'char'}]).json()
        preset = self.api('PATCH', SETTINGS_URL, {'revision': 1, 'preset': 'general'})
        self.assertEqual(preset.status_code, 200, preset.text)
        body = preset.json()
        self.assertEqual(body['revision'], 2)
        self.assertEqual(body['values']['preset'], 'general')
        self.assertEqual(body['values']['lead_properties'], created['values']['lead_properties'])
        self.assertEqual(len(self.stored_definition()), 1)

    def test_a_scalar_patch_without_lead_properties_keeps_the_definition(self):
        self.as_manager()
        created = self.patch_definition(0, [{'label': 'Note', 'type': 'char'}]).json()
        patched = self.api('PATCH', SETTINGS_URL, {'revision': 1, 'values': {'followup_attempts': 3}})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['values']['lead_properties'], created['values']['lead_properties'])

    # Company isolation

    def test_a_definition_belongs_to_its_company(self):
        self.as_manager()
        created = self.patch_definition(0, [{'label': 'Tier A', 'type': 'char'}])
        self.assertEqual(created.status_code, 200, created.text)
        key = created.json()['values']['lead_properties'][0]['key']
        lead_a = self.make_lead(self.manager, contact_name='Company A lead')
        lead_b = self.make_lead(self.manager_b, company=self.company_b, contact_name='Company B lead')

        self.as_user(self.manager_b)
        self.assertEqual(self.settings()['values']['lead_properties'], [])
        self.assertEqual(self.detail(lead_b)['properties'], [])
        self.assertEqual(self.stored_definition(self.company_b), [])

        own = self.patch_definition(0, [{'label': 'Tier B', 'type': 'boolean'}])
        self.assertEqual(own.status_code, 200, own.text)
        self.assertEqual([item['label'] for item in self.detail(lead_b)['properties']], ['Tier B'])
        self.assertEqual([item['name'] for item in self.stored_definition(self.company_b)],
                         [own.json()['values']['lead_properties'][0]['key']])

        self.as_manager()
        self.assertEqual([item['key'] for item in self.settings()['values']['lead_properties']], [key])
        self.assertEqual([item['label'] for item in self.detail(lead_a)['properties']], ['Tier A'])
        self.assertEqual([item['name'] for item in lead_a.read(['lead_properties'])[0]['lead_properties']], [key])

    # Agent work on an opportunity

    def test_agent_reads_and_patches_one_key_while_the_others_keep_their_values(self):
        self.define()
        lead = self.lead_with(self.agent, {
            'note': 'hello', 'score': 3, 'tier': 'gold', 'topics': ['a', 'b'], 'vip': True,
        })
        self.as_agent()
        self.assertEqual(self.api('GET', SETTINGS_URL).status_code, 403)

        before = self.detail(lead)['properties']
        gold_silver = [{'key': 'gold', 'label': 'Gold'}, {'key': 'silver', 'label': 'Silver'}]
        topics = [{'key': 'a', 'label': 'Alpha'}, {'key': 'b', 'label': 'Beta'}, {'key': 'c', 'label': 'Gamma'}]
        self.assertEqual(before, [
            {'key': 'note', 'label': 'Note', 'type': 'char', 'value': 'hello'},
            {'key': 'score', 'label': 'Score', 'type': 'integer', 'value': 3},
            {'key': 'tier', 'label': 'Tier', 'type': 'selection', 'options': gold_silver, 'value': 'gold'},
            {'key': 'topics', 'label': 'Topics', 'type': 'tags', 'options': topics, 'value': ['a', 'b']},
            {'key': 'vip', 'label': 'VIP', 'type': 'boolean', 'value': True},
        ])

        patched = self.patch_lead(lead, {'tier': 'silver'})
        self.assertEqual(patched.status_code, 200, patched.text)
        after = {item['key']: item['value'] for item in patched.json()['properties']}
        self.assertEqual(after, {'note': 'hello', 'score': 3, 'tier': 'silver', 'topics': ['a', 'b'], 'vip': True})
        self.assertEqual({item['key']: item['value'] for item in self.detail(lead)['properties']}, after)

        cleared = self.patch_lead(lead, {'note': None, 'topics': None})
        self.assertEqual(cleared.status_code, 200, cleared.text)
        values = {item['key']: item['value'] for item in cleared.json()['properties']}
        self.assertEqual(values, {'note': None, 'score': 3, 'tier': 'silver', 'topics': [], 'vip': True})

    def test_date_and_datetime_values_round_trip(self):
        self.define([
            {'name': 'due', 'string': 'Due', 'type': 'date'},
            {'name': 'meet', 'string': 'Meet', 'type': 'datetime'},
        ])
        lead = self.lead_with(self.agent, {})
        self.as_agent()
        patched = self.patch_lead(lead, {'due': '2030-01-15', 'meet': '2030-01-15T10:00:00+03:00'})
        self.assertEqual(patched.status_code, 200, patched.text)
        values = {item['key']: item['value'] for item in self.detail(lead)['properties']}
        self.assertEqual(values['due'], '2030-01-15')
        self.assertTrue(values['meet'].startswith('2030-01-15T07:00:00'), values['meet'])

    def test_agent_property_errors_are_422_at_the_property_field(self):
        self.define()
        lead = self.lead_with(self.agent, {'note': 'keep', 'tier': 'gold'})
        self.as_agent()
        for properties, field in (
            ({'score': 'abc'}, 'properties.score'),
            ({'score': True}, 'properties.score'),
            ({'vip': 'yes'}, 'properties.vip'),
            ({'tier': 'platinum'}, 'properties.tier'),
            ({'topics': ['a', 'zzz']}, 'properties.topics'),
            ({'note': 5}, 'properties.note'),
            ({'nope': 'x'}, 'properties.nope'),
        ):
            with self.subTest(properties=properties):
                self.assert_invalid(self.patch_lead(lead, properties), field)
        self.assert_invalid(self.api('PATCH', f'{LEADS_URL}/{lead.id}', {'properties': ['note']}), 'properties')
        # A rejected body changes nothing, not even the valid keys beside the bad one.
        self.assert_invalid(self.patch_lead(lead, {'note': 'changed', 'score': 'abc'}), 'properties.score')
        values = {item['key']: item['value'] for item in self.detail(lead)['properties']}
        self.assertEqual(values['note'], 'keep')
        self.assertEqual(values['tier'], 'gold')

    def test_an_opportunity_the_agent_cannot_see_is_not_found(self):
        self.define()
        mate = self.lead_with(self.agent2, {'note': 'private'})
        self.as_agent()
        self.assertEqual(self.api('GET', f'{LEADS_URL}/{mate.id}').status_code, 404)
        self.assertEqual(self.patch_lead(mate, {'note': 'x'}).status_code, 404)
        self.env.invalidate_all()
        self.assertEqual(mate.lead_properties['note'], 'private')

    # Definition removal

    def test_a_removed_property_disappears_from_the_lead_dump(self):
        """Odoo's engine renders a record's values through the owning company's definition.

        Once a key leaves the definition the dump no longer carries it, whatever the lead
        stored for it; a key never comes back under the same name because the API generates a
        new key for every new property.
        """
        self.as_manager()
        created = self.patch_definition(0, [
            {'label': 'Note', 'type': 'char'}, {'label': 'VIP', 'type': 'boolean'},
        ]).json()
        note, vip = created['values']['lead_properties']
        lead = self.make_lead(self.agent, contact_name='Has note')
        stored = self.patch_lead(lead, {note['key']: 'remember', vip['key']: True})
        self.assertEqual(stored.status_code, 200, stored.text)
        self.assertEqual({item['key'] for item in self.detail(lead)['properties']}, {note['key'], vip['key']})

        removed = self.patch_definition(1, [vip])
        self.assertEqual(removed.status_code, 200, removed.text)
        shown = self.detail(lead)['properties']
        self.assertEqual([item['key'] for item in shown], [vip['key']])
        self.assertTrue(shown[0]['value'])
        self.assert_invalid(self.patch_lead(lead, {note['key']: 'again'}), f'properties.{note["key"]}')

    # List filters

    def _filter_leads(self):
        self.define()
        return (
            self.lead_with(self.agent, {'tier': 'gold', 'topics': ['a'], 'vip': True, 'note': 'x'}, contact_name='L1'),
            self.lead_with(self.agent, {'tier': 'silver', 'topics': ['a', 'b'], 'vip': False}, contact_name='L2'),
            self.lead_with(self.agent2, {'tier': 'gold', 'topics': ['c'], 'vip': False}, contact_name='L3'),
        )

    def test_list_filters_by_selection_boolean_and_tags(self):
        l1, l2, l3 = self._filter_leads()
        mine = {l1.id, l2.id, l3.id}
        self.as_manager()
        self.assertEqual(self.listed_ids('property.tier=gold') & mine, {l1.id, l3.id})
        self.assertEqual(self.listed_ids('property.tier=silver') & mine, {l2.id})
        self.assertEqual(self.listed_ids('property.vip=true') & mine, {l1.id})
        self.assertEqual(self.listed_ids('property.vip=false') & mine, {l2.id, l3.id})
        self.assertEqual(self.listed_ids('property.topics=a') & mine, {l1.id, l2.id})
        self.assertEqual(self.listed_ids('property.topics=c') & mine, {l3.id})
        self.assertEqual(self.listed_ids('property.tier=gold&property.vip=false') & mine, {l3.id})

    def test_a_filter_respects_the_callers_visibility(self):
        l1, l2, l3 = self._filter_leads()
        self.assertEqual(self.listed_ids('property.tier=gold', self.agent) & {l1.id, l2.id, l3.id}, {l1.id})

    def test_unfilterable_unknown_and_malformed_filters_are_422(self):
        self._filter_leads()
        self.as_manager()
        for query, field in (
            ('property.note=x', 'property.note'),
            ('property.score=3', 'property.score'),
            ('property.nope=1', 'property.nope'),
            ('property.tier=platinum', 'property.tier'),
            ('property.vip=maybe', 'property.vip'),
            ('property.topics=zzz', 'property.topics'),
        ):
            with self.subTest(query=query):
                self.assert_invalid(self.api('GET', f'{LEADS_URL}?{query}'), field)

    # Export

    def test_export_has_a_column_per_property_with_formula_safe_cells(self):
        self.define([
            {'name': 'note', 'string': '=Remark', 'type': 'char'},
            {'name': 'tier', 'string': 'Tier', 'type': 'selection', 'selection': [['gold', 'Gold'], ['silver', 'Silver']]},
            {'name': 'topics', 'string': 'Topics', 'type': 'tags', 'tags': [['a', 'Alpha', 0], ['b', 'Beta', 0]]},
            {'name': 'vip', 'string': 'VIP', 'type': 'boolean'},
            {'name': 'score', 'string': 'Score', 'type': 'integer'},
        ])
        full = self.lead_with(self.agent, {
            'note': '=HYPERLINK("http://x")', 'tier': 'gold', 'topics': ['a', 'b'], 'vip': True, 'score': -5,
        }, contact_name='Exported full')
        self.lead_with(self.agent, {'tier': 'silver'}, contact_name='Exported sparse')
        self.assertTrue(full.lead_properties)

        response = self.as_manager().api('GET', EXPORT_URL)
        self.assertEqual(response.status_code, 200, response.text)
        rows = list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))
        header = rows[0]
        self.assertEqual(header[9:], [_safe('=Remark'), 'Tier', 'Topics', 'VIP', 'Score'])
        self.assertFalse(header[9].startswith('='))
        by_name = {row[0]: row[9:] for row in rows[1:]}
        full_cells = by_name['Exported full']
        self.assertEqual(full_cells, [_safe('=HYPERLINK("http://x")'), 'Gold', 'Alpha, Beta', 'true', '-5'])
        self.assertFalse(full_cells[0].startswith('='))
        self.assertEqual(by_name['Exported sparse'], ['', 'Silver', '', 'false', ''])

    def test_export_applies_the_property_filters(self):
        self.define()
        self.lead_with(self.agent, {'tier': 'gold'}, contact_name='Export gold')
        self.lead_with(self.agent, {'tier': 'silver'}, contact_name='Export silver')
        self.as_manager()
        response = self.api('GET', f'{EXPORT_URL}?property.tier=gold')
        self.assertEqual(response.status_code, 200, response.text)
        rows = list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))
        names = {row[0] for row in rows[1:]}
        self.assertIn('Export gold', names)
        self.assertNotIn('Export silver', names)
        self.assert_invalid(self.api('GET', f'{EXPORT_URL}?property.note=x'), 'property.note')
