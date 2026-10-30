# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from .common import current_document, require
from odoo.addons.liwan_api.controllers.common import api_handler, requires_feature
from odoo.addons.liwan_documents.serializers.document import parse_revision
from odoo.addons.liwan_documents.serializers.document_access import (
    dump_access,
    dump_grants,
    parse_access,
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
        revision = parse_revision(payload)
        visibility, grants = parse_access(payload)
        document = current_document(document_id)
        document._liwan_require('access')
        # This operation may revoke the caller itself. Return only the approved
        # access proposal, never try to reread revoked document content afterwards.
        proposed = dump_grants(request.env, grants)
        document._liwan_set_access(visibility, grants, revision)
        return {'visibility': visibility, 'grants': proposed, 'revision': revision + 1}
