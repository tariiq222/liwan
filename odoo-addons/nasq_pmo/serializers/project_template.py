# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo.addons.nasq_api.controllers.common import ApiError
from odoo.addons.nasq_pmo.models.project_template import validate_template_definition
from odoo.addons.nasq_pmo.serializers.project import dump_project_detail

TEMPLATE_FIELDS = {'name', 'description', 'definition'}


def dump_project_template(template):
    return {
        'id': template.id,
        'name': template.name,
        'description': template.description or '',
        'definition': template.definition,
        'can_manage': bool(template._nasq_can_manage()),
        'can_apply': bool(template._nasq_can_apply()),
    }


def parse_project_template_vals(payload, *, partial=False):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', 'body must be an object')
    unknown = set(payload) - TEMPLATE_FIELDS
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f'field {field!r} is not writable', field=field)
    if not partial and 'name' not in payload:
        raise ApiError(422, 'invalid', 'name is required', field='name')
    if not partial and 'definition' not in payload:
        raise ApiError(422, 'invalid', 'definition is required', field='definition')
    values = {}
    if 'name' in payload:
        name = payload['name']
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 255:
            raise ApiError(422, 'invalid', 'name must be a non-empty string of at most 255 characters', field='name')
        values['name'] = name.strip()
    if 'description' in payload:
        if not isinstance(payload['description'], str):
            raise ApiError(422, 'invalid', 'description must be a string', field='description')
        values['description'] = payload['description'] or ''
    if 'definition' in payload:
        try:
            values['definition'] = validate_template_definition(payload['definition'])
        except Exception as error:
            if isinstance(error, ApiError):
                raise
            raise ApiError(422, 'invalid', str(error), field='definition') from error
    if not values:
        raise ApiError(422, 'invalid', 'no fields to update')
    return values


def parse_project_template_apply(payload):
    if not isinstance(payload, dict):
        raise ApiError(422, 'invalid', 'body must be an object')
    unknown = set(payload) - {'name', 'start_date'}
    if unknown:
        field = sorted(unknown)[0]
        raise ApiError(422, 'unknown_field', f'field {field!r} is not writable', field=field)
    name = payload.get('name')
    start_date = payload.get('start_date')
    if not isinstance(name, str) or not name.strip():
        raise ApiError(422, 'invalid', 'name must not be empty', field='name')
    if not isinstance(start_date, str):
        raise ApiError(422, 'invalid', 'start_date must be a YYYY-MM-DD date', field='start_date')
    try:
        parsed = date.fromisoformat(start_date)
    except ValueError as error:
        raise ApiError(422, 'invalid', 'start_date must be a YYYY-MM-DD date', field='start_date') from error
    if parsed.isoformat() != start_date:
        raise ApiError(422, 'invalid', 'start_date must be a YYYY-MM-DD date', field='start_date')
    return name.strip(), parsed


def dump_applied_project(project):
    return dump_project_detail(project)
