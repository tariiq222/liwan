# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The quotations and orders of one CRM opportunity.

Both routes need the CRM and the Sales features and capabilities. The opportunity is found through CRM's own visibility
(404 for a hidden, foreign or missing one). The list is a search under Sales' own visibility, so a row the caller cannot
read in Sales is neither listed nor counted; a quotation is created through the Sales service, so its rules apply.
Nothing here uses ``sudo()``.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm.controllers.opportunities import find_opportunity
from odoo.addons.liwan_sales.models.access_service import QUOTATIONS_MANAGE, READ
from odoo.addons.liwan_sales.serializers.order import dump_order, dump_orders

URL = '/api/v1/crm/opportunities/<int:lead_id>/orders'


class CrmOpportunityOrdersController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', 'sales.enabled', operation='read')
    @requires_capability('crm.leads.read', READ)
    def list_opportunity_orders(self, lead_id, **_):
        lead = find_opportunity(lead_id)
        limit, offset = parse_page(request.httprequest.args)
        Order = request.env['sale.order']
        domain = [*request.env['liwan.sales.visibility']._liwan_domain(request.env.user), ('liwan_lead_id', '=', lead.id)]
        found = Order.search(domain, order='date_order desc, id desc', limit=limit, offset=offset)
        return {'items': dump_orders(found), 'total': Order.search_count(domain)}

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', 'sales.enabled', operation='write')
    @requires_capability('crm.leads.read', QUOTATIONS_MANAGE)
    def create_opportunity_order(self, lead_id, **payload):
        if payload:
            raise ApiError(422, 'invalid', 'field is not writable', field=sorted(payload)[0])
        lead = find_opportunity(lead_id)
        order = request.env['liwan.sales.service']._liwan_create_from_opportunity(lead)
        return dump_order(order, request.env.user)
