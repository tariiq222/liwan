# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime

from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers import properties as props


class _FakeRecord:
    """Stands in for a record: ``record.read([field])`` answers the engine's read format."""

    def __init__(self, field_name, items):
        self._field_name = field_name
        self._items = items

    def read(self, names):
        assert names == [self._field_name]
        return [{self._field_name: self._items}]


def _item(name, prop_type, **extra):
    return {'name': name, 'string': name.title(), 'type': prop_type, **extra}


def _select(name='sel'):
    return _item(name, 'selection', selection=[['a', 'A'], ['b', 'B']])


def _tags(name='tg'):
    return _item(name, 'tags', tags=[['x', 'X', 0], ['y', 'Y', 0]])


@tagged('post_install', '-at_install', 'liwan')
class TestPropertiesDefinition(TransactionCase):

    def assertInvalid(self, call, field):
        with self.assertRaises(ApiError) as caught:
            call()
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(caught.exception.field, field)
        return caught.exception

    def test_new_item_gets_a_server_key(self):
        parsed = props.parse_definition([{'label': ' Budget ', 'type': 'integer'}], 'properties', [])
        self.assertEqual(len(parsed), 1)
        self.assertRegex(parsed[0]['name'], r'^[0-9a-f]{16}\Z')
        self.assertEqual(parsed[0]['string'], 'Budget')
        self.assertEqual(parsed[0]['type'], 'integer')

    def test_existing_key_is_kept_and_order_preserved(self):
        current = [_item('k1', 'char'), _item('k2', 'integer')]
        parsed = props.parse_definition([
            {'key': 'k2', 'label': 'Two', 'type': 'integer'},
            {'label': 'New', 'type': 'boolean'},
            {'key': 'k1', 'label': 'One', 'type': 'char'},
        ], 'properties', current)
        self.assertEqual(parsed[0]['name'], 'k2')
        self.assertEqual(parsed[1]['type'], 'boolean')
        self.assertEqual(parsed[2]['name'], 'k1')
        self.assertEqual(parsed[2]['string'], 'One')

    def test_unknown_key_is_rejected(self):
        self.assertInvalid(
            lambda: props.parse_definition([{'key': 'nope', 'label': 'X', 'type': 'char'}], 'properties', []),
            'properties[0].key',
        )

    def test_non_string_key_is_rejected(self):
        self.assertInvalid(
            lambda: props.parse_definition([{'key': 5, 'label': 'X', 'type': 'char'}], 'properties', []),
            'properties[0].key',
        )

    def test_type_change_is_rejected(self):
        self.assertInvalid(
            lambda: props.parse_definition(
                [{'key': 'k1', 'label': 'X', 'type': 'integer'}], 'properties', [_item('k1', 'char')]),
            'properties[0].type',
        )

    def test_invalid_type_is_rejected(self):
        self.assertInvalid(
            lambda: props.parse_definition([{'label': 'X', 'type': 'monetary'}], 'properties', []),
            'properties[0].type',
        )

    def test_not_a_list_and_non_object_item(self):
        self.assertInvalid(lambda: props.parse_definition({}, 'properties', []), 'properties')
        self.assertInvalid(lambda: props.parse_definition(['x'], 'properties', []), 'properties[0]')

    def test_more_than_fifty_items_is_rejected(self):
        items = [{'label': f'P{i}', 'type': 'char'} for i in range(51)]
        self.assertInvalid(lambda: props.parse_definition(items, 'properties', []), 'properties')
        self.assertEqual(len(props.parse_definition(items[:50], 'properties', [])), 50)

    def test_label_must_be_one_to_sixty_four_characters(self):
        for label in ('', '   ', None, 5, 'x' * 65):
            self.assertInvalid(
                lambda label=label: props.parse_definition([{'label': label, 'type': 'char'}], 'properties', []),
                'properties[0].label',
            )
        parsed = props.parse_definition([{'label': 'x' * 64, 'type': 'char'}], 'properties', [])
        self.assertEqual(len(parsed[0]['string']), 64)

    def test_duplicate_keys_are_rejected(self):
        current = [_item('k1', 'char')]
        self.assertInvalid(
            lambda: props.parse_definition([
                {'key': 'k1', 'label': 'A', 'type': 'char'},
                {'key': 'k1', 'label': 'B', 'type': 'char'},
            ], 'properties', current),
            'properties[1].key',
        )

    def test_options_required_for_selection_and_tags(self):
        for prop_type in ('selection', 'tags'):
            for options in (None, [], 'x', [{'label': 'o'}] * 101):
                item = {'label': 'S', 'type': prop_type}
                if options is not None:
                    item['options'] = options
                self.assertInvalid(
                    lambda item=item: props.parse_definition([item], 'properties', []),
                    'properties[0].options',
                )

    def test_options_forbidden_for_other_types(self):
        self.assertInvalid(
            lambda: props.parse_definition(
                [{'label': 'S', 'type': 'char', 'options': [{'label': 'a'}]}], 'properties', []),
            'properties[0].options',
        )

    def test_one_hundred_options_are_accepted(self):
        options = [{'label': f'o{i}'} for i in range(100)]
        parsed = props.parse_definition([{'label': 'S', 'type': 'selection', 'options': options}], 'properties', [])
        self.assertEqual(len(parsed[0]['selection']), 100)

    def test_new_option_keys_are_generated(self):
        parsed = props.parse_definition(
            [{'label': 'S', 'type': 'selection', 'options': [{'label': 'One'}, {'label': 'Two'}]}],
            'properties', [])
        pairs = parsed[0]['selection']
        self.assertEqual([pair[1] for pair in pairs], ['One', 'Two'])
        for pair in pairs:
            self.assertRegex(pair[0], r'^[0-9a-f]{16}\Z')
        self.assertNotEqual(pairs[0][0], pairs[1][0])

    def test_existing_option_key_is_kept_and_unknown_rejected(self):
        current = [_select('k1')]
        parsed = props.parse_definition(
            [{'key': 'k1', 'label': 'S', 'type': 'selection', 'options': [{'key': 'b', 'label': 'Bee'}]}],
            'properties', current)
        self.assertEqual(parsed[0]['selection'], [['b', 'Bee']])
        self.assertInvalid(
            lambda: props.parse_definition(
                [{'key': 'k1', 'label': 'S', 'type': 'selection', 'options': [{'key': 'zz', 'label': 'Z'}]}],
                'properties', current),
            'properties[0].options[0].key',
        )

    def test_duplicate_option_keys_are_rejected(self):
        current = [_select('k1')]
        self.assertInvalid(
            lambda: props.parse_definition(
                [{'key': 'k1', 'label': 'S', 'type': 'selection',
                  'options': [{'key': 'a', 'label': 'A'}, {'key': 'a', 'label': 'A2'}]}],
                'properties', current),
            'properties[0].options[1].key',
        )

    def test_option_label_and_shape_are_validated(self):
        self.assertInvalid(
            lambda: props.parse_definition(
                [{'label': 'S', 'type': 'selection', 'options': [{'label': ''}]}], 'properties', []),
            'properties[0].options[0].label',
        )
        self.assertInvalid(
            lambda: props.parse_definition(
                [{'label': 'S', 'type': 'selection', 'options': ['x']}], 'properties', []),
            'properties[0].options[0]',
        )

    def test_tags_options_are_stored_as_key_label_zero(self):
        parsed = props.parse_definition(
            [{'label': 'T', 'type': 'tags', 'options': [{'label': 'One'}]}], 'properties', [])
        key, label, color = parsed[0]['tags'][0]
        self.assertRegex(key, r'^[0-9a-f]{16}\Z')
        self.assertEqual((label, color), ('One', 0))


@tagged('post_install', '-at_install', 'liwan')
class TestPropertiesValues(TransactionCase):

    def assertInvalid(self, call, field):
        with self.assertRaises(ApiError) as caught:
            call()
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(caught.exception.field, field)

    def _parse(self, prop_type, raw, **extra):
        definition = [_item('k', prop_type, **extra)]
        return props.parse_values({'k': raw}, definition)['k']

    def _reject(self, prop_type, raw, **extra):
        definition = [_item('k', prop_type, **extra)]
        self.assertInvalid(lambda: props.parse_values({'k': raw}, definition), 'properties.k')

    def test_non_object_and_unknown_key(self):
        self.assertInvalid(lambda: props.parse_values([], [_item('k', 'char')]), 'properties')
        self.assertInvalid(lambda: props.parse_values({'zz': 1}, [_item('k', 'char')]), 'properties.zz')

    def test_custom_field_name_prefix(self):
        self.assertInvalid(lambda: props.parse_values({'zz': 1}, [], field='custom'), 'custom.zz')

    def test_char_and_text_limits(self):
        self.assertEqual(self._parse('char', 'x' * 255), 'x' * 255)
        self._reject('char', 'x' * 256)
        self._reject('char', 5)
        self.assertEqual(self._parse('text', 'x' * 5000), 'x' * 5000)
        self._reject('text', 'x' * 5001)

    def test_empty_text_is_cleared(self):
        self.assertIsNone(self._parse('char', ''))
        self.assertIsNone(self._parse('text', ''))

    def test_integer(self):
        self.assertEqual(self._parse('integer', 7), 7)
        self._reject('integer', 7.5)
        self._reject('integer', True)
        self._reject('integer', '7')

    def test_float(self):
        self.assertEqual(self._parse('float', 3), 3.0)
        self.assertIsInstance(self._parse('float', 3), float)
        self.assertEqual(self._parse('float', 2.5), 2.5)
        self._reject('float', True)
        self._reject('float', '1.5')

    def test_boolean_is_strict(self):
        self.assertIs(self._parse('boolean', True), True)
        self.assertIs(self._parse('boolean', False), False)
        self._reject('boolean', 1)
        self._reject('boolean', 'true')

    def test_date(self):
        self.assertEqual(self._parse('date', '2030-01-15'), '2030-01-15')
        self._reject('date', '2030-1-5')
        self._reject('date', '2030-02-30')
        self._reject('date', '2030-01-15T00:00:00')
        self._reject('date', 20300115)

    def test_datetime_iso_is_converted_to_naive_utc(self):
        self.assertEqual(
            self._parse('datetime', '2030-01-15T10:00:00Z'), datetime.datetime(2030, 1, 15, 10, 0))
        self.assertEqual(
            self._parse('datetime', '2030-01-15T10:00:00+03:00'), datetime.datetime(2030, 1, 15, 7, 0))
        self.assertEqual(
            self._parse('datetime', '2030-01-15T10:00:00'), datetime.datetime(2030, 1, 15, 10, 0))
        self._reject('datetime', 'not a date')
        self._reject('datetime', 5)

    def test_selection(self):
        self.assertEqual(self._parse('selection', 'a', selection=[['a', 'A']]), 'a')
        self._reject('selection', 'zz', selection=[['a', 'A']])
        self._reject('selection', 1, selection=[['a', 'A']])

    def test_tags_dedupe_and_validate(self):
        tags = [['x', 'X', 0], ['y', 'Y', 0]]
        self.assertEqual(self._parse('tags', ['y', 'x', 'y'], tags=tags), ['y', 'x'])
        self._reject('tags', ['zz'], tags=tags)
        self._reject('tags', 'x', tags=tags)
        self._reject('tags', [1], tags=tags)

    def test_null_clears(self):
        for prop_type, extra in (
            ('char', {}), ('text', {}), ('integer', {}), ('float', {}), ('boolean', {}),
            ('date', {}), ('datetime', {}), ('selection', {'selection': [['a', 'A']]}),
        ):
            self.assertIsNone(self._parse(prop_type, None, **extra), prop_type)

    def test_tags_null_becomes_empty_list(self):
        self.assertEqual(self._parse('tags', None, tags=[['x', 'X', 0]]), [])


@tagged('post_install', '-at_install', 'liwan')
class TestPropertiesDump(TransactionCase):

    def test_dump_definition_maps_items_and_options_only_for_option_types(self):
        dumped = props.dump_definition([
            _item('c', 'char'), _select('s'), _tags('t'),
        ])
        self.assertEqual(dumped[0], {'key': 'c', 'label': 'C', 'type': 'char'})
        self.assertNotIn('options', dumped[0])
        self.assertEqual(dumped[1]['options'], [{'key': 'a', 'label': 'A'}, {'key': 'b', 'label': 'B'}])
        self.assertEqual(dumped[2]['options'], [{'key': 'x', 'label': 'X'}, {'key': 'y', 'label': 'Y'}])
        self.assertEqual(props.dump_definition(None), [])
        self.assertEqual(props.dump_definition(False), [])

    def test_dump_values_and_record_properties(self):
        items = [
            _item('c', 'char', value='hi'),
            _item('i', 'integer', value=3),
            _item('f', 'float', value=1.5),
            _item('b', 'boolean', value=False),
            _item('d', 'date', value=datetime.date(2030, 1, 15)),
            _item('dt', 'datetime', value=datetime.datetime(2030, 1, 15, 10, 0)),
            {**_select('s'), 'value': 'a'},
            {**_tags('t'), 'value': ['x']},
            _item('empty', 'char', value=False),
            _item('notags', 'tags', tags=[['x', 'X', 0]], value=False),
        ]
        record = _FakeRecord('props', items)
        self.assertEqual(props.dump_values(record, 'props'), {
            'c': 'hi', 'i': 3, 'f': 1.5, 'b': False, 'd': '2030-01-15',
            'dt': '2030-01-15T10:00:00Z', 's': 'a', 't': ['x'], 'empty': None, 'notags': [],
        })
        listed = props.dump_record_properties(record, 'props')
        self.assertEqual([entry['key'] for entry in listed], [item['name'] for item in items])
        self.assertEqual(listed[0], {'key': 'c', 'label': 'C', 'type': 'char', 'value': 'hi'})
        by_key = {entry['key']: entry for entry in listed}
        self.assertEqual(by_key['s']['value'], 'a')
        self.assertEqual(by_key['s']['options'][0], {'key': 'a', 'label': 'A'})
        self.assertEqual(by_key['t']['value'], ['x'])

    def test_dump_of_record_without_properties(self):
        record = _FakeRecord('props', False)
        self.assertEqual(props.dump_values(record, 'props'), {})
        self.assertEqual(props.dump_record_properties(record, 'props'), [])


@tagged('post_install', '-at_install', 'liwan')
class TestPropertiesFilterDomain(TransactionCase):

    def assertInvalid(self, call, field):
        with self.assertRaises(ApiError) as caught:
            call()
        self.assertEqual(caught.exception.status, 422)
        self.assertEqual(caught.exception.field, field)

    def test_boolean(self):
        definition = [_item('b', 'boolean')]
        self.assertEqual(props.filter_domain('p', definition, 'b', 'true'), ('p.b', '=', True))
        self.assertEqual(props.filter_domain('p', definition, 'b', 'false'), ('p.b', '=', False))
        self.assertInvalid(lambda: props.filter_domain('p', definition, 'b', 'yes'), 'property.b')

    def test_selection_and_tags(self):
        definition = [_select('s'), _tags('t')]
        self.assertEqual(props.filter_domain('p', definition, 's', 'a'), ('p.s', '=', 'a'))
        self.assertEqual(props.filter_domain('p', definition, 't', 'x'), ('p.t', 'in', ['x']))
        self.assertInvalid(lambda: props.filter_domain('p', definition, 's', 'zz'), 'property.s')
        self.assertInvalid(lambda: props.filter_domain('p', definition, 't', 'zz'), 'property.t')

    def test_char_and_unknown_key_are_rejected(self):
        definition = [_item('c', 'char')]
        self.assertInvalid(lambda: props.filter_domain('p', definition, 'c', 'x'), 'property.c')
        self.assertInvalid(lambda: props.filter_domain('p', definition, 'zz', 'x'), 'property.zz')
