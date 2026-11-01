# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_hr.serializers.assets.common import reject_unknown
from odoo.addons.liwan_hr.serializers.dates import parse_optional_date

MAX_MONEY = 10 ** 9


def required_text(payload, field, limit):
    value = payload.get(field)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ApiError(422, 'invalid', f'{field} must be 1 to {limit} characters', field=field)
    return value.strip()


def optional_text(payload, field, limit):
    value = payload.get(field)
    if value is None or value is False:
        return ''
    if not isinstance(value, str) or len(value.strip()) > limit:
        raise ApiError(422, 'invalid', f'{field} must be at most {limit} characters', field=field)
    return value.strip()


def money(payload, field):
    """A nonnegative amount with at most two decimals, or 0 when absent."""
    value = payload.get(field)
    if value is None:
        return 0.0
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= MAX_MONEY:
        raise ApiError(422, 'invalid', f'{field} must be an amount from 0 to {MAX_MONEY}', field=field)
    return round(float(value), 2)


def required_date(payload, field):
    value = parse_optional_date(payload.get(field), field)
    if not value:
        raise ApiError(422, 'invalid', f'{field} is required', field=field)
    return value


def parse_revision(payload):
    revision = payload.get('revision')
    if type(revision) is not int or revision < 1:
        raise ApiError(422, 'invalid', 'revision must be a positive integer', field='revision')
    return revision


def parse_flag(payload, field):
    if type(payload[field]) is not bool:
        raise ApiError(422, 'invalid', f'{field} must be true or false', field=field)
    return payload[field]


def parse_revision_only(payload):
    reject_unknown(payload, ('revision',))
    return parse_revision(payload)


def parse_end(payload):
    """The revision and the optional end date of an end action."""
    reject_unknown(payload, ('revision', 'date_end'))
    return parse_revision(payload), parse_optional_date(payload.get('date_end'), 'date_end') or None


def parse_state_filter(value, allowed):
    if value in (None, ''):
        return None
    if value not in allowed:
        raise ApiError(422, 'invalid', f"state must be one of {', '.join(allowed)}", field='state')
    return value
