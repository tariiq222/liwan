# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_crm.controllers.opportunities import find_opportunity
from odoo.addons.webvue_crm.controllers.sale import sale_arguments
from odoo.addons.webvue_crm.serializers.call import dump_call, parse_call_body
from odoo.addons.webvue_crm.serializers.opportunity import dump_opportunity

URL = '/api/v1/crm/opportunities/<int:lead_id>/calls'


class CrmCallsController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', operation='read')
    @requires_capability('crm.leads.read')
    def list_calls(self, lead_id, **_):
        lead = find_opportunity(lead_id)
        limit, offset = parse_page(request.httprequest.args)
        Call = request.env['crm.phonecall']
        domain = [('opportunity_id', '=', lead.id)]
        return {
            'items': [dump_call(call) for call in Call.search(domain, limit=limit, offset=offset, order='date desc, id desc')],
            'total': Call.search_count(domain),
        }

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', operation='write')
    @requires_capability('crm.leads.work')
    def record_call(self, lead_id, **payload):
        lead = find_opportunity(lead_id)
        request.env['webvue.crm.visibility']._webvue_check_write(lead, request.env.user)
        parsed = parse_call_body(payload)
        outcome = request.env['webvue.crm.call.outcome'].search([('id', '=', parsed['outcome_id'])], limit=1)
        if not outcome:
            raise ApiError(422, 'invalid', 'outcome does not exist', field='outcome_id')
        if parsed['sale'] and outcome.effect != 'won':
            raise ApiError(422, 'invalid', 'only a sold outcome carries a package', field='package_id')
        call = request.env['webvue.crm.followup']._webvue_record_call(
            lead, outcome, note=parsed['note'], duration=parsed['duration'],
            sale=sale_arguments(parsed['sale']) if parsed['sale'] else None,
        )
        return {'call': dump_call(call), 'opportunity': dump_opportunity(lead)}
