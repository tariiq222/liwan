# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The checks every Sales request body shares: a 422 ``invalid`` on the field, an id, a text and unknown keys."""
from odoo.addons.liwan_api.controllers.common import ApiError


def invalid(field, message):
    raise ApiError(422, 'invalid', message, field=field)


def is_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def refuse_unknown(payload, accepted, prefix=''):
    unknown = sorted(set(payload) - set(accepted))
    if unknown:
        invalid(f'{prefix}{unknown[0]}', f'field {unknown[0]!r} is not accepted')


def parse_id(payload, key, field=None):
    value = payload[key]
    if not is_id(value):
        invalid(field or key, f'{key} must be a positive integer')
    return value


def parse_text(value, field, required, maximum):
    if not isinstance(value, str) or (required and not value.strip()) or len(value) > maximum:
        invalid(field, f'{field} must be {"non-empty " if required else ""}text of at most {maximum} characters')
    return value.strip() if required else value
