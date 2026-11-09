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
    'name', 'duration_minutes', 'slot_minutes', 'own_deadline_hours',
    'location', 'videocall_location', 'resource_calendar_id', 'combination_ids',
)
OWN_DEADLINE = 'own_deadline_hours'


def dump_type(booking_type):
    """Whitelist the wire shape of a resource.booking.type; never send a raw read() result.

    ``modifications_deadline_hours`` is the resolved deadline (the type's own, or its company's setting) that every
    route enforces; ``own_deadline_hours`` is null while the type follows the company (issue #551).
    """
    return _dump_type(booking_type, booking_type._liwan_resolved_deadlines()[booking_type.id])


def dump_types(booking_types):
    deadlines = booking_types._liwan_resolved_deadlines()
    return [_dump_type(booking_type, deadlines[booking_type.id]) for booking_type in booking_types]


def _dump_type(booking_type, deadline_hours):
    combinations = booking_type.combination_rel_ids.sorted('sequence').combination_id.filtered('active')
    return {
        'id': booking_type.id,
        'name': booking_type.name,
        'duration_minutes': round(booking_type.duration * MINUTES_PER_HOUR),
        'slot_minutes': round(booking_type.slot_duration * MINUTES_PER_HOUR),
        'modifications_deadline_hours': round(deadline_hours),
        'own_deadline_hours': None if booking_type.inherits_company_deadline else round(booking_type.own_deadline_hours),
        'location': booking_type.location or None,
        'videocall_location': booking_type.videocall_location or None,
        'resource_calendar_id': booking_type.resource_calendar_id.id,
        'combination_ids': combinations.ids,
        'active': booking_type.active,
    }


def parse_type(payload, *, creating):
    """Validate a create or PATCH body into ``{'values': {...}, 'calendar_id': id|None, 'combination_ids': ids|None}``.

    ``values`` holds ORM fields (minutes already converted to the engine's hours); the two ids are
    relations the controller resolves inside the current company. ``own_deadline_hours`` is the type's own deadline;
    null returns the type to the company's setting.
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
    if OWN_DEADLINE in payload:
        values.update(parse_own_deadline(payload[OWN_DEADLINE]))
    for name in ('location', 'videocall_location'):
        if name in payload:
            values[name] = parse_text(payload[name], name, required=False)
    calendar_id = parse_positive_int(payload['resource_calendar_id'], 'resource_calendar_id') if 'resource_calendar_id' in payload else None
    combination_ids = parse_id_list(payload['combination_ids'], 'combination_ids') if 'combination_ids' in payload else None
    return {'values': values, 'calendar_id': calendar_id, 'combination_ids': combination_ids}


def parse_own_deadline(value):
    """The two stored fields of the deadline: null follows the company, a number is the type's own deadline in hours."""
    if value is None:
        return {'inherits_company_deadline': True, OWN_DEADLINE: 0}
    low, high = INTEGER_RANGES['modification_deadline_hours']
    return {
        'inherits_company_deadline': False,
        OWN_DEADLINE: parse_whole_number(value, OWN_DEADLINE, low, high),
    }
