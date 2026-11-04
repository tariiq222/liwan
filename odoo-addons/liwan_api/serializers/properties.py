# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape of Odoo's native properties engine (``fields.Properties``).

A properties field keeps its definition on an owning record (here the company) and the engine
resolves it for every record that carries the values. Applications therefore only translate
between the engine format and the JSON shapes the customer UI renders and edits, through the
functions below: a definition is a labelled, ordered list of typed keys, and a record's values are
an object keyed by those keys.
"""
import datetime
import re
import uuid

from odoo import fields

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso

MAX_PROPERTIES = 50
MAX_OPTIONS = 100
MAX_LABEL = 64
MAX_CHAR = 255
MAX_TEXT = 5000
PROPERTY_TYPES = (
    'char', 'text', 'integer', 'float', 'boolean', 'date', 'datetime', 'selection', 'tags',
)
OPTION_TYPES = ('selection', 'tags')
DATE_PATTERN = re.compile(r'\d{4}-\d{2}-\d{2}\Z')


def _invalid(field, message):
    return ApiError(422, 'invalid', message, field=field)


def dump_definition(definition):
    """The wire definition: one ``{key, label, type, options?}`` item per property, in display order."""
    return [_dump_definition_item(item) for item in definition or ()]


def read_items(record, field_name):
    """``record``'s properties in the engine's read format: its definition in order, each item with its value.

    Indexing the record answers the engine's record format (a mapping of values) instead, which
    carries no labels, types or options.
    """
    return record.read([field_name])[0][field_name] or []


def dump_values(record, field_name):
    """The values of ``record``'s properties field as ``{key: value}``, every defined key included."""
    return {item['name']: _wire_value(item) for item in read_items(record, field_name)}


def dump_record_properties(record, field_name):
    """``record``'s own definition, in display order, each item carrying its value.

    A record that receives only this response can render and edit its custom fields without
    reading the definition of the company separately.
    """
    return [
        {**_dump_definition_item(item), 'value': _wire_value(item)}
        for item in read_items(record, field_name)
    ]


def parse_definition(value, field, current):
    """The engine definition a PATCH installs, validated against the ``current`` one.

    An item without ``key`` is a new property and gets a server key; an item with ``key`` must
    exist already and keeps its type, because changing a type would reinterpret stored values.
    The list order is the display order.
    """
    if not isinstance(value, list):
        raise _invalid(field, 'must be a list of properties')
    if len(value) > MAX_PROPERTIES:
        raise _invalid(field, f'at most {MAX_PROPERTIES} properties')
    existing = {item['name']: item for item in current or ()}
    keys = set()
    parsed = []
    for index, item in enumerate(value):
        parsed.append(_parse_definition_item(item, index, field, existing, keys))
    return parsed


def parse_values(value, definition, field='properties'):
    """The engine values of a validated ``{key: value}`` object; null clears a property."""
    if not isinstance(value, dict):
        raise _invalid(field, 'must be an object of property values')
    properties = {item['name']: item for item in definition or ()}
    parsed = {}
    for key, raw in value.items():
        item = properties.get(key)
        if not item:
            raise _invalid(f'{field}.{key}', 'unknown property')
        parsed[key] = _parse_value(item, raw, f'{field}.{key}')
    return parsed


def filter_domain(field_name, definition, key, raw):
    """The list-filter domain leaf of one property, for the types the engine can filter on."""
    item = next((entry for entry in definition or () if entry['name'] == key), None)
    field = f'property.{key}'
    if not item:
        raise _invalid(field, 'unknown property')
    prop_type = item['type']
    if prop_type == 'boolean':
        if raw not in ('true', 'false'):
            raise _invalid(field, 'must be true or false')
        return (f'{field_name}.{key}', '=', raw == 'true')
    if prop_type in OPTION_TYPES:
        if raw not in _option_keys(item):
            raise _invalid(field, 'must be one of this property options')
        if prop_type == 'tags':
            return (f'{field_name}.{key}', 'in', [raw])
        return (f'{field_name}.{key}', '=', raw)
    raise _invalid(field, 'this property cannot be filtered')


def _dump_definition_item(item):
    dumped = {'key': item['name'], 'label': item['string'], 'type': item['type']}
    options = _dump_options(item)
    if options:
        dumped['options'] = options
    return dumped


def _dump_options(item):
    """The ``{key, label}`` options of a selection or tags property, or None for another type."""
    prop_type = item['type']
    if prop_type not in OPTION_TYPES:
        return None
    return [{'key': pair[0], 'label': pair[1]} for pair in item.get(prop_type) or ()]


def _option_keys(item):
    return {option['key'] for option in _dump_options(item) or ()}


def _wire_value(item):
    prop_type = item['type']
    value = item.get('value')
    if prop_type == 'tags':
        return list(value or ())
    if prop_type == 'boolean':
        return bool(value)
    if value is None or value is False or (isinstance(value, str) and not value):
        return None
    if prop_type == 'integer':
        return int(value)
    if prop_type == 'float':
        return float(value)
    if prop_type == 'date':
        return fields.Date.to_string(fields.Date.to_date(value))
    if prop_type == 'datetime':
        return iso(_utc(fields.Datetime.to_datetime(value)))
    return value


def _utc(value):
    """A naive UTC datetime, so an ISO value is the same instant whatever zone the reader is in."""
    return value.astimezone(datetime.timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _parse_definition_item(item, index, field, existing, keys):
    prefix = f'{field}[{index}]'
    if not isinstance(item, dict):
        raise _invalid(prefix, 'must be an object')
    current = None
    key = item.get('key')
    if key is None:
        key = uuid.uuid4().hex[:16]
    elif not isinstance(key, str):
        raise _invalid(f'{prefix}.key', 'must be a server key')
    else:
        current = existing.get(key)
        if not current:
            raise _invalid(f'{prefix}.key', 'unknown property')
    if key in keys:
        raise _invalid(f'{prefix}.key', 'duplicate property')
    keys.add(key)
    prop_type = item.get('type')
    if prop_type not in PROPERTY_TYPES:
        raise _invalid(f'{prefix}.type', 'must be one of ' + ', '.join(PROPERTY_TYPES))
    if current and current['type'] != prop_type:
        raise _invalid(f'{prefix}.type', 'a property keeps its type')
    parsed = {'name': key, 'string': _label(item.get('label'), f'{prefix}.label'), 'type': prop_type}
    if prop_type in OPTION_TYPES:
        parsed[prop_type] = _parse_options(item.get('options'), prefix, current, prop_type)
    elif 'options' in item:
        raise _invalid(f'{prefix}.options', 'a property of this type has no options')
    return parsed


def _parse_options(options, prefix, current, prop_type):
    field = f'{prefix}.options'
    if not isinstance(options, list) or not 1 <= len(options) <= MAX_OPTIONS:
        raise _invalid(field, f'must be a list of 1 to {MAX_OPTIONS} options')
    current_options = {pair[0] for pair in (current or {}).get(prop_type) or ()}
    keys = set()
    parsed = []
    for index, option in enumerate(options):
        option_field = f'{field}[{index}]'
        if not isinstance(option, dict):
            raise _invalid(option_field, 'must be an object')
        key = option.get('key')
        if key is None:
            key = uuid.uuid4().hex[:16]
        elif not isinstance(key, str):
            raise _invalid(f'{option_field}.key', 'must be a server key')
        elif key not in current_options:
            raise _invalid(f'{option_field}.key', 'unknown option')
        if key in keys:
            raise _invalid(f'{option_field}.key', 'duplicate option')
        keys.add(key)
        label = _label(option.get('label'), f'{option_field}.label')
        parsed.append([key, label, 0] if prop_type == 'tags' else [key, label])
    return parsed


def _label(value, field):
    label = value.strip() if isinstance(value, str) else ''
    if not 1 <= len(label) <= MAX_LABEL:
        raise _invalid(field, f'must be text of 1 to {MAX_LABEL} characters')
    return label


def _parse_value(item, raw, field):
    prop_type = item['type']
    if prop_type == 'tags':
        return _parse_tags(raw, item, field)
    if raw is None:
        return None
    if prop_type == 'char':
        return _parse_text(raw, field, MAX_CHAR)
    if prop_type == 'text':
        return _parse_text(raw, field, MAX_TEXT)
    if prop_type == 'integer':
        if type(raw) is not int:
            raise _invalid(field, 'must be a whole number')
        return raw
    if prop_type == 'float':
        if type(raw) not in (int, float):
            raise _invalid(field, 'must be a number')
        return float(raw)
    if prop_type == 'boolean':
        if type(raw) is not bool:
            raise _invalid(field, 'must be true or false')
        return raw
    if prop_type == 'date':
        return _parse_date(raw, field)
    if prop_type == 'datetime':
        return _parse_datetime(raw, field)
    if not isinstance(raw, str) or raw not in _option_keys(item):
        raise _invalid(field, 'must be one of this property options')
    return raw


def _parse_text(raw, field, maximum):
    if not isinstance(raw, str):
        raise _invalid(field, f'must be text of at most {maximum} characters')
    if len(raw) > maximum:
        raise _invalid(field, f'must be text of at most {maximum} characters')
    return raw or None


def _parse_tags(raw, item, field):
    if raw is None:
        return []
    if not isinstance(raw, list) or any(not isinstance(key, str) for key in raw):
        raise _invalid(field, 'must be a list of option keys')
    known = _option_keys(item)
    if any(key not in known for key in raw):
        raise _invalid(field, 'must be one of this property options')
    return list(dict.fromkeys(raw))


def _parse_date(raw, field):
    if not isinstance(raw, str) or not DATE_PATTERN.match(raw):
        raise _invalid(field, 'must be a date as YYYY-MM-DD')
    try:
        return fields.Date.to_string(fields.Date.to_date(raw))
    except ValueError:
        raise _invalid(field, 'must be a date as YYYY-MM-DD') from None


def _parse_datetime(raw, field):
    if not isinstance(raw, str):
        raise _invalid(field, 'must be an ISO-8601 datetime')
    try:
        value = datetime.datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        raise _invalid(field, 'must be an ISO-8601 datetime') from None
    # The engine stores the values as JSON, so a datetime is kept in Odoo's own UTC text form.
    return fields.Datetime.to_string(_utc(value))
