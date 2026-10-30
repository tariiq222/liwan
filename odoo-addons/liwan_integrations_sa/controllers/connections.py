# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_integrations_sa.serializers.connection import dump_connections


class IntegrationConnectionController(http.Controller):

    @http.route('/api/v1/integrations/connections', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('integrations.enabled', operation='read')
    @requires_capability('integrations.read')
    def list_connections(self, **_):
        Connection = request.env['liwan.integration.connection']
        domain = [('company_id', '=', request.env.company.id)]
        connections = Connection.search(domain)
        return {'items': dump_connections(connections), 'total': len(connections)}
