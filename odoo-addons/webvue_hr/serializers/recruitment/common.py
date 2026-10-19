# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import email_normalize

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int


def ref(record):
    """The ``{id, name}`` reference every recruitment serializer uses."""
    return {'id': record.id, 'name': record.name} if record else None


def optional_id(value, field):
    """A relation id, or False to clear it; 422 on anything that is not a positive integer."""
    if value is None or value is False or (isinstance(value, str) and not value):
        return False
    return parse_positive_int(value, field)


def optional_text(value, field):
    if value is None or value is False:
        return ''
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', f'{field} must be a string', field=field)
    return value.strip()


def optional_email(value, field):
    """An email address, '' to clear it; 422 when the value is not one."""
    text = optional_text(value, field)
    if text and not email_normalize(text):
        raise ApiError(422, 'invalid', f'{field} must be a valid email address', field=field)
    return text


def reject_unknown(payload, allowed):
    unknown = set(payload) - set(allowed)
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'invalid', f'field {field!r} is not writable', field=field)
