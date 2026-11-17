# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/inbox/conversations/<id>/ticket``: raise a support ticket from a customer conversation.

The conversation is found through the inbox's own visibility (404 for a hidden, foreign or missing one) and the
ticket is created through the desk's own service, so its visibility, numbering and assignment bell apply. The two
routes need both applications' features and the capabilities each side already checks; nothing here uses ``sudo()``.
"""
from odoo import http
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_helpdesk.controllers.tickets import detail
from odoo.addons.liwan_inbox.controllers.helpers import visible_conversation

URL = '/api/v1/inbox/conversations/<int:conversation_id>/ticket'
CREATE_FIELDS = frozenset({'subject', 'description', 'team_id', 'priority', 'category_id', 'type_id'})


def ticket_ref(ticket):
    if not ticket:
        return None
    return {
        'id': ticket.id, 'number': ticket.number, 'subject': ticket.name,
        'stage': ticket.stage_id.name or '', 'closed': bool(ticket.stage_id.closed),
    }


def conversation_text(conversation):
    """The last public messages of the conversation as the ticket's description, in plain text.

    The agent copies what the customer wrote; nothing else of the conversation travels, and the thread itself stays
    in the inbox.
    """
    messages = request.env['liwan.inbox.message'].search([
        ('conversation_id', '=', conversation.id), ('direction', '=', 'in'),
    ], order='id desc', limit=5)
    lines = []
    for message in reversed(messages):
        text = (message.body or '').strip()
        if text:
            lines.append('- %s' % text)
    return '\n'.join(lines) or conversation.contact_id.name or ''


class ConversationTicketController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', 'helpdesk.enabled')
    @requires_capability('inbox.conversations.read', 'helpdesk.tickets.write')
    def create_ticket(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        if conversation.helpdesk_ticket_id:
            raise ApiError(409, 'conflict', 'this conversation already has a ticket', field='conversation_id')
        payload = request.get_json_data()
        if not isinstance(payload, dict) or set(payload) - CREATE_FIELDS:
            raise ApiError(422, 'invalid', 'Invalid request fields.')
        customer = conversation.contact_id.partner_id
        values = {
            'subject': payload.get('subject') or conversation.contact_id.name or '',
            'description': payload.get('description') or conversation_text(conversation),
            # The ticket is about the conversation's customer when the contact is linked to one; the desk's service
            # resolves it through the one customer directory, so nothing is copied between the two applications.
            **({'customer_id': customer.id} if customer else {}),
        }
        for key in ('team_id', 'category_id', 'type_id'):
            if payload.get(key) is not None:
                values[key] = payload[key]
        if payload.get('priority') is not None:
            values['priority'] = payload['priority']
        ticket = request.env['liwan.helpdesk.service']._liwan_create(values)
        conversation.write({'helpdesk_ticket_id': ticket.id})
        body = detail(ticket)
        body['ticket'] = ticket_ref(ticket)
        return body
