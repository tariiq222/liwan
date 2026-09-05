# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.nasq_api.controllers.common import ApiError

CREATE_FIELDS = {'name', 'body', 'department_id'}
PATCH_FIELDS = {'name', 'body'}


def _iso(dt):
    return fields.Datetime.to_string(dt).replace(' ', 'T') + 'Z' if dt else None


def dump_document(doc):
    dept = doc.department_id
    return {
        'id': doc.id,
        'name': doc.name,
        'department': {'id': dept.id, 'name': dept.name},
        'body': doc.body or '',
        'attachment_ids': [{
            'id': a.id,
            'name': a.name,
            'mimetype': a.mimetype or '',
            'file_size': a.file_size or 0,
        } for a in doc.attachment_ids],
        'write_date': _iso(doc.write_date),
    }


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', "name must not be empty", field='name')
    return value.strip()


def parse_document_create(payload):
    extra = set(payload) - CREATE_FIELDS
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    if 'department_id' not in payload or not payload.get('department_id'):
        raise ApiError(422, 'invalid', "department_id is required", field='department_id')
    try:
        department_id = int(payload['department_id'])
    except (TypeError, ValueError):
        raise ApiError(422, 'invalid', "department_id must be an integer", field='department_id') from None
    body = payload.get('body')
    if body in (None, False):
        body = ''
    elif not isinstance(body, str):
        raise ApiError(422, 'invalid', "body must be a string", field='body')
    return {
        'name': _parse_name(payload.get('name')),
        'body': body,
        'department_id': department_id,
    }


def parse_document_patch(payload):
    if 'department_id' in payload:
        raise ApiError(422, 'invalid', "department_id cannot be changed", field='department_id')
    vals = {}
    for key, value in payload.items():
        if key not in PATCH_FIELDS:
            raise ApiError(422, 'invalid', f"field {key!r} is not writable", field=key)
        if key == 'name':
            vals['name'] = _parse_name(value)
        elif value in (None, False):
            vals['body'] = ''
        elif not isinstance(value, str):
            raise ApiError(422, 'invalid', "body must be a string", field='body')
        else:
            vals['body'] = value
    return vals
