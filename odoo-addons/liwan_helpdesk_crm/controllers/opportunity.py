# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The opportunity of one support ticket.

The route needs both applications' features, the desk's write capability and CRM's read capability: an
agent links the ticket to a deal they may see, so the invoice and the sale behind it are one click away.
The opportunity is found through CRM's own visibility (404 for a hidden, foreign or missing one) and the
link is written in the caller's environment under both applications' record rules.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm.controllers.opportunities import find_opportunity
from odoo.addons.liwan_helpdesk.controllers.tickets import detail as ticket_detail
from odoo.addons.liwan_helpdesk.controllers.tickets import find

URL = '/api/v1/helpdesk/tickets/<int:ticket_id>/opportunity'


def opportunity_ref(lead):
    return {'id': lead.id, 'name': lead.name, 'stage': lead.stage_id.name or ''}


class HelpdeskOpportunityController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'crm.enabled')
    @requires_capability('helpdesk.tickets.write', 'crm.leads.read')
    def link_opportunity(self, ticket_id, **_):
        payload = request.get_json_data()
        if not isinstance(payload, dict) or set(payload) - {'opportunity_id'}:
            raise ApiError(422, 'invalid', 'Invalid request fields.')
        ticket = find(ticket_id, 'helpdesk.tickets.write')
        opportunity_id = payload.get('opportunity_id')
        if opportunity_id in (None, False):
            ticket.write({'liwan_lead_id': False})
        else:
            if type(opportunity_id) is not int or opportunity_id <= 0:
                raise ApiError(422, 'invalid', 'must be an opportunity id', field='opportunity_id')
            lead = find_opportunity(opportunity_id)
            if lead.company_id != ticket.company_id:
                raise ApiError(422, 'invalid', 'the opportunity belongs to another company', field='opportunity_id')
            ticket.write({'liwan_lead_id': lead.id})
        body = ticket_detail(ticket)
        lead = ticket.liwan_lead_id
        body['opportunity'] = opportunity_ref(lead) if lead else None
        return body
