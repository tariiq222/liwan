# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Validation of a form write body (packages/contracts InboxFlowWriteSchema): every limit is checked here again."""
import re
from dataclasses import dataclass

from odoo.http import request

from odoo.addons.liwan_inbox.controllers.automation_parsing import (
    parse_bool,
    parse_choice,
    parse_date,
    parse_int,
)
from odoo.addons.liwan_inbox.controllers.helpers import reject
from odoo.addons.liwan_inbox.controllers.reply_parsing import (
    parse_list,
    parse_object,
    parse_string,
)
from odoo.addons.liwan_inbox.models.constants import MAX_FLOW_OPTIONS, MAX_FLOW_SCREENS
from odoo.addons.liwan_inbox.models.flow import (
    CATEGORIES,
    DISPLAY_KINDS,
    FIELD_KEY,
    INPUT_KINDS,
    INPUT_TYPES,
    RESERVED_KEY,
)

LANGUAGE = re.compile(r'^[a-z]{2,3}(_[A-Z]{2})?$')
FLOW_KEYS = {'name', 'category', 'language', 'completion_message', 'screens'}
SCREEN_KEYS = {'title', 'footer_label', 'fields'}
MAX_NAME = 128
MAX_COMPLETION = 4096
MAX_SCREEN_TITLE = 80
MAX_FOOTER_LABEL = 35
# 50 components per screen, the last of them the footer.
MAX_SCREEN_FIELDS = 49
MAX_OPT_INS = 5
MAX_HELPER = 80
MAX_TEXT_CHARS = 4096
MAX_AREA_CHARS = 600
MAX_CHECKBOX_OPTIONS = 20
MAX_OPTION_TITLE = 30
MAX_OPTION_DESCRIPTION = 300
TEXT_LIMITS = {'heading': 80, 'subheading': 80, 'text': 4096, 'caption': 409}
LABEL_LIMITS = {'text_input': 20, 'text_area': 20, 'dropdown': 20, 'radio': 30, 'checkbox': 30, 'date': 40, 'opt_in': 120}
OPTION_LIMITS = {'dropdown': 200, 'radio': MAX_CHECKBOX_OPTIONS, 'checkbox': MAX_CHECKBOX_OPTIONS}
INPUT_HEAD = {'key', 'label', 'required', 'sensitive'}
FIELD_KEYS = {
    **{kind: {'text'} for kind in DISPLAY_KINDS},
    'text_input': INPUT_HEAD | {'input_type', 'helper_text', 'min_chars', 'max_chars'},
    'text_area': INPUT_HEAD | {'helper_text', 'max_length'},
    'dropdown': INPUT_HEAD | {'options'},
    'radio': INPUT_HEAD | {'options'},
    'checkbox': INPUT_HEAD | {'min_selected', 'max_selected', 'options'},
    'date': INPUT_HEAD | {'helper_text', 'min_date', 'max_date'},
    'opt_in': {'key', 'label', 'required'},
}


@dataclass
class ParsedFlow:
    """The validated settings (`values`) and screens (plain dicts) of a form write body."""
    values: dict
    screens: list


def parse_nullable_int(value, key, low, high):
    return None if value is None else parse_int(value, key, low, high)


def parse_option(option):
    option = parse_object(option, 'options', {'title', 'description'}, ('title', 'description'))
    return {
        'title': parse_string(option['title'], 'options', MAX_OPTION_TITLE),
        'description': parse_string(option['description'], 'options', MAX_OPTION_DESCRIPTION, nullable=True),
    }


def parse_options(value, kind):
    options = [parse_option(option) for option in parse_list(value, 'options', 1, OPTION_LIMITS[kind])]
    if len({option['title'] for option in options}) != len(options):
        reject('choice titles are unique in a field', 'options')
    return options


def parse_input_head(raw, kind):
    key = parse_string(raw['key'], 'key', 40)
    if not FIELD_KEY.match(key) or key == RESERVED_KEY:
        reject('key must be lowercase letters, digits and underscores starting with a letter (at most 40), and not flow_token', 'key')
    return {
        'key': key, 'label': parse_string(raw['label'], 'label', LABEL_LIMITS[kind]),
        'required': parse_bool(raw['required'], 'required'),
        'sensitive': parse_bool(raw['sensitive'], 'sensitive') if 'sensitive' in raw else False,
    }


def parse_text_input(raw):
    field = {
        'input_type': parse_choice(raw['input_type'], 'input_type', INPUT_TYPES),
        'helper_text': parse_string(raw['helper_text'], 'helper_text', MAX_HELPER, nullable=True),
        'min_chars': parse_nullable_int(raw['min_chars'], 'min_chars', 1, MAX_TEXT_CHARS),
        'max_chars': parse_nullable_int(raw['max_chars'], 'max_chars', 1, MAX_TEXT_CHARS),
    }
    if field['min_chars'] and field['max_chars'] and field['min_chars'] > field['max_chars']:
        reject('min_chars exceeds max_chars', 'min_chars')
    return field


def parse_checkbox(raw, options):
    low = parse_nullable_int(raw['min_selected'], 'min_selected', 1, MAX_CHECKBOX_OPTIONS)
    high = parse_nullable_int(raw['max_selected'], 'max_selected', 1, MAX_CHECKBOX_OPTIONS)
    ceiling = high or len(options)
    if (low or 1) > ceiling or ceiling > len(options):
        reject('the selection limits do not fit the choices', 'min_selected')
    return {'min_selected': low, 'max_selected': high}


def parse_date_field(raw):
    first = parse_date(raw['min_date'], 'min_date') if raw['min_date'] is not None else None
    last = parse_date(raw['max_date'], 'max_date') if raw['max_date'] is not None else None
    if first and last and first > last:
        reject('min_date is after max_date', 'min_date')
    return {
        'helper_text': parse_string(raw['helper_text'], 'helper_text', MAX_HELPER, nullable=True),
        'min_date': first, 'max_date': last,
    }


def parse_field(raw):
    kind = raw.get('kind') if isinstance(raw, dict) else None
    if kind not in FIELD_KEYS:
        reject(f'a field kind must be one of {sorted(FIELD_KEYS)}', 'fields')
    keys = FIELD_KEYS[kind] | {'kind'}
    raw = parse_object(raw, 'fields', keys, keys)
    if kind in DISPLAY_KINDS:
        return {'kind': kind, 'text': parse_string(raw['text'], 'text', TEXT_LIMITS[kind])}
    field = {'kind': kind, **parse_input_head(raw, kind)}
    if kind == 'text_input':
        return {**field, **parse_text_input(raw)}
    if kind == 'text_area':
        return {
            **field, 'helper_text': parse_string(raw['helper_text'], 'helper_text', MAX_HELPER, nullable=True),
            'max_length': parse_nullable_int(raw['max_length'], 'max_length', 1, MAX_AREA_CHARS),
        }
    if kind == 'date':
        return {**field, **parse_date_field(raw)}
    if kind == 'opt_in':
        return {**field, 'sensitive': False}
    field['options'] = parse_options(raw['options'], kind)
    return {**field, **(parse_checkbox(raw, field['options']) if kind == 'checkbox' else {})}


def parse_screen(raw):
    raw = parse_object(raw, 'screens', SCREEN_KEYS, SCREEN_KEYS)
    fields = [parse_field(field) for field in parse_list(raw['fields'], 'fields', 1, MAX_SCREEN_FIELDS)]
    if sum(1 for field in fields if field['kind'] == 'opt_in') > MAX_OPT_INS:
        reject(f'a screen holds at most {MAX_OPT_INS} opt-in boxes', 'fields')
    return {
        'title': parse_string(raw['title'], 'title', MAX_SCREEN_TITLE),
        'footer_label': parse_string(raw['footer_label'], 'footer_label', MAX_FOOTER_LABEL),
        'fields': fields,
    }


def check_form(screens):
    """The rules that span fields and screens: an input to answer, unique keys and a bounded number of choices."""
    fields = [field for screen in screens for field in screen['fields']]
    keys = [field['key'] for field in fields if field['kind'] in INPUT_KINDS]
    if not keys:
        reject('a form needs at least one field that collects an answer', 'screens')
    if len(set(keys)) != len(keys):
        reject('every field key is unique in the form', 'screens')
    if sum(len(field.get('options', ())) for field in fields) > MAX_FLOW_OPTIONS:
        reject(f'a form holds at most {MAX_FLOW_OPTIONS} choices in all', 'screens')


def parse_name(channel, payload, flow):
    name = parse_string(payload['name'], 'name', MAX_NAME)
    clash = [('channel_id', '=', channel.id), ('name', '=', name)]
    if flow:
        clash.append(('id', '!=', flow.id))
    if request.env['liwan.inbox.flow'].search_count(clash):
        reject('a form with this name already exists on the channel', 'name')
    return name


def parse_flow_write(channel, payload, flow=None):
    """The validated ParsedFlow of a create (no `flow`) or full-replace body; 422 naming the field on anything else."""
    parse_object(payload, 'form', FLOW_KEYS, FLOW_KEYS)
    language = payload['language']
    if not isinstance(language, str) or not LANGUAGE.match(language):
        reject('language must be a Meta language code such as ar or en_US', 'language')
    screens = [parse_screen(screen) for screen in parse_list(payload['screens'], 'screens', 1, MAX_FLOW_SCREENS)]
    check_form(screens)
    return ParsedFlow({
        'name': parse_name(channel, payload, flow),
        'category': parse_choice(payload['category'], 'category', CATEGORIES),
        'language': language,
        'completion_message': parse_string(payload['completion_message'], 'completion_message', MAX_COMPLETION, nullable=True) or False,
    }, screens)


def parse_copy(channel, payload):
    """The name and `replace` flag of a copy body."""
    parse_object(payload, 'copy', {'name', 'replace'}, ('name', 'replace'))
    return parse_name(channel, payload, None), parse_bool(payload['replace'], 'replace')
