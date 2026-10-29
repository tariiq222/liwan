# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes and request parsing of the invited requester's public routes.

The requester sees only their own booking: the requester's own name, phone and email (the company's
field policies decide which are shown), the type, the time and the company's display name. Never other
bookings, resource users, notes, the national id or any partner id.
"""
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_appointments.serializers.appointment_booking import (
    MINUTES_PER_HOUR,
    parse_start,
    timestamp,
    within_deadline,
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


def dump_guest_booking(booking, settings, now):
    """The requester's view of the booking; ``booking`` is elevated, so everything shown is listed here."""
    requester = booking.partner_ids[:1]
    return {
        'id': booking.id,
        'state': booking.state,
        'type_name': booking.type_id.name,
        'duration_minutes': round(booking.duration * MINUTES_PER_HOUR),
        'location': booking.location or None,
        'start': timestamp(booking.start),
        'stop': timestamp(booking.stop),
        'is_modifiable': is_modifiable(booking, now),
        'company_name': booking.type_id.company_id.name,
        'requester': {
            'name': requester.name or '',
            'phone': (requester.phone or None) if settings['phone_field'] != 'hidden' else None,
            'email': (requester.email or None) if settings['email_field'] != 'hidden' else None,
        },
    }
