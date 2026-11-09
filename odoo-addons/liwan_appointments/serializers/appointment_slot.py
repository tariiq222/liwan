# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import UTC, date, datetime, time, timedelta

import pytz

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int

ISO_DATE = re.compile(r'\d{4}-\d{2}-\d{2}')
UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'
# The longest window one slots request may name. A full booking horizon (up to 365 days) in one answer would hand out the
# company's whole occupancy and make every request a long calendar search; a month is what a page ever asks for, and the
# requester's page already moves a week at a time.
MAX_SLOT_WINDOW_DAYS = 31
# The window a public slots request gets when it names none: the week the requester's page shows.
PUBLIC_DEFAULT_WINDOW_DAYS = 7
# The most slots one answer lists. A short slot of a long day could still be thousands, and a page draws a day at a
# time; the answer keeps the earliest slots of the window in start order.
MAX_SLOT_ITEMS = 500


def parse_slot_query(args, today, horizon_days, *, max_window_days=MAX_SLOT_WINDOW_DAYS, default_window_days=None):
    """Validate ``from``/``to`` (inclusive YYYY-MM-DD) and the optional ``combination_id`` of a slots request.

    A request without ``from``/``to`` is refused unless ``default_window_days`` gives it a window, which then starts
    today. ``to`` may not pass ``today`` plus the company's booking horizon, and the range may not be longer than
    ``max_window_days``: one answer never lists a whole horizon.
    """
    if default_window_days and 'from' not in args and 'to' not in args:
        first, last = today, today + timedelta(days=default_window_days - 1)
    else:
        first = parse_iso_date(args.get('from'), 'from')
        last = parse_iso_date(args.get('to'), 'to')
    if last < first:
        raise ApiError(422, 'invalid', 'to must not be before from', field='to')
    if max_window_days and (last - first).days + 1 > max_window_days:
        raise ApiError(422, 'invalid', 'ask for at most %d days at a time' % max_window_days, field='to')
    if last > today + timedelta(days=horizon_days):
        raise ApiError(422, 'invalid', 'to is beyond the %d-day booking horizon' % horizon_days, field='to')
    combination_id = parse_positive_int(args['combination_id'], 'combination_id') if 'combination_id' in args else None
    return first, last, combination_id


def parse_iso_date(value, field):
    """A YYYY-MM-DD string as a date; 422 naming ``field`` otherwise."""
    if not value or not ISO_DATE.fullmatch(value):
        raise ApiError(422, 'invalid', 'must be a date as YYYY-MM-DD', field=field)
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ApiError(422, 'invalid', 'must be a real calendar date', field=field) from None


def dump_slot(start, stop):
    """One slot as UTC ISO strings; ``start`` and ``stop`` are timezone-aware datetimes."""
    return {'start': start.strftime(UTC_FORMAT), 'stop': stop.strftime(UTC_FORMAT)}


def parse_type_slot_query(booking_type, args, settings, now, *, max_window_days=MAX_SLOT_WINDOW_DAYS, default_window_days=None):
    """``parse_slot_query`` with today taken in the type's calendar timezone; ``now`` is timezone-aware."""
    return parse_slot_query(args, type_today(booking_type, now), settings['horizon_days'],
                            max_window_days=max_window_days, default_window_days=default_window_days)


def type_today(booking_type, now):
    """Today in the type's calendar timezone; ``now`` is timezone-aware."""
    return now.astimezone(_type_timezone(booking_type)).date()


def last_bookable_date(booking_type, settings, now):
    """The last day a slots request may name: today in the type's calendar timezone plus the booking horizon."""
    return type_today(booking_type, now) + timedelta(days=settings['horizon_days'])


def type_slot_items(booking_type, combination, first, last, settings, now, origin=None, honour_deadline=True):
    """The free slots of ``booking_type`` (on ``combination`` when given) from ``first`` to ``last`` inclusive.

    Only slots a booking route would accept are listed: the same notice and horizon bounds ``parse_start``
    applies. ``origin`` is the booking being rescheduled: the engine then leaves its own meeting out
    of the busy intervals. The engine reads other bookings in the environment of ``booking_type``, so that environment
    decides which of them count as taken.

    The engine's slot search also hides everything inside the type's modification deadline. A requester must keep to
    it; a staff member booking for them does not (``parse_start`` accepts those starts), so staff pass
    ``honour_deadline=False`` and the search runs on an unsaved copy of the type with no deadline.
    """
    tz = _type_timezone(booking_type)
    searched_type = booking_type if honour_deadline else booking_type.new({'modifications_deadline': 0}, origin=booking_type)
    # The engine's public slot search on an unsaved booking, anchored to the type's calendar days.
    booking = booking_type.env['resource.booking'].new({
        'type_id': searched_type.id, 'combination_id': combination.id or False,
    }, origin=origin)
    slots = booking._get_available_slots(
        tz.localize(datetime.combine(first, time.min)),
        tz.localize(datetime.combine(last + timedelta(days=1), time.min)),
    )
    earliest = now + timedelta(hours=settings['min_notice_hours'])
    latest = now + timedelta(days=settings['horizon_days'])
    duration = timedelta(hours=booking.duration)
    starts = sorted(start.astimezone(UTC) for day_slots in slots.values() for start in day_slots)
    bounded = [start for start in starts if earliest <= start <= latest]
    return [dump_slot(start, start + duration) for start in bounded[:MAX_SLOT_ITEMS]]


def require_slot_alignment(start, booking_type):
    """422 on ``start`` unless it falls on the type's slot grid: a whole multiple of ``slot_duration`` from the beginning of
    one of the working-day intervals of that weekday, in the type's own calendar time zone.

    The engine's slot search steps from each interval's start, so a start off the grid would create an uneven schedule and
    overlap the slots it lists. A type with no slot duration, or a day the calendar does not work, accepts any start: the
    engine's own fit check refuses the booking then.
    """
    minutes = round(booking_type.slot_duration * 60)
    if minutes <= 0:
        return
    tz = _type_timezone(booking_type)
    local = pytz.UTC.localize(start).astimezone(tz).replace(tzinfo=None)
    minute_of_day = local.hour * 60 + local.minute
    starts = [
        round(attendance.hour_from * 60) for attendance in booking_type.resource_calendar_id.attendance_ids
        if attendance.dayofweek == str(local.weekday())
    ]
    if starts and not any(minute_of_day >= low and (minute_of_day - low) % minutes == 0 for low in starts):
        raise ApiError(422, 'invalid', 'must fall on a %d-minute slot of this type' % minutes, field='start')


def _type_timezone(booking_type):
    return pytz.timezone(booking_type.resource_calendar_id.tz or 'UTC')
