# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import unicodedata
from datetime import timedelta
from urllib.parse import quote

from odoo import fields
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    parse_nonneg_int,
    parse_positive_int,
)
from odoo.addons.liwan_document_service.serializers.document import (
    dump_detail,
    dump_files,
    dump_summaries,
    parse_revision,
    strict,
)
from odoo.addons.liwan_document_service.serializers.document_access import (
    dump_grants,
    parse_access,
)


def require(capability):
    request.env['liwan.access.service']._liwan_require_capability(capability)


def current_document(document_id):
    document = (
        request.env['liwan.document']
        .with_context(active_test=False)
        .search([('id', '=', document_id)], limit=1)
    )
    if not document:
        raise ApiError(404, 'not_found', 'document not found')
    document._liwan_require('read')
    return document


def page_args(args):
    limit = min(parse_positive_int(args.get('limit', 50), 'limit'), 200)
    offset = parse_nonneg_int(args.get('offset', 0), 'offset')
    if offset > 2147483647:
        raise ApiError(422, 'invalid', 'offset is too large', field='offset')
    return limit, offset


def archived_arg(args):
    return bool_arg(args, 'archived')


def list_filter_domain(args):
    """Domain terms for the list filters `visibility`, `expiring_within` and `expired`."""
    domain = []
    visibility = args.get('visibility')
    if visibility:
        values = [key for key, _label in request.env['liwan.document']._fields['visibility'].selection]
        if visibility not in values:
            raise ApiError(422, 'invalid', 'visibility is not supported', field='visibility')
        domain.append(('visibility', '=', visibility))
    today = fields.Date.context_today(request.env['liwan.document'])
    if args.get('expiring_within'):
        days = parse_positive_int(args['expiring_within'], 'expiring_within')
        if days > 365:
            raise ApiError(422, 'invalid', 'expiring_within must be 1 to 365 days', field='expiring_within')
        domain += [('expiry_date', '>=', today), ('expiry_date', '<=', today + timedelta(days=days))]
    if bool_arg(args, 'expired'):
        domain += [('expiry_date', '!=', False), ('expiry_date', '<', today)]
    return domain


def bool_arg(args, name, default='false'):
    value = str(args.get(name, default)).lower()
    if value not in ('true', 'false', '1', '0'):
        raise ApiError(422, 'invalid', f'{name} must be boolean', field=name)
    return value in ('true', '1')


def files_page(document, files_path=None):
    """The file list of an already authorized document, after the optional ``revision`` precondition."""
    args = request.httprequest.args
    limit, offset = page_args(args)
    revision = parse_positive_int(args['revision'], 'revision') if 'revision' in args else None
    if revision is not None and revision != document.revision:
        raise ApiError(409, 'conflict', 'document was changed',
                       details={'current_revision': document.revision})
    return dump_files(document, limit=limit, offset=offset, q=args.get('q'), files_path=files_path)


def attachment_disposition(filename):
    """``attachment`` header with a readable ASCII fallback beside the UTF-8 name."""
    ascii_name = unicodedata.normalize('NFKD', filename).encode('ascii', 'ignore').decode()
    stem, dot, extension = ascii_name.rpartition('.')
    if not dot:
        stem, extension = ascii_name, ''
    stem = re.sub(r'[^A-Za-z0-9_-]+', '_', stem).strip('_') or 'download'
    extension = re.sub(r'[^A-Za-z0-9]+', '', extension)
    fallback = f'{stem}.{extension}' if extension else stem
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def file_download(document, file_id):
    """The attachment response of one file of an already authorized document."""
    file = request.env['liwan.document.files']._liwan_file(document, file_id)
    stream = request.env['ir.binary']._get_stream_from(file.attachment_id)
    response = stream.get_response(as_attachment=True)
    response.headers['Content-Disposition'] = attachment_disposition(stream.download_name)
    return response


def upload_document_file(document, payload):
    strict(payload, {'expected_revision', 'name', 'data', 'mimetype', 'as_version'})
    revision = parse_revision(payload)
    as_version = payload.get('as_version', False)
    if not isinstance(as_version, bool):
        raise ApiError(422, 'invalid', 'as_version must be boolean', field='as_version')
    upload = {
        key: value
        for key, value in payload.items()
        if key not in ('expected_revision', 'as_version')
    }
    request.env['liwan.document.files']._liwan_upload(
        document, upload, revision, as_version=as_version,
    )
    return dump_detail(document)


def apply_document_file_action(document, file_id, action, payload):
    revision = parse_revision(payload, only=True)
    service = request.env['liwan.document.files']
    if action in ('archive', 'restore'):
        service._liwan_set_file_active(
            document, file_id, action == 'restore', revision,
        )
    else:
        service._liwan_set_file_lock(document, file_id, action == 'lock', revision)
    return dump_detail(document)


def document_page(model, domain, limit, offset):
    documents = model.search(domain, limit=limit, offset=offset, order='write_date desc,id desc')
    counts = {directory.id: count for directory, count in model.env['dms.file']._read_group(
        [('directory_id', 'in', documents.directory_id.ids), ('active', '=', True)],
        ['directory_id'], ['__count'],
    )}
    return {'items': dump_summaries(documents, counts), 'total': model.search_count(domain)}


def update_document_access(document, payload):
    revision = parse_revision(payload)
    visibility, grants = parse_access(payload)
    document._liwan_require('access')
    # This operation may revoke the caller itself. Return only the approved
    # access proposal, never try to reread revoked document content afterwards.
    proposed = dump_grants(document.env, grants)
    document._liwan_set_access(visibility, grants, revision)
    return {'visibility': visibility, 'grants': proposed, 'revision': revision + 1}
