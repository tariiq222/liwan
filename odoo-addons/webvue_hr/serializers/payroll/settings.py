# Part of Odoo. See LICENSE file for full copyright and licensing details.
import math

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.assets.common import ref, reject_unknown
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date
from odoo.addons.webvue_hr.serializers.payroll.revision import stored_revision

SETTINGS_FIELDS = ('day_divisor', 'structure_id', 'unpaid_leave_type_ids', 'annual_leave_type_id')
RATE_FIELDS = (
    'branch', 'nationality_class', 'date_from', 'employee_rate', 'employer_rate', 'wage_min', 'wage_max',
)
RATE_NUMBERS = ('employee_rate', 'employer_rate', 'wage_min', 'wage_max')


def dump_settings(settings):
    # ``_origin``: an unsaved settings record holds virtual copies of its relations.
    return {
        'day_divisor': settings.day_divisor,
        'structure': ref(settings.structure_id),
        'unpaid_leave_types': [ref(leave_type) for leave_type in settings.unpaid_leave_type_ids._origin],
        'annual_leave_type': ref(settings.annual_leave_type_id),
        'revision': stored_revision(settings),
    }


def parse_settings(payload, env):
    """The writable settings values; every id must name an existing record."""
    reject_unknown(payload, SETTINGS_FIELDS)
    vals = {}
    if 'day_divisor' in payload:
        divisor = payload['day_divisor']
        if isinstance(divisor, bool) or not isinstance(divisor, int) or not 28 <= divisor <= 31:
            raise ApiError(422, 'invalid', 'day_divisor must be a whole number from 28 to 31', field='day_divisor')
        vals['day_divisor'] = divisor
    if 'structure_id' in payload:
        vals['structure_id'] = _existing_id(env, 'hr.payroll.structure', payload['structure_id'], 'structure_id')
    if 'annual_leave_type_id' in payload:
        vals['annual_leave_type_id'] = _existing_id(
            env, 'hr.leave.type', payload['annual_leave_type_id'], 'annual_leave_type_id',
        )
    if 'unpaid_leave_type_ids' in payload:
        ids = payload['unpaid_leave_type_ids']
        if not isinstance(ids, list):
            raise ApiError(422, 'invalid', 'unpaid_leave_type_ids must be a list', field='unpaid_leave_type_ids')
        checked = [_existing_id(env, 'hr.leave.type', value, 'unpaid_leave_type_ids') for value in ids]
        vals['unpaid_leave_type_ids'] = [(6, 0, checked)]
    return vals


def _existing_id(env, model, value, field):
    record_id = parse_positive_int(value, field)
    if not env[model].search_count([('id', '=', record_id)]):
        raise ApiError(422, 'invalid', f'{field} does not reference an existing record', field=field)
    return record_id


def dump_rate(rate):
    return {
        'id': rate.id,
        'branch': rate.branch,
        'nationality_class': rate.nationality_class,
        'date_from': rate.date_from.isoformat(),
        'employee_rate': rate.employee_rate,
        'employer_rate': rate.employer_rate,
        'wage_min': rate.wage_min,
        'wage_max': rate.wage_max,
        'shared': not rate.company_id,
        'revision': rate.revision,
    }


def parse_rate(payload, model, *, partial):
    """The writable rate values. A create needs every key; a PATCH only the keys it changes."""
    reject_unknown(payload, RATE_FIELDS)
    if not partial:
        missing = [name for name in RATE_FIELDS if name not in payload]
        if missing:
            raise ApiError(422, 'invalid', f'{missing[0]} is required', field=missing[0])
    vals = {}
    for name in ('branch', 'nationality_class'):
        if name in payload:
            if payload[name] not in dict(model._fields[name].selection):
                raise ApiError(422, 'invalid', f'{name} is not a known value', field=name)
            vals[name] = payload[name]
    if 'date_from' in payload:
        day = parse_optional_date(payload['date_from'], 'date_from')
        if not day:
            raise ApiError(422, 'invalid', 'date_from is required', field='date_from')
        vals['date_from'] = day
    for name in RATE_NUMBERS:
        if name in payload:
            value = payload[name]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ApiError(422, 'invalid', f'{name} must be zero or more', field=name)
            vals[name] = value
    return vals
