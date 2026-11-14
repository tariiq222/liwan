# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_feature,
)
from odoo.addons.liwan_document_service.controllers.common import (
    current_document,
    file_download,
)


class DocumentDownload(http.Controller):
    @http.route(
        '/api/v1/documents/<int:document_id>/files/<int:file_id>/download',
        type='http',
        auth='user',
        methods=['GET', 'HEAD'],
        readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def download(self, document_id, file_id, **kwargs):
        request.env['liwan.access.service']._liwan_require_capability(
            'documents.items.read',
        )
        return file_download(current_document(document_id), file_id)
