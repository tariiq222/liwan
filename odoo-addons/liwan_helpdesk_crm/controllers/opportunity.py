# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The opportunity of one support ticket.

Owner decision D1 (2026-11-20): the desk agent who sees an opportunity may link a ticket to it. Linking needs the
desk's write capability on a visible ticket, CRM's read capability and CRM's visibility of the opportunity (404 for
a hidden, missing or another company's one, since both lookups are pinned to the working company); nothing is checked on the opportunity's write side because the link is a ticket
column and the opportunity does not change. Unlinking needs only the ticket's write right and clears whatever was
linked, visible or not. An opportunity the caller may not read is never named: ``GET`` answers ``hidden: true``.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_crm.controllers.opportunities import (
    find_opportunity,
    visible_domain,
)
from odoo.addons.liwan_crm.serializers.opportunity import dump_opportunity_ref
from odoo.addons.liwan_helpdesk.controllers.tickets import find

URL = '/api/v1/helpdesk/tickets/<int:ticket_id>/opportunity'
LINK_FIELDS = {'opportunity_id'}


def link_answer(ticket):
    """``{opportunity, hidden}``: the ref when the caller sees the linked opportunity, ``hidden`` when a link exists
    that the caller may not read."""
    if not ticket.liwan_lead_id:
        return {'opportunity': None, 'hidden': False}
    lead = request.env['crm.lead'].with_context(active_test=False).search(
        [('id', '=', ticket.liwan_lead_id.id), *visible_domain()], limit=1,
    )
    if not lead:
        return {'opportunity': None, 'hidden': True}
    return {'opportunity': dump_opportunity_ref(lead), 'hidden': False}


class HelpdeskOpportunityController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', 'crm.enabled', operation='read')
    @requires_capability('helpdesk.tickets.read', 'crm.leads.read')
    def get_ticket_opportunity(self, ticket_id, **_):
        return link_answer(find(ticket_id))

    @http.route(URL, type='json2', auth='user', methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'crm.enabled')
    @requires_capability('helpdesk.tickets.write', 'crm.leads.read')
    def link_ticket_opportunity(self, ticket_id, **payload):
        """Link the ticket to an opportunity of its company, replacing any earlier link."""
        unknown = sorted(set(payload) - LINK_FIELDS)
        if unknown:
            raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
        if 'opportunity_id' not in payload:
            raise ApiError(422, 'invalid', 'opportunity_id is required', field='opportunity_id')
        opportunity_id = parse_positive_int(payload['opportunity_id'], 'opportunity_id')
        ticket = find(ticket_id, 'helpdesk.tickets.write')
        lead = find_opportunity(opportunity_id)
        ticket.write({'liwan_lead_id': lead.id})
        return link_answer(ticket)

    @http.route(URL, type='json2', auth='user', methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'crm.enabled')
    @requires_capability('helpdesk.tickets.write')
    def unlink_ticket_opportunity(self, ticket_id, **_):
        find(ticket_id, 'helpdesk.tickets.write').write({'liwan_lead_id': False})
        return request.make_json_response('', status=204)
