# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import AccessError
from odoo.http import request

from .common import current_document, file_download
from odoo.addons.dms.controllers.main import OnboardingController
from odoo.addons.dms.controllers.portal import CustomerPortal
from odoo.addons.liwan_api.controllers.common import (
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
        request.env['liwan.access.service']._liwan_require_capability(
            'documents.items.read',
        )
        return file_download(current_document(document_id), file_id)
