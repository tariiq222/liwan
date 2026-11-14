# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http

from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_document_service.controllers.common import (
    current_document,
    require,
    update_document_access,
)
from odoo.addons.liwan_document_service.serializers.document_access import (
    dump_access,
)


class Access(http.Controller):
    @http.route(
        '/api/v1/documents/<int:document_id>/access',
        type='json2',
        auth='user',
        methods=['GET'],
        readonly=True,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='read')
    def get_access(self, document_id):
        require('documents.access.manage')
        return dump_access(current_document(document_id))

    @http.route(
        '/api/v1/documents/<int:document_id>/access',
        type='json2',
        auth='user',
        methods=['PUT'],
        readonly=False,
    )
    @api_handler
    @requires_feature('documents.enabled', operation='write')
    def set_access(self, document_id, **payload):
        require('documents.access.manage')
        return update_document_access(current_document(document_id), payload)
