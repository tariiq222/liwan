# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_appointments.serializers.payload import (
    parse_id_list,
    reject_unknown,
    require_fields,
)

WRITABLE_FIELDS = ('resource_ids', 'forced_calendar_id')


def dump_combination(combination):
    """Whitelist the wire shape of a resource.booking.combination."""
    return {
        'id': combination.id,
        'name': combination.name,
        'resource_ids': combination.resource_ids.ids,
        'forced_calendar_id': combination.forced_calendar_id.id or None,
        'active': combination.active,
    }


def dump_combinations(combinations):
    return [dump_combination(combination) for combination in combinations]


def parse_combination(payload, *, creating):
    """Validate a create or PATCH body into ``{'resource_ids': ids|None, 'calendar': {'id': id|None}|None}``.

    ``calendar`` is None when the body leaves the forced calendar alone; ``{'id': None}`` clears it.
    """
    reject_unknown(payload, WRITABLE_FIELDS)
    if creating:
        require_fields(payload, ('resource_ids',))
    resource_ids = None
    if 'resource_ids' in payload:
        resource_ids = parse_id_list(payload['resource_ids'], 'resource_ids')
        if not resource_ids:
            raise ApiError(422, 'invalid', 'choose at least one resource', field='resource_ids')
    calendar = None
    if 'forced_calendar_id' in payload:
        value = payload['forced_calendar_id']
        calendar = {'id': None if value is None else parse_positive_int(value, 'forced_calendar_id')}
    return {'resource_ids': resource_ids, 'calendar': calendar}
