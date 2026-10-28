# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import date, timedelta

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int

ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'


def parse_slot_query(args, today, horizon_days):
    """Validate ``from``/``to`` (inclusive YYYY-MM-DD) and the optional ``combination_id`` of a slots request.

    ``to`` may not pass ``today`` plus the company's booking horizon.
    """
    first, last = (_parse_date(args.get(name), name) for name in ('from', 'to'))
    if last < first:
        raise ApiError(422, 'invalid', 'to must not be before from', field='to')
    if last > today + timedelta(days=horizon_days):
        raise ApiError(422, 'invalid', 'to is beyond the %d-day booking horizon' % horizon_days, field='to')
    combination_id = parse_positive_int(args['combination_id'], 'combination_id') if 'combination_id' in args else None
    return first, last, combination_id


def _parse_date(value, field):
    if not value or not ISO_DATE.fullmatch(value):
        raise ApiError(422, 'invalid', 'must be a date as YYYY-MM-DD', field=field)
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, 'invalid', 'must be a real calendar date', field=field) from None


def dump_slot(start, stop):
    """One slot as UTC ISO strings; ``start`` and ``stop`` are timezone-aware datetimes."""
    return {'start': start.strftime(UTC_FORMAT), 'stop': stop.strftime(UTC_FORMAT)}
