# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_pmo.models.project_charter_reference import (
    normalize_charter_steps,
)

CATALOG_RESOURCES = {
    'types': 'liwan.project.type',
    'owning-units': 'liwan.project.owning.unit',
}
CATALOG_WRITE_FIELDS = {'name', 'sequence', 'active'}
# Only project types carry charter steps; owning units reject the key.
TYPE_ONLY_FIELDS = {'charter_steps'}


def dump_catalog_item(record):
    item = {
        'id': record.id,
        'name': record.name,
        'sequence': record.sequence,
        'active': bool(record.active),
    }
    if record._name == 'liwan.project.type':
        item['charter_steps'] = record._liwan_charter_steps()
    return item


def _writable_fields(resource, base):
    return base | TYPE_ONLY_FIELDS if resource == 'types' else base


def parse_catalog_create(payload, resource='owning-units'):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "body must be an object")
    unknown = set(payload) - _writable_fields(resource, {'name', 'sequence'})
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f"field {field!r} is not writable", field=field)
    if 'name' not in payload:
        raise ApiError(422, 'invalid', "name must not be empty", field='name')
    vals = {'name': _parse_name(payload['name'])}
    if 'sequence' in payload:
        vals['sequence'] = _parse_sequence(payload['sequence'])
    if 'charter_steps' in payload:
        vals['charter_steps'] = _parse_charter_steps(payload['charter_steps'])
    return vals


def parse_catalog_patch(payload, resource='owning-units'):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', "body must be an object")
    unknown = set(payload) - _writable_fields(resource, CATALOG_WRITE_FIELDS)
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
    if 'charter_steps' in payload:
        vals['charter_steps'] = _parse_charter_steps(payload['charter_steps'])
    return vals


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', "name must not be empty", field='name')
    return value.strip()


def _parse_sequence(value):
    if not isinstance(value, int) or isinstance(value, bool):
        raise ApiError(422, 'invalid', "sequence must be an integer", field='sequence')
    return value


def _parse_charter_steps(value):
    if not isinstance(value, list):
        raise ApiError(422, 'invalid', "charter_steps must be a list of step keys", field='charter_steps')
    try:
        return normalize_charter_steps(value)
    except (TypeError, ValueError) as error:
        raise ApiError(422, 'invalid', str(error), field='charter_steps') from error
