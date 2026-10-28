# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int

MAX_TEXT_LENGTH = 255


def reject_unknown(payload, writable):
    """422 naming the first payload key that is not a writable field."""
    unknown = sorted(set(payload) - set(writable))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])


def require_fields(payload, required):
    for name in required:
        if name not in payload:
            raise ApiError(422, 'invalid', 'field is required', field=name)


def parse_text(value, field, *, required=True):
    """A trimmed string of at most MAX_TEXT_LENGTH characters; an optional field may be null or empty (stored as False)."""
    if value is None and not required:
        return False
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'must be text', field=field)
    value = value.strip()
    if required and not value:
        raise ApiError(422, 'invalid', 'must not be empty', field=field)
    if len(value) > MAX_TEXT_LENGTH:
        raise ApiError(422, 'invalid', 'must be at most %d characters' % MAX_TEXT_LENGTH, field=field)
    return value or False


def parse_whole_number(value, field, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ApiError(422, 'invalid', 'must be a whole number from %d to %d' % (low, high), field=field)
    return value


def parse_id_list(value, field):
    """A list of distinct positive ids, in the order sent."""
    if not isinstance(value, list):
        raise ApiError(422, 'invalid', 'must be a list of ids', field=field)
    ids = [parse_positive_int(item, field) for item in value]
    if len(set(ids)) != len(ids):
        raise ApiError(422, 'invalid', 'must not repeat an id', field=field)
    return ids
