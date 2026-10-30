# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import parse_positive_int
from odoo.addons.liwan_appointments.serializers.payload import (
    parse_text,
    reject_unknown,
    require_fields,
)

WRITABLE_FIELDS = ('name', 'calendar_id')
RESOURCE_TYPES = ('user', 'material')


def dump_resource(resource):
    """Whitelist the wire shape of a resource.resource; employee resources expose no user or HR data."""
    return {
        'id': resource.id,
        'name': resource.name,
        'type': resource.resource_type,
        'calendar_id': resource.calendar_id.id or None,
        'active': resource.active,
    }


def dump_resources(resources):
    return [dump_resource(resource) for resource in resources]


def parse_resource(payload, *, creating):
    """Validate a create or PATCH body into ``{'values': {'name'?}, 'calendar_id': id|None}``."""
    reject_unknown(payload, WRITABLE_FIELDS)
    if creating:
        require_fields(payload, ('name',))
    values = {'name': parse_text(payload['name'], 'name')} if 'name' in payload else {}
    calendar_id = parse_positive_int(payload['calendar_id'], 'calendar_id') if 'calendar_id' in payload else None
    return {'values': values, 'calendar_id': calendar_id}
