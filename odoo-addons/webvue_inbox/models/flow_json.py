# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Meta's Flow JSON of a form, generated from its rows. Pure functions over plain dicts: no Odoo environment.

The same rows always give the same bytes. The JSON is never stored: only its hash is (to skip an identical upload).
"""
import hashlib
import json

from .constants import FLOW_JSON_VERSION, MAX_FLOW_SCREENS

# Meta reserves SUCCESS; the letters and the underscore are the only characters WebVue uses for a screen id.
SCREEN_LETTERS = 'ABCDEFGHIJ'
DISPLAY_COMPONENTS = {'heading': 'TextHeading', 'subheading': 'TextSubheading', 'text': 'TextBody', 'caption': 'TextCaption'}
CHOICE_COMPONENTS = {'dropdown': 'Dropdown', 'radio': 'RadioButtonsGroup', 'checkbox': 'CheckboxGroup'}
INPUT_KINDS = ('text_input', 'text_area', 'dropdown', 'radio', 'checkbox', 'date', 'opt_in')

assert len(SCREEN_LETTERS) == MAX_FLOW_SCREENS


def screen_id(index):
    return f'SCREEN_{SCREEN_LETTERS[index]}'


def _optional(component, extras):
    """`component` plus the `extras` whose value is set (not None, False or 0)."""
    return {**component, **{name: value for name, value in extras.items() if value}}


def _choices(field):
    return [
        _optional({'id': option['key'], 'title': option['title']}, {'description': option.get('description')})
        for option in field['options']
    ]


def _input(field):
    kind, base = field['kind'], {'name': field['key'], 'label': field['label'], 'required': bool(field['required'])}
    if kind == 'text_input':
        return _optional({'type': 'TextInput', **base, 'input-type': field['input_type']}, {
            'helper-text': field.get('helper_text'),
            'min-chars': str(field['min_chars']) if field.get('min_chars') else None,
            'max-chars': str(field['max_chars']) if field.get('max_chars') else None,
        })
    if kind == 'text_area':
        return _optional({'type': 'TextArea', **base}, {
            'helper-text': field.get('helper_text'),
            'max-length': str(field['max_length']) if field.get('max_length') else None,
        })
    if kind == 'date':
        return _optional({'type': 'DatePicker', **base}, {
            'helper-text': field.get('helper_text'), 'min-date': field.get('min_date'), 'max-date': field.get('max_date'),
        })
    if kind == 'opt_in':
        return {'type': 'OptIn', **base}
    component = {'type': CHOICE_COMPONENTS[kind], **base, 'data-source': _choices(field)}
    if kind == 'checkbox':
        component = _optional(component, {
            'min-selected-items': field.get('min_selected'), 'max-selected-items': field.get('max_selected'),
        })
    return component


def _component(field):
    if field['kind'] in DISPLAY_COMPONENTS:
        return {'type': DISPLAY_COMPONENTS[field['kind']], 'text': field['text']}
    return _input(field)


def _answer_payload(screens):
    """The `complete` payload: every input key of every screen, read through a global reference (Flow JSON 4.0 and later)."""
    return {
        field['key']: f'${{screen.{screen_id(index)}.form.{field["key"]}}}'
        for index, screen in enumerate(screens) for field in screen['fields'] if field['kind'] in INPUT_KINDS
    }


def _footer(screens, index):
    last = index == len(screens) - 1
    action = (
        {'name': 'complete', 'payload': _answer_payload(screens)} if last
        else {'name': 'navigate', 'next': {'type': 'screen', 'name': screen_id(index + 1)}, 'payload': {}}
    )
    return {'type': 'Footer', 'label': screens[index]['footer_label'], 'on-click-action': action}


def _screen(screens, index):
    screen = screens[index]
    last = index == len(screens) - 1
    sensitive = [field['key'] for field in screen['fields'] if field['kind'] in INPUT_KINDS and field.get('sensitive')]
    return {
        'id': screen_id(index), 'title': screen['title'], **({'terminal': True, 'success': True} if last else {}),
        **({'sensitive': sensitive} if sensitive else {}),
        'layout': {'type': 'SingleColumnLayout', 'children': [*(_component(field) for field in screen['fields']), _footer(screens, index)]},
    }


def build(structure):
    """The Flow JSON object of `structure` = {'screens': [{'title', 'footer_label', 'fields': [...]}]}."""
    screens = structure['screens']
    return {'version': FLOW_JSON_VERSION, 'screens': [_screen(screens, index) for index in range(len(screens))]}


def serialize(structure):
    """The Flow JSON text Meta receives (compact, key order fixed by the builder)."""
    return json.dumps(build(structure), ensure_ascii=False, separators=(',', ':'))


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()
