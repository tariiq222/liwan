# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .parsing import (
    parse_number,
    parse_text,
    reject_unknown,
    require_keys,
    require_nonempty,
)
from odoo.addons.liwan_api.controllers.common import ApiError

LINE_VALUES = ('percent', 'fixed')
LINE_DELAY_TYPES = ('days_after', 'days_after_end_of_month', 'days_after_end_of_next_month')
TERM_CREATE_FIELDS = frozenset({'name', 'note', 'lines'})
TERM_PATCH_FIELDS = TERM_CREATE_FIELDS
LINE_FIELDS = frozenset({'value', 'value_amount', 'nb_days', 'delay_type'})
MAX_LINES = 12
MAX_DAYS = 3650


def dump_payment_term_line(line):
    return {
        'value': line.value,
        'value_amount': line.value_amount,
        'nb_days': line.nb_days,
        'delay_type': line.delay_type,
    }


def dump_payment_term(term):
    return {
        'id': term.id,
        'name': term.name,
        'shared': not term.company_id,
        'active': term.active,
        'lines': [dump_payment_term_line(line) for line in term.line_ids],
    }


def dump_payment_terms(terms):
    return [dump_payment_term(term) for term in terms]


def _parse_line(line, index):
    field = f'lines[{index}]'
    if not isinstance(line, dict):
        raise ApiError(422, 'invalid', f'{field} must be an object', field=field)
    reject_unknown(line, LINE_FIELDS, prefix=f'{field}.')
    require_keys(line, ('value', 'value_amount'), prefix=f'{field}.')
    if line['value'] not in LINE_VALUES:
        raise ApiError(422, 'invalid', f'{field}.value must be one of {", ".join(LINE_VALUES)}', field=f'{field}.value')
    delay_type = line.get('delay_type', 'days_after')
    if delay_type not in LINE_DELAY_TYPES:
        raise ApiError(422, 'invalid', f'{field}.delay_type must be one of {", ".join(LINE_DELAY_TYPES)}', field=f'{field}.delay_type')
    maximum = 100 if line['value'] == 'percent' else None
    nb_days = line.get('nb_days', 0)
    if isinstance(nb_days, bool) or not isinstance(nb_days, int) or not 0 <= nb_days <= MAX_DAYS:
        raise ApiError(422, 'invalid', f'{field}.nb_days must be an integer from 0 to {MAX_DAYS}', field=f'{field}.nb_days')
    return {
        'value': line['value'],
        'value_amount': parse_number(line['value_amount'], f'{field}.value_amount', minimum=0, maximum=maximum),
        'nb_days': nb_days,
        'delay_type': delay_type,
    }


def _parse_lines(lines):
    if not isinstance(lines, list) or not 1 <= len(lines) <= MAX_LINES:
        raise ApiError(422, 'invalid', f'lines must be a list of 1 to {MAX_LINES} lines', field='lines')
    parsed = [_parse_line(line, index) for index, line in enumerate(lines)]
    if round(sum(line['value_amount'] for line in parsed if line['value'] == 'percent'), 6) != 100:
        raise ApiError(422, 'invalid', 'the percent lines must add up to 100', field='lines')
    return parsed


def _parse_fields(payload):
    parsed = {}
    for field, value in payload.items():
        if field == 'name':
            parsed[field] = parse_text(value, field, required=True)
        elif field == 'note':
            parsed[field] = parse_text(value, field)
        else:
            parsed[field] = _parse_lines(value)
    return parsed


def parse_payment_term_create(payload):
    reject_unknown(payload, TERM_CREATE_FIELDS)
    require_keys(payload, ('name', 'lines'))
    return _parse_fields(payload)


def parse_payment_term_patch(payload):
    reject_unknown(payload, TERM_PATCH_FIELDS)
    require_nonempty(payload)
    return _parse_fields(payload)
