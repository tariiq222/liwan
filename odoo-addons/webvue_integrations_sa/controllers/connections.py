# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)
from odoo.addons.webvue_integrations_sa.serializers.connection import dump_connections


class IntegrationConnectionController(http.Controller):

    @http.route('/api/v1/integrations/connections', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('integrations.enabled', operation='read')
    def list_connections(self, **_):
        service = request.env['webvue.access.service']
        if not service._webvue_has_capability(request.env.user, 'integrations.read'):
            raise ApiError(403, 'forbidden', 'integrations.read capability is required')
        Connection = request.env['webvue.integration.connection']
        domain = [('company_id', '=', request.env.company.id)]
        connections = Connection.search(domain)
        return {'items': dump_connections(connections), 'total': len(connections)}
