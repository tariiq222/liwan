# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo.addons.nasq_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.nasq_api.serializers.common import iso

CREATE_FIELDS = {'name', 'body', 'department_id'}
PATCH_FIELDS = {'name', 'body'}
UPLOAD_FIELDS = {'name', 'datas', 'mimetype'}
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
# Four base64 characters encode three bytes. This is the largest canonical
# base64 representation that can contain exactly MAX_ATTACHMENT_BYTES.
MAX_ENCODED_CHARS = 4 * ((MAX_ATTACHMENT_BYTES + 2) // 3)


def dump_document(doc):
    return {
        'id': doc.id,
        'name': doc.name,
        'department': doc._nasq_department_ref(),
        'body': doc.body or '',
        'attachment_ids': [{
            'id': a.id,
            'name': a.name,
            'mimetype': a.mimetype or '',
            'file_size': a.file_size or 0,
        } for a in doc.attachment_ids],
        'write_date': iso(doc.write_date),
    }


def _parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', "name must not be empty", field='name')
    return value.strip()


def _parse_department_id(value, *, required=True):
    """Coerce a department id. Missing/empty is optional unless required=True."""
    if value is None or value is False or (isinstance(value, str) and not value):
        if required:
            raise ApiError(422, 'invalid', "department_id is required", field='department_id')
        return False
    return parse_positive_int(value, 'department_id')


def parse_document_create(payload):
    extra = set(payload) - CREATE_FIELDS
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    if 'department_id' not in payload:
        raise ApiError(422, 'invalid', "department_id is required", field='department_id')
    department_id = _parse_department_id(payload['department_id'])
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


def parse_attachment_upload(payload):
    extra = set(payload) - UPLOAD_FIELDS
    if extra:
        field = sorted(extra)[0]
        raise ApiError(422, 'invalid', f"field {field!r} is not writable", field=field)
    datas = payload.get('datas')
    if not isinstance(datas, str) or not datas.strip():
        raise ApiError(422, 'invalid', "datas is required", field='datas')
    cleaned = ''.join(datas.split())
    if len(cleaned) > MAX_ENCODED_CHARS:
        raise ApiError(422, 'invalid', "attachment exceeds 10MB", field='datas')
    try:
        raw = base64.b64decode(cleaned, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(422, 'invalid', "datas must be valid base64", field='datas') from None
    if len(raw) > MAX_ATTACHMENT_BYTES:
        raise ApiError(422, 'invalid', "attachment exceeds 10MB", field='datas')
    mimetype = payload.get('mimetype')
    if mimetype in (None, False, ''):
        mimetype = False
    elif not isinstance(mimetype, str):
        raise ApiError(422, 'invalid', "mimetype must be a string", field='mimetype')
    return {
        'name': _parse_name(payload.get('name')),
        'datas': cleaned,
        'mimetype': mimetype,
    }
