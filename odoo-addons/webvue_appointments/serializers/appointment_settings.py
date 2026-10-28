# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_appointments.models.appointment_settings import (
    DEFAULTS,
    FIELD_REQUIREMENTS,
    INTEGER_RANGES,
    PRESETS,
    REQUESTER_FIELDS,
    SECTOR_PRESETS,
    SELF_BOOKING_POLICIES,
)

SETTING_FIELDS = (*DEFAULTS, 'sector_preset')
SELECTION_OPTIONS = {
    **{name: tuple(value for value, _label in FIELD_REQUIREMENTS) for name in REQUESTER_FIELDS},
    'self_booking_policy': tuple(value for value, _label in SELF_BOOKING_POLICIES),
}
PRESET_KEYS = [value for value, _label in SECTOR_PRESETS]


def dump_settings(row):
    """The saved settings, or the defaults (revision 0) while the company has no row."""
    values = {name: row[name] for name in SETTING_FIELDS} if row else {**DEFAULTS, 'sector_preset': 'general'}
    return {**values, 'presets': list(PRESET_KEYS), 'revision': row.revision if row else 0}


def parse_settings(payload):
    """Validate a PATCH body into ``{'revision': n, 'values': {...}}``; a preset's values come first."""
    unknown = sorted(set(payload) - {*SETTING_FIELDS, 'preset', 'revision'})
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
    revision = payload.get('revision')
    if type(revision) is not int or revision < 0:
        raise ApiError(422, 'invalid', 'revision must be a nonnegative integer', field='revision')
    values = {}
    if 'preset' in payload:
        if payload['preset'] not in PRESETS:
            raise ApiError(422, 'invalid', 'choose a listed preset', field='preset')
        values.update(PRESETS[payload['preset']], sector_preset=payload['preset'])
    for name in SETTING_FIELDS:
        if name in payload:
            values[name] = _parse_value(name, payload[name])
    return {'revision': revision, 'values': values}


def _parse_value(name, value):
    if name in INTEGER_RANGES:
        low, high = INTEGER_RANGES[name]
        if type(value) is not int or not low <= value <= high:
            raise ApiError(422, 'invalid', 'must be a whole number from %d to %d' % (low, high), field=name)
    elif name == 'requester_confirmation':
        if type(value) is not bool:
            raise ApiError(422, 'invalid', 'must be true or false', field=name)
    elif name == 'sector_preset':
        if value not in PRESET_KEYS:
            raise ApiError(422, 'invalid', 'choose a listed preset', field=name)
    elif value not in SELECTION_OPTIONS[name]:
        raise ApiError(422, 'invalid', 'choose one of: %s' % ', '.join(SELECTION_OPTIONS[name]), field=name)
    return value
