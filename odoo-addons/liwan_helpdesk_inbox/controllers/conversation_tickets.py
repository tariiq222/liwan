# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``/api/v1/inbox/conversations/<id>/tickets``: the tickets raised from a customer conversation.

``GET`` lists the ones the caller's desk visibility shows; ``POST`` raises one while the conversation has none open
(owner decision 2026-11-20: one open ticket at a time). The conversation is found through the inbox's own visibility
(404 for a hidden, foreign or missing one) and the ticket is created through the desk's own service, so its
visibility, numbering and assignment bell apply. Both routes need both applications' features and the capabilities
each side checks. The only elevation is the count-only open-ticket check in ``has_open_ticket``.
"""
from odoo import http
from odoo.exceptions import LockError
from odoo.fields import Domain
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_helpdesk.models.access_service import READ as TICKETS_READ
from odoo.addons.liwan_helpdesk.models.access_service import WRITE as TICKETS_WRITE
from odoo.addons.liwan_inbox.controllers.helpers import visible_conversation
from odoo.addons.liwan_inbox.models.access_service import READ as CONVERSATIONS_READ

URL = '/api/v1/inbox/conversations/<int:conversation_id>/tickets'
CREATE_FIELDS = frozenset({'subject', 'description', 'team_id', 'priority', 'category_id', 'type_id'})


def ticket_ref(ticket):
    return {
        'id': ticket.id, 'number': ticket.number, 'subject': ticket.name,
        'stage': {'id': ticket.stage_id.id, 'name': ticket.stage_id.name, 'closed': bool(ticket.stage_id.closed)},
        'created_at': iso(ticket.create_date),
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


def has_open_ticket(conversation):
    """Whether the conversation has a ticket that is not closed, whoever may see it; the answer is only a boolean.

    One open ticket at a time must hold against a ticket of another team or assignee, which the desk's record rules
    hide from the caller, so the count is elevated and nothing of the ticket leaves it.
    """
    return bool(request.env['helpdesk.ticket'].sudo().search_count(
        [('liwan_conversation_id', '=', conversation.id), ('stage_id.closed', '=', False)], limit=1,
    ))


def lock_conversation(conversation):
    """Serialize two raises from one conversation; a read-only caller may lock because the lock writes nothing."""
    try:
        conversation.lock_for_update(allow_referencing=True)
    except LockError:
        raise ApiError(409, 'conflict', 'this conversation is being updated') from None


class ConversationTicketsController(http.Controller):

    @http.route(URL, type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', 'helpdesk.enabled', operation='read')
    @requires_capability(CONVERSATIONS_READ, TICKETS_READ)
    def list_conversation_tickets(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        limit, offset = parse_page(request.httprequest.args)
        domain = Domain('liwan_conversation_id', '=', conversation.id) & request.env['liwan.helpdesk.visibility']._liwan_domain()
        Ticket = request.env['helpdesk.ticket']
        tickets = Ticket.search(domain, order='create_date desc, id desc', limit=limit, offset=offset)
        return {'items': [ticket_ref(ticket) for ticket in tickets], 'total': Ticket.search_count(domain)}

    @http.route(URL, type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', 'helpdesk.enabled', operation='write')
    @requires_capability(CONVERSATIONS_READ, TICKETS_WRITE)
    def create_conversation_ticket(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        if conversation.company_id != request.env.company:
            raise ApiError(404, 'not_found', 'conversation does not exist in this company')
        payload = request.get_json_data()
        if not isinstance(payload, dict) or set(payload) - CREATE_FIELDS:
            raise ApiError(422, 'invalid', 'Invalid request fields.')
        lock_conversation(conversation)
        if has_open_ticket(conversation):
            raise ApiError(409, 'conflict', 'this conversation already has an open ticket',
                           details={'reason': 'open_ticket_exists'})
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
        ticket.liwan_conversation_id = conversation
        return ticket_ref(ticket)
