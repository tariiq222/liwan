# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/helpdesk/tickets/<id>/quotations``: bill the work of a ticket.

The ticket is found through the desk's own visibility and the quotation is created through the sales service, so
its pricing, discount limits and visibility apply unchanged. The customer of the quotation comes from the ticket's
own customer; an agent who may not quote asks a seller instead of writing the order here.
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
from odoo.addons.liwan_helpdesk.controllers.tickets import find, find_visible
from odoo.addons.liwan_sales.controllers.orders import _detail, _visible_orders
from odoo.addons.liwan_sales.serializers.order import parse_order_body

URL = '/api/v1/helpdesk/tickets/<int:ticket_id>/quotations'
CREATE_FIELDS = frozenset({'lines', 'validity_date', 'salesperson_id', 'note'})


def quotation_ref(order):
    return {
        'id': order.id, 'name': order.name, 'state': order.state,
        'amount_total': order.amount_total, 'currency': order.currency_id.name,
    }


class TicketQuotationsController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('helpdesk.enabled', 'sales.enabled', operation='read')
    @requires_capability('helpdesk.tickets.read', 'sales.read', match='any')
    def list_quotations(self, ticket_id, **_):
        # The route's own gate already answered for the two capabilities; the lookup is the desk's visibility alone,
        # so a seller reads the quotations of a ticket inside it and gets the same 404 outside it.
        ticket = find_visible(ticket_id)
        limit, offset = parse_page(request.httprequest.args)
        orders, domain = _visible_orders([('helpdesk_ticket_id', '=', ticket.id)])
        rows = orders.search(domain, limit=limit, offset=offset, order='id desc')
        return {
            'items': [quotation_ref(order) for order in rows],
            'total': orders.search_count(domain),
        }

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'sales.enabled')
    @requires_capability('helpdesk.tickets.write', 'sales.quotations.manage')
    def create_quotation(self, ticket_id, **_):
        ticket = find(ticket_id, 'helpdesk.tickets.write')
        payload = request.get_json_data()
        if not isinstance(payload, dict) or set(payload) - CREATE_FIELDS:
            raise ApiError(422, 'invalid', 'Invalid request fields.')
        if not ticket.partner_id:
            raise ApiError(422, 'invalid', 'a ticket without a customer cannot be billed', field='customer_id')
        if ticket.stage_id.closed:
            raise ApiError(422, 'invalid', 'a closed ticket takes no new quotation', field='ticket_id')
        values = parse_order_body({**payload, 'customer_id': ticket.partner_id.id}, creating=True)
        order = request.env['liwan.sales.service']._liwan_create(values)
        order.write({'helpdesk_ticket_id': ticket.id})
        return _detail(order)
