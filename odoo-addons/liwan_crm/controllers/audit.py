# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm.serializers.opportunity import dump_view


class CrmAuditController(http.Controller):

    @http.route('/api/v1/crm/audit/views', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.audit.read')
    def list_views(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Log = request.env['liwan.crm.view.log']
        domain = [('company_id', '=', request.env.company.id)]
        return {
            'items': [dump_view(row) for row in Log.search(domain, limit=limit, offset=offset)],
            'total': Log.search_count(domain),
        }
