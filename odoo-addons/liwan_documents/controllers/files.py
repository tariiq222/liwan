# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import current_document, page_args, require
from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_feature,
)
from odoo.addons.liwan_documents.serializers.document import (
    dump_detail,
    dump_files,
    parse_revision,
    strict,
)


class Files(http.Controller):
    @http.route(
        '/api/v1/documents/<int:document_id>/files',
        type='json2', auth='user', methods=['GET'], readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def list_files(self, document_id, **kwargs):
        require('documents.items.read')
        limit, offset = page_args(request.httprequest.args)
        document = current_document(document_id)
        args = request.httprequest.args
        revision = parse_positive_int(args['revision'], 'revision') if 'revision' in args else None
        if revision is not None and revision != document.revision:
            raise ApiError(409, 'conflict', 'document was changed',
                           details={'current_revision': document.revision})
        return dump_files(
            document, limit=limit, offset=offset,
            q=request.httprequest.args.get('q'),
        )

    @http.route(
        '/api/v1/documents/<int:document_id>/files',
        type='json2',
        auth='user',
        methods=['POST'],
        readonly=False,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='write')
    def upload_file(self, document_id, **payload):
        require('documents.items.manage')
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
        document = current_document(document_id)
        request.env['liwan.document.files']._liwan_upload(
            document, upload, revision, as_version=as_version,
        )
        return dump_detail(document)

    @http.route(
        [
            '/api/v1/documents/<int:document_id>/files/<int:file_id>/archive',
            '/api/v1/documents/<int:document_id>/files/<int:file_id>/restore',
            '/api/v1/documents/<int:document_id>/files/<int:file_id>/lock',
            '/api/v1/documents/<int:document_id>/files/<int:file_id>/unlock',
        ],
        type='json2',
        auth='user',
        methods=['POST'],
        readonly=False,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='write')
    def file_action(self, document_id, file_id, **payload):
        action = request.httprequest.path.rsplit('/', 1)[-1]
        require(
            'documents.items.archive'
            if action in ('archive', 'restore')
            else 'documents.items.manage',
        )
        revision = parse_revision(payload, only=True)
        document = current_document(document_id)
        service = request.env['liwan.document.files']
        if action in ('archive', 'restore'):
            service._liwan_set_file_active(
                document, file_id, action == 'restore', revision,
            )
        else:
            service._liwan_set_file_lock(document, file_id, action == 'lock', revision)
        return dump_detail(document)
