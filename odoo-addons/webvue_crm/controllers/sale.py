# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_crm.controllers.opportunities import find_opportunity
from odoo.addons.webvue_crm.serializers.call import (
    parse_assign_body,
    parse_lost_body,
    parse_sale_body,
)
from odoo.addons.webvue_crm.serializers.opportunity import dump_opportunity

BASE = '/api/v1/crm/opportunities/<int:lead_id>'


def find_package(package_id):
    package = request.env['product.template'].search([('id', '=', package_id), ('webvue_crm_package', '=', True)], limit=1)
    if not package:
        raise ApiError(422, 'invalid', 'package does not exist', field='package_id')
    return package


def sale_arguments(sale):
    """The arguments of ``crm.lead._webvue_mark_won`` for a parsed sale body."""
    return {
        'package': find_package(sale['package_id']),
        'final_price': sale['final_price'],
        'discount_percent': sale['discount_percent'],
        'user': request.env.user,
    }


class CrmSaleController(http.Controller):

    @http.route(f'{BASE}/won', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work')
    def mark_won(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        lead._webvue_mark_won(**sale_arguments(parse_sale_body(payload)))
        return dump_opportunity(lead)

    @http.route(f'{BASE}/lost', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work')
    def mark_lost(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        reason_id = parse_lost_body(payload)['lost_reason_id']
        reason = request.env['crm.lost.reason'].search([('id', '=', reason_id)], limit=1)
        if not reason:
            raise ApiError(422, 'invalid', 'lost reason does not exist', field='lost_reason_id')
        lead._webvue_mark_lost(reason, request.env.user)
        return dump_opportunity(lead)

    @http.route(f'{BASE}/reopen', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.assign')
    def reopen(self, lead_id, **payload):
        if payload:
            raise ApiError(422, 'invalid', 'field is not writable', field=sorted(payload)[0])
        lead = find_opportunity(lead_id)
        lead._webvue_reopen(request.env.user)
        return dump_opportunity(lead)

    @http.route(f'{BASE}/assign', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.assign')
    def assign(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        agent = request.env['res.users'].browse(parse_assign_body(payload)['user_id'])
        lead._webvue_reassign(agent, request.env.user)
        return dump_opportunity(lead)
