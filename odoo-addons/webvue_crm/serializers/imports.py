# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import binascii

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_crm.models.crm_lead import NAME_MAX
from odoo.addons.webvue_crm.models.intake import (
    FIELDS,
    FILE_TOO_LARGE,
    MAX_BYTES,
    REQUIRED_FIELDS,
    file_error,
)
from odoo.addons.webvue_crm.serializers.opportunity import (
    parse_id_or_null,
    parse_text,
    ref,
)

FILE_FIELDS = ('file_name', 'content_base64')
IMPORT_FIELDS = ('file_name', 'content_base64', 'mapping', 'source_id', 'user_id', 'mapping_profile')
PROFILE_FIELDS = ('name', 'columns')
# Base64 grows the file by a third; anything longer than this cannot decode within the size limit.
MAX_ENCODED = (MAX_BYTES + 2) // 3 * 4


def dump_batch(batch):
    return {
        'id': batch.id,
        'file_name': batch.file_name,
        'user': ref(batch.user_id),
        'source': ref(batch.source_id),
        'created': batch.created_count,
        'duplicate': batch.duplicate_count,
        'invalid': batch.invalid_count,
        'unassigned': batch.unassigned_count,
        'created_at': iso(batch.create_date),
    }


def dump_mapping(profile):
    return {
        'id': profile.id,
        'name': profile.name,
        'columns': {field: profile[f'{field}_column'] or None for field in FIELDS},
    }


def mapping_values(columns):
    """Model values of a ``columns`` map (the keys were checked by ``parse_columns``)."""
    return {f'{field}_column': columns.get(field) or False for field in FIELDS}


def columns_of(profile):
    return {field: profile[f'{field}_column'] for field in FIELDS if profile[f'{field}_column']}


def parse_columns(value, field):
    """The column map ``{name, phone, email?, notes?, package?}``; unset optional columns are dropped."""
    if not isinstance(value, dict):
        raise ApiError(422, 'invalid', 'must be an object', field=field)
    unknown = sorted(set(value) - set(FIELDS))
    if unknown:
        raise ApiError(422, 'invalid', f'{unknown[0]} is not a mappable field', field=field)
    missing = [name for name in REQUIRED_FIELDS if name not in value]
    if missing:
        raise ApiError(422, 'invalid', f'{missing[0]} column is required', field=field)
    return {name: parse_text(column, field, NAME_MAX) for name, column in value.items() if column is not None or name in REQUIRED_FIELDS}


def parse_profile_body(payload):
    _reject_unknown(payload, PROFILE_FIELDS)
    missing = [name for name in PROFILE_FIELDS if name not in payload]
    if missing:
        raise ApiError(422, 'invalid', 'field is required', field=missing[0])
    return {'name': parse_text(payload['name'], 'name', NAME_MAX), 'columns': parse_columns(payload['columns'], 'columns')}


def _reject_unknown(payload, allowed):
    unknown = sorted(set(payload) - set(allowed))
    if unknown:
        raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])


def _parse_file(payload):
    for name in FILE_FIELDS:
        if name not in payload:
            raise ApiError(422, 'invalid', 'field is required', field=name)
    return {
        'file_name': parse_text(payload['file_name'], 'file_name', NAME_MAX),
        'content': _content(payload['content_base64']),
    }


def parse_file_body(payload):
    """The file of a columns request: its name and decoded bytes."""
    _reject_unknown(payload, FILE_FIELDS)
    return _parse_file(payload)


def parse_import_body(payload):
    """Typed values of a preview or import body; ``mapping`` is None when only a profile id came."""
    _reject_unknown(payload, IMPORT_FIELDS)
    parsed = {
        **_parse_file(payload),
        'mapping': parse_columns(payload['mapping'], 'mapping') if payload.get('mapping') is not None else None,
        'source_id': parse_id_or_null(payload.get('source_id'), 'source_id'),
        'user_id': parse_id_or_null(payload.get('user_id'), 'user_id'),
        'mapping_profile': parse_id_or_null(payload.get('mapping_profile'), 'mapping_profile'),
    }
    if parsed['mapping'] is not None and parsed['mapping_profile']:
        raise ApiError(422, 'invalid', 'send a mapping or a mapping profile, not both', field='mapping_profile')
    if parsed['mapping'] is None and not parsed['mapping_profile']:
        raise ApiError(422, 'invalid', 'send a mapping or a mapping profile', field='mapping')
    return parsed


def _content(value):
    if not isinstance(value, str):
        raise ApiError(422, 'invalid', 'must be the base64 text of the file', field='content_base64')
    if len(value) > MAX_ENCODED:
        raise file_error(FILE_TOO_LARGE)
    try:
        return base64.b64decode(value, validate=True)
    except binascii.Error:
        raise ApiError(422, 'invalid', 'must be base64 text', field='content_base64') from None
