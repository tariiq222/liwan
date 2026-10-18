# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-body field parsers shared by the finance write routes.

Each parser returns a clean Python value or raises ``ApiError(422, 'invalid', ..., field=...)``.
Money in a request is a plain JSON number, never a string.
"""
from math import isfinite

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_finance.controllers.common import parse_day as parse_iso_day

MAX_TEXT = 255
# Odoo money columns are numeric(16, 2) at most; a larger number would be a database overflow.
MAX_NUMBER = 10 ** 12


def _invalid(message, field):
    return ApiError(422, 'invalid', message, field=field)


def reject_unknown(payload, allowed, prefix=''):
    """A strict body: any key outside ``allowed`` is a 422 naming that key (under ``prefix``)."""
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        raise _invalid(f'unknown field: {prefix}{unknown[0]}', f'{prefix}{unknown[0]}')


def require_nonempty(payload):
    if not payload:
        raise ApiError(422, 'invalid', 'no fields to update')


def require_keys(payload, required, prefix=''):
    for field in required:
        if field not in payload:
            raise _invalid(f'{prefix}{field} is required', f'{prefix}{field}')


def parse_text(value, field, *, required=False):
    """A stripped string of at most MAX_TEXT characters; ``''`` clears an optional text."""
    if not isinstance(value, str):
        raise _invalid(f'{field} must be a string', field)
    text = value.strip()
    if required and not text:
        raise _invalid(f'{field} must not be empty', field)
    if len(text) > MAX_TEXT:
        raise _invalid(f'{field} must be at most {MAX_TEXT} characters', field)
    return text


def parse_bool(value, field):
    if not isinstance(value, bool):
        raise _invalid(f'{field} must be a boolean', field)
    return value


def parse_number(value, field, *, minimum=None, maximum=None, exclusive_minimum=False):
    """A finite JSON number (not a bool and not a numeric string)."""
    if isinstance(value, bool) or not isinstance(value, int | float) or not isfinite(value):
        raise _invalid(f'{field} must be a number', field)
    if abs(value) >= MAX_NUMBER:
        raise _invalid(f'{field} must be below {MAX_NUMBER} in absolute value', field)
    if minimum is not None and (value <= minimum if exclusive_minimum else value < minimum):
        raise _invalid(f'{field} must be {"greater than" if exclusive_minimum else "at least"} {minimum}', field)
    if maximum is not None and value > maximum:
        raise _invalid(f'{field} must be at most {maximum}', field)
    return value


def parse_day(value, field):
    if not isinstance(value, str):
        raise _invalid(f'{field} must be an ISO date (YYYY-MM-DD)', field)
    return parse_iso_day(value, field)


def parse_id(value, field):
    return parse_positive_int(value, field)


def parse_id_list(value, field):
    """A list of distinct positive ids (possibly empty)."""
    if not isinstance(value, list):
        raise _invalid(f'{field} must be a list of ids', field)
    ids = [parse_positive_int(item, field) for item in value]
    if len(set(ids)) != len(ids):
        raise _invalid(f'{field} must not repeat an id', field)
    return ids
