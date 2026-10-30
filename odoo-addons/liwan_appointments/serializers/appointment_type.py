# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import parse_positive_int
from odoo.addons.liwan_appointments.models.appointment_settings import INTEGER_RANGES
from odoo.addons.liwan_appointments.serializers.payload import (
    parse_id_list,
    parse_text,
    parse_whole_number,
    reject_unknown,
    require_fields,
)

MINUTES_PER_HOUR = 60
MAX_DURATION_MINUTES = 24 * MINUTES_PER_HOUR
WRITABLE_FIELDS = (
    'name', 'duration_minutes', 'slot_minutes', 'modifications_deadline_hours',
    'location', 'videocall_location', 'resource_calendar_id', 'combination_ids',
)


def dump_type(booking_type):
    """Whitelist the wire shape of a resource.booking.type; never send a raw read() result."""
    combinations = booking_type.combination_rel_ids.sorted('sequence').combination_id.filtered('active')
    return {
        'id': booking_type.id,
        'name': booking_type.name,
        'duration_minutes': round(booking_type.duration * MINUTES_PER_HOUR),
        'slot_minutes': round(booking_type.slot_duration * MINUTES_PER_HOUR),
        'modifications_deadline_hours': round(booking_type.modifications_deadline),
        'location': booking_type.location or None,
        'videocall_location': booking_type.videocall_location or None,
        'resource_calendar_id': booking_type.resource_calendar_id.id,
        'combination_ids': combinations.ids,
        'active': booking_type.active,
    }


def dump_types(booking_types):
    return [dump_type(booking_type) for booking_type in booking_types]


def parse_type(payload, *, creating):
    """Validate a create or PATCH body into ``{'values': {...}, 'calendar_id': id|None, 'combination_ids': ids|None}``.

    ``values`` holds ORM fields (minutes already converted to the engine's hours); the two ids are
    relations the controller resolves inside the current company.
    """
    reject_unknown(payload, WRITABLE_FIELDS)
    if creating:
        require_fields(payload, ('name',))
    values = {}
    if 'name' in payload:
        values['name'] = parse_text(payload['name'], 'name')
    if 'duration_minutes' in payload:
        minutes = parse_whole_number(payload['duration_minutes'], 'duration_minutes', 1, MAX_DURATION_MINUTES)
        values['duration'] = minutes / MINUTES_PER_HOUR
    if 'slot_minutes' in payload:
        low, high = INTEGER_RANGES['default_slot_minutes']
        values['slot_duration'] = parse_whole_number(payload['slot_minutes'], 'slot_minutes', low, high) / MINUTES_PER_HOUR
    if 'modifications_deadline_hours' in payload:
        low, high = INTEGER_RANGES['modification_deadline_hours']
        values['modifications_deadline'] = parse_whole_number(
            payload['modifications_deadline_hours'], 'modifications_deadline_hours', low, high,
        )
    for name in ('location', 'videocall_location'):
        if name in payload:
            values[name] = parse_text(payload[name], name, required=False)
    calendar_id = parse_positive_int(payload['resource_calendar_id'], 'resource_calendar_id') if 'resource_calendar_id' in payload else None
    combination_ids = parse_id_list(payload['combination_ids'], 'combination_ids') if 'combination_ids' in payload else None
    return {'values': values, 'calendar_id': calendar_id, 'combination_ids': combination_ids}
