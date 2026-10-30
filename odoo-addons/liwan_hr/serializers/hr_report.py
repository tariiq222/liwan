# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.liwan_api.controllers.common import ApiError

DEFAULT_WITHIN_DAYS = 60
MAX_WITHIN_DAYS = 365


def parse_within_days(value):
    """The look-ahead window of the expiry alerts, 0 to MAX_WITHIN_DAYS days."""
    if value in (None, ''):
        return DEFAULT_WITHIN_DAYS
    try:
        days = int(value)
    except (TypeError, ValueError):
        days = -1
    if not 0 <= days <= MAX_WITHIN_DAYS:
        raise ApiError(
            422, 'invalid', f'within_days must be an integer from 0 to {MAX_WITHIN_DAYS}',
            field='within_days',
        )
    return days


def dump_expiring(items):
    return {
        'items': [{**item, 'due_date': fields.Date.to_string(item['due_date'])} for item in items],
        'total': len(items),
    }
