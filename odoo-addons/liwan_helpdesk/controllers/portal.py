# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/public/helpdesk/...``: the customer's page of one ticket, authorized by its own token.

Anonymous visitors only. The token in the address is the whole credential: it is compared in constant
time by ``liwan.helpdesk.portal``, the route never reads a session, and every refusal is the same 404
so the page cannot be used to discover which ticket numbers exist.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_feature,
)

TICKET_PATH = '/api/v1/public/helpdesk/tickets/<int:ticket_id>'


def token_from_request():
    token = request.httprequest.args.get('token', '')
    return token if isinstance(token, str) else ''


def portal():
    return request.env['liwan.helpdesk.portal']


def body(allowed):
    payload = request.get_json_data()
    if not isinstance(payload, dict) or set(payload) - allowed:
        raise ApiError(422, 'invalid', 'Invalid request fields.')
    return payload


class HelpdeskPortalController(http.Controller):

    @http.route(TICKET_PATH, type='json2', auth='public', methods=['GET'], readonly=False, save_session=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'helpdesk.portal', operation='read')
    def get_ticket(self, ticket_id, **_):
        return portal()._liwan_open_by_id(ticket_id, token_from_request())

    @http.route(TICKET_PATH + '/messages', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'helpdesk.portal')
    def reply(self, ticket_id, **_):
        payload = body({'body'})
        return portal()._liwan_reply(ticket_id, token_from_request(), payload.get('body'))

    @http.route(TICKET_PATH + '/close', type='json2', auth='public', methods=['POST'], readonly=False, save_session=False)
    @api_handler
    @requires_feature('helpdesk.enabled', 'helpdesk.portal')
    def close(self, ticket_id, **_):
        body(set())
        return portal()._liwan_close(ticket_id, token_from_request())
