# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes and request parsing of the invited requester's public routes.

The requester sees only their own booking: the requester's own name, phone and email (the company's
field policies decide which are shown), the type, the time and the company's display name. Never other
bookings, resource users, notes, the national id or any partner id.
"""
from datetime import UTC

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_appointments.serializers.appointment_booking import (
    MINUTES_PER_HOUR,
    parse_start,
    timestamp,
    within_deadline,
)
from odoo.addons.liwan_appointments.serializers.appointment_slot import (
    last_bookable_date,
    type_today,
)


def reject_unknown_fields(names, allowed):
    """422 ``unknown_field`` naming the first of ``names`` that is not in ``allowed``."""
    unknown = sorted(set(names) - set(allowed))
    if unknown:
        raise ApiError(422, 'unknown_field', 'field %r is not accepted' % unknown[0], field=unknown[0])


def parse_guest_start(payload, settings, now):
    """The ``start`` of a schedule body (after ``reject_unknown_fields``) as a naive UTC datetime."""
    if 'start' not in payload:
        raise ApiError(422, 'invalid', 'field is required', field='start')
    return parse_start(payload['start'], settings, now)


def is_modifiable(booking, now):
    """Whether the requester may still change the booking: no manager bypass applies to them."""
    return not booking.meeting_id or within_deadline(booking, now)


def awaits_confirmation(booking):
    """Whether the scheduled booking waits for the requester's confirmation. A booking that scheduling already
    confirms does not, whatever the company setting says: the payments bridge confirms a paying booking on schedule
    and the engine then holds it until its order is paid."""
    return booking.state == 'scheduled' and not booking._liwan_confirms_on_schedule()


def dump_guest_booking(booking, settings, now):
    """The requester's view of the booking; ``booking`` is elevated, so everything shown is listed here.

    ``now`` is a naive UTC datetime. ``first_bookable_date`` and ``last_bookable_date`` are the calendar days of the
    type that a slots request may name, and ``awaits_confirmation`` whether the page should offer the confirm action.
    """
    requester = booking.partner_ids[:1]
    aware_now = now.replace(tzinfo=UTC)
    return {
        'id': booking.id,
        'state': booking.state,
        'type_name': booking.type_id.name,
        'duration_minutes': round(booking.duration * MINUTES_PER_HOUR),
        'location': booking.location or None,
        'start': timestamp(booking.start),
        'stop': timestamp(booking.stop),
        'is_modifiable': is_modifiable(booking, now),
        'first_bookable_date': type_today(booking.type_id, aware_now).isoformat(),
        'last_bookable_date': last_bookable_date(booking.type_id, settings, aware_now).isoformat(),
        'awaits_confirmation': awaits_confirmation(booking),
        'company_name': booking.type_id.company_id.name,
        'requester': {
            'name': requester.name or '',
            'phone': (requester.phone or None) if settings['phone_field'] != 'hidden' else None,
            'email': (requester.email or None) if settings['email_field'] != 'hidden' else None,
        },
    }
