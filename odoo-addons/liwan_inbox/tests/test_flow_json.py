# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo.tests import BaseCase, tagged

from .flows_common import choice, form_body, text_input
from odoo.addons.liwan_inbox.models import flow_json


def structure(**overrides):
    """The plain-dict structure of form_body() as the model hands it to the generator (option keys generated)."""
    screens = []
    for screen in form_body()['screens']:
        fields = []
        for field in screen['fields']:
            options = [{'key': f'o{index}', **option} for index, option in enumerate(field.get('options', ()), start=1)]
            fields.append({**field, **({'options': options} if options else {})})
        screens.append({**screen, 'fields': fields})
    return {'screens': screens, **overrides}


def components(screen):
    return screen['layout']['children']


@tagged('standard', 'at_install', 'liwan')
class TestFlowJson(BaseCase):
    """The generator is a pure function of the rows: Meta's component names, limits, ids and routing."""

    def test_version_and_screen_ids(self):
        flow = flow_json.build(structure())
        self.assertEqual(flow['version'], '7.3')
        self.assertEqual([screen['id'] for screen in flow['screens']], ['SCREEN_A', 'SCREEN_B'])
        self.assertEqual(set(flow), {'version', 'screens'})

    def test_a_non_terminal_footer_navigates_with_an_empty_payload(self):
        first = flow_json.build(structure())['screens'][0]
        self.assertNotIn('terminal', first)
        self.assertEqual(components(first)[-1], {
            'type': 'Footer', 'label': 'Next',
            'on-click-action': {'name': 'navigate', 'next': {'type': 'screen', 'name': 'SCREEN_B'}, 'payload': {}},
        })

    def test_the_last_screen_completes_with_every_input_key_by_global_reference(self):
        last = flow_json.build(structure())['screens'][-1]
        self.assertEqual((last['terminal'], last['success']), (True, True))
        footer = components(last)[-1]
        self.assertEqual(footer['label'], 'Send')
        self.assertEqual(footer['on-click-action'], {'name': 'complete', 'payload': {
            'full_name': '${screen.SCREEN_A.form.full_name}', 'service': '${screen.SCREEN_A.form.service}',
            'day': '${screen.SCREEN_B.form.day}', 'extras': '${screen.SCREEN_B.form.extras}',
            'notes': '${screen.SCREEN_B.form.notes}', 'consent': '${screen.SCREEN_B.form.consent}',
        }})

    def test_sensitive_keys_are_listed_per_screen(self):
        first, last = flow_json.build(structure())['screens']
        self.assertNotIn('sensitive', first)
        self.assertEqual(last['sensitive'], ['notes'])

    def test_components_use_meta_names_and_attributes(self):
        first, last = (components(screen) for screen in flow_json.build(structure())['screens'])
        self.assertEqual(first[0], {'type': 'TextHeading', 'text': 'Book a visit'})
        self.assertEqual(first[1], {'type': 'TextInput', 'name': 'full_name', 'label': 'Name', 'required': True, 'input-type': 'text'})
        self.assertEqual(first[2], {
            'type': 'Dropdown', 'name': 'service', 'label': 'service', 'required': True,
            'data-source': [{'id': 'o1', 'title': 'Checkup'}, {'id': 'o2', 'title': 'Dental'}],
        })
        self.assertEqual(last[0], {'type': 'DatePicker', 'name': 'day', 'label': 'Day', 'required': True})
        self.assertEqual(last[1]['type'], 'CheckboxGroup')
        self.assertEqual(last[1]['max-selected-items'], 2)
        self.assertNotIn('min-selected-items', last[1])
        self.assertEqual(last[2], {'type': 'TextArea', 'name': 'notes', 'label': 'Notes', 'required': False})
        self.assertEqual(last[3], {'type': 'OptIn', 'name': 'consent', 'label': 'I agree', 'required': True})

    def test_optional_attributes_appear_only_when_set(self):
        screen = {'title': 'T', 'footer_label': 'Go', 'fields': [
            text_input('phone', input_type='phone', helper_text='With code', min_chars=5, max_chars=15),
            {'kind': 'text_area', 'key': 'about', 'label': 'About', 'required': False, 'sensitive': False, 'helper_text': 'Hi', 'max_length': 300},
            {'kind': 'date', 'key': 'when', 'label': 'When', 'required': True, 'sensitive': False, 'helper_text': None,
             'min_date': '2026-11-01', 'max_date': '2026-12-31'},
            {**choice('radio', 'pick', ['A']), 'options': [{'key': 'o1', 'title': 'A', 'description': 'First'}]},
            {'kind': 'subheading', 'text': 'Sub'}, {'kind': 'text', 'text': 'Body'}, {'kind': 'caption', 'text': 'Small'},
        ]}
        phone, about, when, pick, *texts = components(flow_json.build({'screens': [screen]})['screens'][0])
        self.assertEqual(phone['input-type'], 'phone')
        self.assertEqual((phone['helper-text'], phone['min-chars'], phone['max-chars']), ('With code', '5', '15'))
        self.assertEqual((about['helper-text'], about['max-length']), ('Hi', '300'))
        self.assertEqual((when['min-date'], when['max-date']), ('2026-11-01', '2026-12-31'))
        self.assertEqual(pick['type'], 'RadioButtonsGroup')
        self.assertEqual(pick['data-source'], [{'id': 'o1', 'title': 'A', 'description': 'First'}])
        self.assertEqual([item['type'] for item in texts[:3]], ['TextSubheading', 'TextBody', 'TextCaption'])

    def test_a_single_screen_form_completes_at_once(self):
        screen = structure()['screens'][0]
        built = flow_json.build({'screens': [screen]})['screens'][0]
        self.assertEqual(components(built)[-1]['on-click-action']['name'], 'complete')
        self.assertEqual(set(components(built)[-1]['on-click-action']['payload']), {'full_name', 'service'})

    def test_the_output_is_deterministic_and_hashed(self):
        first, second = flow_json.serialize(structure()), flow_json.serialize(structure())
        self.assertEqual(first, second)
        self.assertEqual(flow_json.digest(first), flow_json.digest(second))
        self.assertEqual(json.loads(first), flow_json.build(structure()))
        changed = structure()
        changed['screens'][0]['title'] = 'Other'
        self.assertNotEqual(flow_json.digest(flow_json.serialize(changed)), flow_json.digest(first))
        self.assertIn('"version":"7.3"', first)

    def test_arabic_text_is_written_as_it_is(self):
        changed = structure()
        changed['screens'][0]['title'] = 'البيانات'
        self.assertIn('البيانات', flow_json.serialize(changed))
