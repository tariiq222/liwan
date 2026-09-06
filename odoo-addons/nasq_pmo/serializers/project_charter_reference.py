# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.nasq_api.controllers.common import ApiError

CATALOG_RESOURCES = {
    'types': 'nasq.project.type',
    'owning-units': 'nasq.project.owning.unit',
}
CATALOG_WRITE_FIELDS = {'name', 'sequence', 'active'}


def dump_catalog_item(record):
    return {
        'id': record.id,
        'name': record.name,
        'sequence': record.sequence,
        'active': bool(record.active),
    }


def parse_catalog_create(payload):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "body must be an object")
    unknown = set(payload) - {'name', 'sequence'}
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    if 'name' not in payload:
        raise ApiError(422, 'invalid', "name must not be empty", field='name')
    vals = {'name': _parse_name(payload['name'])}
    if 'sequence' in payload:
        vals['sequence'] = _parse_sequence(payload['sequence'])
    return vals


def parse_catalog_patch(payload):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "body must be an object")
    unknown = set(payload) - CATALOG_WRITE_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    if not payload:
        raise ApiError(422, 'invalid', "no fields to update")
    vals = {}
    if 'name' in payload:
        vals['name'] = _parse_name(payload['name'])
    if 'sequence' in payload:
        vals['sequence'] = _parse_sequence(payload['sequence'])
    if 'active' in payload:
        if not isinstance(payload['active'], bool):
            raise ApiError(422, 'invalid', "active must be a boolean", field='active')
        vals['active'] = payload['active']
    return vals


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', "name must not be empty", field='name')
    return value.strip()


def _parse_sequence(value):
    if not isinstance(value, int) or isinstance(value, bool):
        raise ApiError(422, 'invalid', "sequence must be an integer", field='sequence')
    return value
