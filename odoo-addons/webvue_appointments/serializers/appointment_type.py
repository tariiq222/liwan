# Part of Odoo. See LICENSE file for full copyright and licensing details.
MINUTES_PER_HOUR = 60


def dump_type(booking_type):
    """Whitelist the wire shape of a resource.booking.type; never send a raw read() result."""
    return {
        'id': booking_type.id,
        'name': booking_type.name,
        'duration_minutes': round(booking_type.duration * MINUTES_PER_HOUR),
    }


def dump_types(booking_types):
    return [dump_type(booking_type) for booking_type in booking_types]
