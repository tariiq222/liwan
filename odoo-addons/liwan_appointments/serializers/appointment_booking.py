# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes and request parsing of the staff booking routes.

The requester of a booking is one ``res.partner`` (the engine's ``partner_ids``). A request names an
existing partner (``requester_id``) or sends ``requester`` (name, phone, email) to create one in the
current company. ``national_id`` and ``notes`` belong to the booking, not the partner, and are sent
beside the requester in both forms. The company's field policies (``phone_field``, ``email_field``,
``national_id_field``, ``notes_field``: required, optional or hidden) decide which of these are
accepted. ``requester_confirmation`` is enforced by the controller: while it is true a booking that
staff schedule stays ``scheduled`` until confirmed; while it is false staff scheduling confirms it.
"""
import re
from datetime import UTC, datetime, timedelta

from odoo.tools import email_normalize, html2plaintext, plaintext2html

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.liwan_appointments.models.resource_booking import (
    ATTENDANCE_OUTCOMES,
)
from odoo.addons.liwan_appointments.serializers.appointment_slot import (
    UTC_FORMAT,
    parse_iso_date,
)
from odoo.addons.liwan_appointments.serializers.payload import (
    MAX_TEXT_LENGTH,
    parse_text,
    reject_unknown,
    require_fields,
)

BOOKING_STATES = ('pending', 'scheduled', 'confirmed', 'canceled')
MINUTES_PER_HOUR = 60
MAX_NOTES_LENGTH = 2000
MAX_NATIONAL_ID_LENGTH = 32
UTC_TIMESTAMP = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')
PHONE = re.compile(r'\+?[0-9 ()\-]+')
PHONE_LENGTH = (5, 32)
TRUE_FALSE = ('true', 'false')
CREATE_FIELDS = (
    'type_id', 'combination_id', 'requester_id', 'requester', 'national_id', 'notes', 'start', 'walk_in', 'visit_reason_id',
)
REQUESTER_FIELDS = ('name', 'phone', 'email')


def timestamp(value):
    return value.strftime(UTC_FORMAT) if value else None


def dump_booking_row(booking):
    """The list row of a booking; the only requester data is the display name."""
    return {
        'id': booking.id,
        'reference': booking.liwan_reference or None,
        'state': booking.state,
        'attendance': booking.liwan_attendance or None,
        'walk_in': booking.liwan_walk_in,
        'type_id': booking.type_id.id,
        'type_name': booking.type_id.name,
        'combination_id': booking.combination_id.id or None,
        'start': timestamp(booking.start),
        'stop': timestamp(booking.stop),
        'duration_minutes': round(booking.duration * MINUTES_PER_HOUR),
        'requester_name': booking.partner_ids[:1].name or '',
    }


def dump_booking_rows(bookings):
    return [dump_booking_row(booking) for booking in bookings]


def within_deadline(booking, now):
    """Whether ``now`` (naive UTC) is not past the type's modification deadline, with no manager bypass.

    The engine's ``is_modifiable`` computes the same rule but bypasses it for ``group_manager``, a group
    that aggregates across companies, so the controller adds its own current-company bypass.
    """
    if not booking.start:
        return True
    return now <= booking.start - timedelta(hours=booking.type_id.modifications_deadline)


def dump_reason_ref(reason):
    return {'id': reason.id, 'name': reason.name} if reason else None


def dump_booking(booking, *, is_modifiable, sees_contact, national_id_hidden):
    """The detail shape: the row plus the requester, national id, notes, reasons and whether the caller may modify it.

    The requester's phone, email and the national id are only for callers who book (``sees_contact``); the
    national id is also withheld while the company policy hides that field.
    """
    requester = booking.partner_ids[:1]
    return {
        **dump_booking_row(booking),
        'requester': {
            'id': requester.id, 'name': requester.name or '',
            'phone': (requester.phone or None) if sees_contact else None,
            'email': (requester.email or None) if sees_contact else None,
        },
        'national_id': (booking.liwan_requester_national_id or None) if sees_contact and not national_id_hidden else None,
        'notes': html2plaintext(booking.description).strip() or None if booking.description else None,
        'visit_reason': dump_reason_ref(booking.liwan_visit_reason_id),
        'cancel_reason': dump_reason_ref(booking.liwan_cancel_reason_id),
        'is_modifiable': is_modifiable,
    }


def parse_booking_query(args):
    """Validate the list filters into ``{'state', 'type_id', 'resource_id', 'first', 'last', 'mine'}`` (None when absent)."""
    state = args.get('state')
    if state is not None and state not in BOOKING_STATES:
        raise ApiError(422, 'invalid', 'choose one of: %s' % ', '.join(BOOKING_STATES), field='state')
    mine = args.get('mine')
    if mine is not None and mine not in TRUE_FALSE:
        raise ApiError(422, 'invalid', 'must be true or false', field='mine')
    first = parse_iso_date(args['from'], 'from') if 'from' in args else None
    last = parse_iso_date(args['to'], 'to') if 'to' in args else None
    if first and last and last < first:
        raise ApiError(422, 'invalid', 'to must not be before from', field='to')
    return {
        'state': state,
        'type_id': parse_positive_int(args['type_id'], 'type_id') if 'type_id' in args else None,
        'resource_id': parse_positive_int(args['resource_id'], 'resource_id') if 'resource_id' in args else None,
        'first': first,
        'last': last,
        'mine': mine == 'true',
    }


def parse_start(value, settings, now, field='start'):
    """A UTC ``YYYY-MM-DDTHH:MM:SSZ`` string as a naive UTC datetime, at least ``min_notice_hours`` ahead and within ``horizon_days``."""
    if not isinstance(value, str) or not UTC_TIMESTAMP.fullmatch(value):
        raise ApiError(422, 'invalid', 'must be a UTC timestamp as YYYY-MM-DDTHH:MM:SSZ', field=field)
    try:
        start = datetime.strptime(value, UTC_FORMAT)
    except ValueError:
        raise ApiError(422, 'invalid', 'must be a real UTC timestamp', field=field) from None
    now = now.astimezone(UTC).replace(tzinfo=None)
    if start < now + timedelta(hours=settings['min_notice_hours']):
        raise ApiError(422, 'invalid', 'must be at least %d hours from now' % settings['min_notice_hours'], field=field)
    if start > now + timedelta(days=settings['horizon_days']):
        raise ApiError(422, 'invalid', 'must be within %d days from now' % settings['horizon_days'], field=field)
    return start


def parse_booking_create(payload, settings, now):
    """Validate a create body into the values the controller resolves inside the current company.

    Returns ``type_id``, ``combination_id`` (or None), ``requester_id`` or ``requester`` (the other is None),
    ``national_id``, ``notes`` and ``visit_reason_id`` (False when absent), ``start`` (None for a pending invitation)
    and ``walk_in``. A walk-in starts now (to the minute) and skips the notice and horizon limits of ``start``.
    """
    reject_unknown(payload, CREATE_FIELDS)
    require_fields(payload, ('type_id',))
    if ('requester_id' in payload) == ('requester' in payload):
        raise ApiError(422, 'invalid', 'send exactly one of requester_id and requester', field='requester')
    walk_in = _parse_walk_in(payload, settings)
    return {
        'type_id': parse_positive_int(payload['type_id'], 'type_id'),
        'combination_id': parse_positive_int(payload['combination_id'], 'combination_id') if 'combination_id' in payload else None,
        'requester_id': parse_positive_int(payload['requester_id'], 'requester_id') if 'requester_id' in payload else None,
        'requester': _parse_requester(payload['requester'], settings) if 'requester' in payload else None,
        'national_id': _policy_value(payload, 'national_id', settings, 'national_id', parse_national_id),
        'notes': _policy_value(payload, 'notes', settings, 'notes', parse_notes),
        'visit_reason_id': _parse_visit_reason(payload, settings),
        'start': _walk_in_start(now) if walk_in else (parse_start(payload['start'], settings, now) if 'start' in payload else None),
        'walk_in': walk_in,
    }


def parse_booking_patch(payload, settings):
    """Validate a PATCH body into ``{'visit_reason_id': id|False}``; the visit reason is the only editable field."""
    reject_unknown(payload, ('visit_reason_id',))
    require_fields(payload, ('visit_reason_id',))
    return {
        'visit_reason_id': _parse_visit_reason(payload, settings),
    }


def parse_booking_cancel(payload, settings):
    """Validate a cancel body into ``{'reason_id': id|None}``; the reason is required while ``cancel_reason_required`` is on."""
    reject_unknown(payload, ('reason_id',))
    if payload.get('reason_id') is None:
        if settings['cancel_reason_required']:
            raise ApiError(422, 'invalid', 'field is required', field='reason_id')
        return {'reason_id': None}
    return {'reason_id': parse_positive_int(payload['reason_id'], 'reason_id')}


def parse_attendance(payload):
    """Validate an attendance body into the outcome to record."""
    reject_unknown(payload, ('outcome',))
    require_fields(payload, ('outcome',))
    outcomes = tuple(value for value, _label in ATTENDANCE_OUTCOMES)
    if payload['outcome'] not in outcomes:
        raise ApiError(422, 'invalid', 'choose one of: %s' % ', '.join(outcomes), field='outcome')
    return payload['outcome']


def parse_booking_schedule(payload, settings, now):
    """Validate a schedule body into ``{'start': datetime, 'combination_id': id|None}``."""
    reject_unknown(payload, ('start', 'combination_id'))
    require_fields(payload, ('start',))
    return {
        'start': parse_start(payload['start'], settings, now),
        'combination_id': parse_positive_int(payload['combination_id'], 'combination_id') if 'combination_id' in payload else None,
    }


def requester_values(parsed, company_id):
    """The ``res.partner`` values of a new requester."""
    requester = parsed['requester']
    return {
        'name': requester['name'], 'phone': requester['phone'], 'email': requester['email'], 'company_id': company_id,
    }


def check_partner_contact(partner, settings):
    """422 on ``requester_id`` when a contact field the company requires is missing on the existing partner."""
    for name in ('phone', 'email'):
        if settings['%s_field' % name] == 'required' and not partner[name]:
            raise ApiError(422, 'invalid', 'the requester has no %s' % name, field='requester_id')


def booking_values(parsed):
    """The ``resource.booking`` values of the booking-level request fields."""
    return {
        'liwan_requester_national_id': parsed['national_id'],
        'description': plaintext2html(parsed['notes']) if parsed['notes'] else False,
    }


def parse_national_id(value, field):
    return parse_text(value, field, max_length=MAX_NATIONAL_ID_LENGTH)


def parse_notes(value, field):
    return parse_text(value, field, max_length=MAX_NOTES_LENGTH)


def _parse_phone(value, field):
    value = parse_text(value, field)
    if not PHONE_LENGTH[0] <= len(value) <= PHONE_LENGTH[1] or not PHONE.fullmatch(value):
        raise ApiError(422, 'invalid', 'must be a phone number', field=field)
    return value


def _parse_email(value, field):
    value = parse_text(value, field)
    if not email_normalize(value) or len(value) > MAX_TEXT_LENGTH:
        raise ApiError(422, 'invalid', 'must be an email address', field=field)
    return value


def _parse_requester(value, settings):
    if not isinstance(value, dict):
        raise ApiError(422, 'invalid', 'must be an object', field='requester')
    unknown = sorted(set(value) - set(REQUESTER_FIELDS))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field='requester.%s' % unknown[0])
    if 'name' not in value:
        raise ApiError(422, 'invalid', 'field is required', field='requester.name')
    return {
        'name': parse_text(value['name'], 'requester.name'),
        'phone': _policy_value(value, 'phone', settings, 'requester.phone', _parse_phone),
        'email': _policy_value(value, 'email', settings, 'requester.email', _parse_email),
    }


def _parse_walk_in(payload, settings):
    walk_in = payload.get('walk_in', False)
    if type(walk_in) is not bool:
        raise ApiError(422, 'invalid', 'must be true or false', field='walk_in')
    if walk_in and not settings['walk_in_allowed']:
        raise ApiError(422, 'invalid', 'walk-ins are not allowed by the appointment settings', field='walk_in')
    if walk_in and 'start' in payload:
        raise ApiError(422, 'invalid', 'a walk-in starts now', field='start')
    return walk_in


def _parse_visit_reason(payload, settings):
    return _policy_value(payload, 'visit_reason', settings, 'visit_reason_id', parse_positive_int, key='visit_reason_id')


def _walk_in_start(now):
    """``now`` as a naive UTC datetime rounded down to the minute."""
    return now.astimezone(UTC).replace(second=0, microsecond=0, tzinfo=None)


def _policy_value(source, name, settings, field, parse, *, key=None):
    """The parsed value of ``key`` (default ``name``) under the company field policy of ``name``, or False when optional and blank."""
    key = key or name
    policy = settings['%s_field' % name]
    if policy == 'hidden':
        if key in source:
            raise ApiError(422, 'invalid', 'field is hidden by the appointment settings', field=field)
        return False
    value = source.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        if policy == 'required':
            raise ApiError(422, 'invalid', 'field is required', field=field)
        return False
    return parse(value, field)
