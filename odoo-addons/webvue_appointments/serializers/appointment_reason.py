# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_appointments.models.appointment_reason import REASON_KINDS
from odoo.addons.webvue_appointments.serializers.payload import (
    parse_text,
    parse_whole_number,
    reject_unknown,
    require_fields,
)

KINDS = tuple(kind for kind, _label in REASON_KINDS)
SEQUENCE_RANGE = (0, 9999)


def dump_reason(reason):
    return {'id': reason.id, 'kind': reason.kind, 'name': reason.name, 'sequence': reason.sequence, 'active': reason.active}


def dump_reasons(reasons):
    return [dump_reason(reason) for reason in reasons]


def parse_kind(value):
    """A reason kind, 422 on ``kind`` otherwise."""
    if value not in KINDS:
        raise ApiError(422, 'invalid', 'choose one of: %s' % ', '.join(KINDS), field='kind')
    return value


def parse_reason(payload, *, creating):
    """Validate a create or PATCH body into the reason values; ``kind`` is chosen once, on create."""
    reject_unknown(payload, ('kind', 'name', 'sequence') if creating else ('name', 'sequence'))
    if creating:
        require_fields(payload, ('kind', 'name'))
    values = {}
    if 'kind' in payload:
        values['kind'] = parse_kind(payload['kind'])
    if 'name' in payload:
        values['name'] = parse_text(payload['name'], 'name')
    if 'sequence' in payload:
        values['sequence'] = parse_whole_number(payload['sequence'], 'sequence', *SEQUENCE_RANGE)
    return values
