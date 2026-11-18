# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import LockError
from odoo.http import request

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_api.serializers.common import ref
from odoo.addons.liwan_crm.controllers.opportunities import (
    check_can_create,
    create_opportunity_from_payload,
    find_opportunity,
    visible_domain,
)
from odoo.addons.liwan_inbox.controllers.helpers import no_content, visible_conversation
from odoo.addons.liwan_inbox.models.access_service import READ, REPLY
from odoo.addons.liwan_inbox.serializers.conversation import dump_conversation

LINK_FIELDS = {'opportunity_id'}


def dump_opportunity_ref(lead):
    """The row of an opportunity a conversation shows: who it is about, where it stands, whether it is archived."""
    return {
        'id': lead.id, 'contact_name': lead.contact_name or '', 'stage': ref(lead.stage_id, label='display_name'),
        'status': lead.won_status, 'active': lead.active,
    }


def require_same_customer(conversation, lead):
    """409 ``conflict`` when the contact and the opportunity are linked to different customers; one side without a
    customer is fine, and the link never copies a customer from one side to the other."""
    contact = conversation.contact_id
    if contact.partner_id and lead.partner_id and contact.partner_id != lead.partner_id:
        service = request.env['liwan.customers.service']
        raise ApiError(409, 'conflict', 'the contact and the opportunity belong to different customers', details={
            'contact_customer': service._liwan_link_ref(contact._liwan_linked_customer()),
            'opportunity_customer': service._liwan_link_ref(lead._liwan_linked_customer()),
        })


def writable_lead(lead_id):
    """The opportunity the caller may read and change; 404 when hidden, 403 when it is another agent's."""
    lead = find_opportunity(lead_id)
    request.env['liwan.crm.visibility']._liwan_check_write(lead, request.env.user)
    return lead


def lock_conversation(conversation):
    conversation.check_access('write')
    try:
        conversation.lock_for_update(allow_referencing=True)
    except LockError:
        raise ApiError(409, 'opportunity_busy', 'this conversation is being updated') from None


class OpportunityConversationsController(http.Controller):

    @http.route('/api/v1/crm/opportunities/<int:opportunity_id>/conversations', type='json2', auth='user',
                methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', 'inbox.enabled', operation='read')
    @requires_capability('crm.leads.read', READ)
    def list_opportunity_conversations(self, opportunity_id, **_):
        lead = find_opportunity(opportunity_id)
        limit, offset = parse_page(request.httprequest.args)
        Conversation = request.env['liwan.inbox.conversation']
        domain = [('lead_id', '=', lead.id)]
        return {
            'items': [dump_conversation(c) for c in Conversation._liwan_search_visible(domain, limit=limit, offset=offset)],
            'total': Conversation._liwan_count_visible(domain),
        }

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/opportunity', type='json2', auth='user',
                methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('crm.enabled', 'inbox.enabled', operation='read')
    @requires_capability('crm.leads.read', READ)
    def get_conversation_opportunity(self, conversation_id, **_):
        """The linked opportunity, or null when there is none or the caller may not read it (its name never leaks)."""
        conversation = visible_conversation(conversation_id)
        lead = request.env['crm.lead'].with_context(active_test=False).search(
            [('id', '=', conversation.lead_id.id), *visible_domain()], limit=1,
        )
        return dump_opportunity_ref(lead) if lead else None

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/opportunity', type='json2', auth='user',
                methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', 'inbox.enabled', operation='write')
    @requires_capability('crm.leads.work', REPLY)
    def create_conversation_opportunity(self, conversation_id, **payload):
        if payload:
            raise ApiError(422, 'invalid', 'the opportunity uses conversation details', field=sorted(payload)[0])
        check_can_create()
        conversation = visible_conversation(conversation_id)
        if conversation.company_id != request.env.company:
            raise ApiError(404, 'not_found', 'conversation does not exist in this company')
        lock_conversation(conversation)
        if conversation.lead_id:
            raise ApiError(409, 'already_linked', 'the conversation is already linked to an opportunity')
        contact = conversation.contact_id
        lead = create_opportunity_from_payload({'contact_name': contact.name, 'phone': contact.phone})
        conversation.lead_id = lead
        return dump_opportunity_ref(lead)

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/opportunity', type='json2', auth='user',
                methods=['PUT'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', 'inbox.enabled', operation='write')
    @requires_capability('crm.leads.work', REPLY)
    def link_conversation_opportunity(self, conversation_id, **payload):
        """Link the conversation to an existing opportunity of its company. Nothing is created and no customer is
        copied. A conversation linked to another opportunity answers 409 ``already_linked``: unlink it first."""
        unknown = sorted(set(payload) - LINK_FIELDS)
        if unknown:
            raise ApiError(422, 'invalid', 'field is not writable', field=unknown[0])
        if 'opportunity_id' not in payload:
            raise ApiError(422, 'invalid', 'opportunity_id is required', field='opportunity_id')
        opportunity_id = parse_positive_int(payload['opportunity_id'], 'opportunity_id')
        conversation = visible_conversation(conversation_id)
        lead = writable_lead(opportunity_id)
        if lead.company_id != conversation.company_id:
            raise ApiError(422, 'invalid', 'the opportunity belongs to another company', field='opportunity_id')
        if not lead.active:
            raise ApiError(422, 'invalid', 'an archived opportunity takes no conversation', field='opportunity_id')
        lock_conversation(conversation)
        if conversation.lead_id and conversation.lead_id != lead:
            raise ApiError(409, 'already_linked', 'the conversation is already linked to an opportunity')
        require_same_customer(conversation, lead)
        conversation.lead_id = lead
        return dump_opportunity_ref(lead)

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/opportunity', type='json2', auth='user',
                methods=['DELETE'], readonly=False)
    @api_handler
    @requires_feature('crm.enabled', 'inbox.enabled', operation='write')
    @requires_capability('crm.leads.work', REPLY)
    def unlink_conversation_opportunity(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        lock_conversation(conversation)
        if conversation.lead_id:
            writable_lead(conversation.lead_id.id)
            conversation.lead_id = False
        return no_content()
