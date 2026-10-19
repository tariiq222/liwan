# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from odoo.addons.dms.controllers.main import OnboardingController
from odoo.addons.dms.controllers.portal import CustomerPortal
from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)


class DocumentPortal(CustomerPortal):
    @http.route()
    @requires_feature('documents.enabled', operation='read')
    def portal_my_dms(self, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)

    @http.route()
    @requires_feature('documents.enabled', operation='read')
    def portal_my_dms_directory(self, dms_directory_id=False, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)

    @http.route()
    @requires_feature('documents.enabled', operation='read')
    def portal_my_dms_file_download(self, dms_file_id, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)


class DocumentNativeUpload(OnboardingController):
    @http.route()
    @requires_feature('documents.enabled', operation='write')
    def forbidden_extensions(self, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)

    @http.route()
    @requires_feature('documents.enabled', operation='write')
    def upload_dms_file(self, ufile=None, directory_id=None, **kwargs):
        msg = 'use the documents application'
        raise AccessError(msg)


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
        request.env['webvue.access.service']._webvue_require_capability(
            'documents.items.read',
        )
        document = (
            request.env['webvue.document']
            .with_context(active_test=False)
            .search([('id', '=', document_id)], limit=1)
        )
        if not document:
            raise ApiError(404, 'not_found', 'document not found')
        document._webvue_require('read')
        file = request.env['webvue.document.files']._webvue_file(document, file_id)
        return (
            request.env['ir.binary']
            ._get_stream_from(file.attachment_id)
            .get_response(as_attachment=True)
        )
