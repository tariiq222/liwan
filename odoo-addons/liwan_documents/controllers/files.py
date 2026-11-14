# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_document_service.controllers.common import (
    apply_document_file_action,
    current_document,
    files_page,
    require,
    upload_document_file,
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
        return files_page(current_document(document_id))

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
        return upload_document_file(current_document(document_id), payload)

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
        return apply_document_file_action(current_document(document_id), file_id, action, payload)
