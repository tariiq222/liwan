# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import fields
from odoo.exceptions import AccessError

from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.common import iso

CREATE_FIELDS = {'name', 'body', 'expiry_date', 'context', 'tag_ids'}
PATCH_FIELDS = CREATE_FIELDS | {'expected_revision'}
MISSING = object()


def strict(payload, allowed):
    extra = set(payload) - allowed
    if extra:
        key = sorted(extra)[0]
        raise ApiError(422, 'invalid', 'field is not writable', field=key)


def positive(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ApiError(422, 'invalid', 'positive integer is required', field=field)
    return value


def parse_revision(payload, *, only=False):
    if only:
        strict(payload, {'expected_revision'})
    return positive(payload.get('expected_revision'), 'expected_revision')


def parse_name(value):
    if not isinstance(value, str) or not value.strip():
        raise ApiError(422, 'invalid', 'name must not be empty', field='name')
    return value.strip()


def parse_context(value):
    if value is None:
        return None
    if (
        not isinstance(value, dict)
        or set(value) != {'kind', 'id'}
        or not isinstance(value.get('kind'), str)
        or not value['kind'].strip()
    ):
        raise ApiError(
            422, 'invalid', 'context must be a registered kind and id', field='context',
        )
    return {'kind': value['kind'], 'id': positive(value['id'], 'context.id')}


def parse_tags(env, value):
    if (
        not isinstance(value, list)
        or any(isinstance(i, bool) or not isinstance(i, int) or i < 1 for i in value)
        or len(set(value)) != len(value)
    ):
        raise ApiError(
            422, 'invalid', 'tag_ids must be unique positive integers', field='tag_ids',
        )
    tags = env['dms.tag'].with_context(active_test=False).search([('id', 'in', value)])
    if set(tags.ids) != set(value):
        raise ApiError(
            422, 'invalid', 'tag_ids must belong to this company', field='tag_ids',
        )
    return value


def parse_values(env, payload, *, patch=False):
    strict(payload, PATCH_FIELDS if patch else CREATE_FIELDS)
    values = {
        key: value for key, value in payload.items() if key != 'expected_revision'
    }
    if patch and not values:
        raise ApiError(422, 'invalid', 'at least one changed field is required')
    if 'name' in values or not patch:
        values['name'] = parse_name(values.get('name'))
    if 'body' in values and not isinstance(values['body'], str):
        raise ApiError(422, 'invalid', 'body must be a string', field='body')
    if 'expiry_date' in values:
        value = values['expiry_date']
        if value is None:
            values['expiry_date'] = False
        else:
            if not isinstance(value, str) or len(value) != 10:
                raise ApiError(422, 'invalid', 'expiry_date must be YYYY-MM-DD or null', field='expiry_date')
            try:
                values['expiry_date'] = date.fromisoformat(value)
            except ValueError:
                raise ApiError(
                    422,
                    'invalid',
                    'expiry_date must be YYYY-MM-DD or null',
                    field='expiry_date',
                ) from None
    if 'context' in values:
        values['context'] = parse_context(values['context'])
    if 'tag_ids' in values:
        values['tag_ids'] = parse_tags(env, values['tag_ids'])
    return values


def dump_tag(tag):
    return {'id': tag.id, 'name': tag.name}


def dump_file(document, file, *, editable, archivable):
    lock_owner = not file.locked_by or file.locked_by.id == document.env.uid
    return {
        'id': file.id,
        'name': file.name,
        'mimetype': file.mimetype or 'application/octet-stream',
        'file_size': int(file.size or 0),
        'active': file.active,
        'is_locked': bool(file.locked_by),
        'is_lock_editor': file.locked_by.id == document.env.uid,
        'download_url': f'/api/v1/documents/{document.id}/files/{file.id}/download',
        'allowed_actions': {
            'archive': bool(file.active and archivable and lock_owner),
            'restore': bool(not file.active and archivable and lock_owner),
            'lock': bool(file.active and editable and not file.locked_by),
            'unlock': bool(file.active and editable and file.locked_by and lock_owner),
        },
    }


def dump_summary(document, *, file_count=None, permissions=None, context=MISSING):
    if permissions is None:
        permissions = document._liwan_permissions()[document.id]
    if not permissions['read']:
        msg = 'document access is forbidden'
        raise AccessError(msg)
    env = document.env
    directory = document.directory_id
    editable = permissions['write']
    archivable = permissions['archive']
    return {
        'id': document.id,
        'name': document.name,
        'visibility': document.visibility,
        'active': document.active,
        'expiry_date': fields.Date.to_string(document.expiry_date) or None,
        'write_date': iso(document.write_date),
        'revision': document.revision,
        'file_count': (file_count if file_count is not None else env['dms.file'].search_count(
            [('directory_id', '=', directory.id), ('active', '=', True)],
        )),
        'tags': [
            dump_tag(tag) for tag in directory.with_context(active_test=False).tag_ids
        ],
        'context': env['liwan.document.links']._liwan_dump_context(document) if context is MISSING else context,
        'allowed_actions': {
            'update': editable,
            'archive': bool(document.active and archivable),
            'restore': bool(not document.active and archivable),
            'upload_file': editable,
            'manage_access': permissions['access'],
        },
    }


def dump_summaries(documents, file_counts):
    permissions = documents._liwan_permissions()
    contexts = documents.env['liwan.document.links']._liwan_dump_contexts(documents)
    return [dump_summary(document, file_count=file_counts.get(document.directory_id.id, 0),
                         permissions=permissions[document.id], context=contexts[document.id])
            for document in documents]


def dump_detail(document):
    return {**dump_summary(document), 'body': document.body or ''}


def dump_files(document, *, limit, offset, q=None):
    document._liwan_require('read')
    domain = [('directory_id', '=', document.directory_id.id)]
    if not document.env['liwan.access.service']._liwan_has_capability(
        document.env.user, 'documents.items.archive',
    ):
        domain.append(('active', '=', True))
    if q:
        domain.append(('name', 'ilike', q))
    model = document.env['dms.file'].with_context(active_test=False)
    files = model.search(domain, order='name,id', limit=limit, offset=offset)
    editable = document._liwan_can('write')
    archivable = document._liwan_can('archive')
    return {
        'items': [dump_file(document, file, editable=editable, archivable=archivable) for file in files],
        'total': model.search_count(domain),
        'revision': document.revision,
    }
