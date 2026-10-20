# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.assets.common import (
    optional_id,
    optional_text,
    ref,
    reject_unknown,
)
from odoo.addons.webvue_hr.serializers.dates import parse_optional_date

# The exhaustive equipment write whitelists of the route contract.
EQUIPMENT_CREATE_FIELDS = ('name', 'category_id', 'serial_no', 'model', 'warranty_date')
EQUIPMENT_PATCH_FIELDS = EQUIPMENT_CREATE_FIELDS


def dump_equipment(equipment):
    """One asset. ``assign_date`` is the stock custody date, which the stock engine also stamps
    on creation and keeps after a return; it is exposed only while the asset is assigned."""
    return {
        'id': equipment.id,
        'name': equipment.name,
        'category': ref(equipment.category_id),
        'serial_no': equipment.serial_no or '',
        'model': equipment.model or '',
        'employee': ref(equipment.employee_id),
        'assign_date': (fields.Date.to_string(equipment.assign_date) or None) if equipment.employee_id else None,
        'warranty_date': fields.Date.to_string(equipment.warranty_date) or None,
        'scrap_date': fields.Date.to_string(equipment.scrap_date) or None,
        'active': bool(equipment.active),
    }


def dump_equipments(equipments):
    return [dump_equipment(equipment) for equipment in equipments]


def parse_equipment_vals(payload, *, create):
    """Whitelist + coerce an equipment payload into ORM vals."""
    reject_unknown(payload, EQUIPMENT_CREATE_FIELDS if create else EQUIPMENT_PATCH_FIELDS)
    vals = {}
    if create or 'name' in payload:
        name = payload.get('name')
        if not isinstance(name, str) or not name.strip():
            raise ApiError(422, 'invalid', 'name must not be empty', field='name')
        vals['name'] = name.strip()
    if 'category_id' in payload:
        vals['category_id'] = optional_id(payload['category_id'], 'category_id')
    for field in ('serial_no', 'model'):
        if field in payload:
            vals[field] = optional_text(payload[field], field)
    if 'warranty_date' in payload:
        vals['warranty_date'] = parse_optional_date(payload['warranty_date'], 'warranty_date')
    if not vals:
        raise ApiError(422, 'invalid', 'no fields to update')
    return vals


def parse_assign(payload):
    """``(employee id, the extra assignment vals)``; the employee is required, the date optional."""
    reject_unknown(payload, ('employee_id', 'assign_date'))
    if 'employee_id' not in payload:
        raise ApiError(422, 'invalid', 'employee_id is required', field='employee_id')
    vals = {}
    if 'assign_date' in payload:
        vals['assign_date'] = parse_optional_date(payload['assign_date'], 'assign_date')
    return parse_positive_int(payload['employee_id'], 'employee_id'), vals


def parse_archive(payload):
    reject_unknown(payload, ('scrap_date',))
    if 'scrap_date' not in payload:
        return {}
    return {'scrap_date': parse_optional_date(payload['scrap_date'], 'scrap_date')}
