# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request
from odoo.tools.mail import email_normalize

from odoo.addons.webvue_api.controllers.common import (
    api_handler,
    parse_page,
    parse_positive_int,
    require_capabilities,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_inbox.controllers.helpers import (
    CONVERSATION_STATES,
    check_fields,
    find_ids,
    find_one,
    no_content,
    not_found,
    parse_ids,
    parse_text,
    reject,
    visible_conversation,
    visible_message,
)
from odoo.addons.webvue_inbox.controllers.reply_parsing import MAX_BODY
from odoo.addons.webvue_inbox.models.access_service import ASSIGN, READ, REPLY
from odoo.addons.webvue_inbox.models.notification_types import KIND
from odoo.addons.webvue_inbox.serializers.conversation import (
    dump_contact,
    dump_conversation,
    dump_conversation_detail,
    dump_messages,
    dump_ref,
)
from odoo.addons.webvue_inbox.serializers.settings import dump_canned_reply

PRIORITIES = ('low', 'normal', 'high', 'urgent')
PATCH_FIELDS = {'state', 'priority', 'tag_ids', 'assignee_id', 'department_id'}
REPLY_FIELDS = {'state', 'priority', 'tag_ids'}
ASSIGN_FIELDS = {'assignee_id', 'department_id'}


def conversation_domain(args):
    """The list filters of the query string (state, assignee, department_id, channel_id, q)."""
    domain = []
    if args.get('state'):
        if args['state'] not in CONVERSATION_STATES:
            reject(f'state must be one of {CONVERSATION_STATES}', 'state')
        domain.append(('state', '=', args['state']))
    assignee = args.get('assignee')
    if assignee == 'me':
        domain.append(('assignee_id', '=', request.env.uid))
    elif assignee == 'unassigned':
        domain.append(('assignee_id', '=', False))
    elif assignee:
        domain.append(('assignee_id', '=', parse_positive_int(assignee, 'assignee')))
    for key in ('department_id', 'channel_id'):
        if args.get(key):
            domain.append((key, '=', parse_positive_int(args[key], key)))
    if args.get('q'):
        domain += [
            '|', '|', ('contact_id.name', 'ilike', args['q']), ('contact_id.phone', 'ilike', args['q']),
            ('last_message_preview', 'ilike', args['q']),
        ]
    return domain


def detail(conversation):
    service = request.env['webvue.access.service']
    user = request.env.user
    return dump_conversation_detail(
        conversation, service._webvue_has_capability(user, REPLY), service._webvue_has_capability(user, ASSIGN),
    )


def parse_assignment(conversation, payload):
    values = {}
    if 'assignee_id' in payload:
        values['assignee_id'] = False
        if payload['assignee_id'] is not None:
            assignee = find_one('res.users', payload['assignee_id'], 'assignee_id')
            service = request.env['webvue.access.service']
            if not assignee.active or not service._webvue_has_capability(assignee, REPLY, company=conversation.company_id):
                reject('assignee_id must be an active agent who can reply', 'assignee_id')
            values['assignee_id'] = assignee.id
    if 'department_id' in payload:
        values['department_id'] = (
            find_one('webvue.inbox.department', payload['department_id'], 'department_id').id
            if payload['department_id'] is not None else False
        )
    return values


def parse_patch(conversation, payload):
    check_fields(payload, PATCH_FIELDS)
    if REPLY_FIELDS & set(payload):
        require_capabilities(REPLY)
    if ASSIGN_FIELDS & set(payload):
        require_capabilities(ASSIGN)
    values = parse_assignment(conversation, payload)
    if 'state' in payload:
        if payload['state'] not in CONVERSATION_STATES:
            reject(f'state must be one of {CONVERSATION_STATES}', 'state')
        values['state'] = payload['state']
    if 'priority' in payload:
        if payload['priority'] not in PRIORITIES:
            reject(f'priority must be one of {PRIORITIES}', 'priority')
        values['priority'] = payload['priority']
    if 'tag_ids' in payload:
        ids = parse_ids(payload['tag_ids'], 'tag_ids')
        values['tag_ids'] = [(6, 0, find_ids('webvue.inbox.tag', ids, 'tag_ids').ids)]
    return values


def notify_assignment(conversation):
    """Bell row for a new assignee, unless the actor assigned the conversation to themselves."""
    assignee = conversation.assignee_id
    if not assignee or assignee == request.env.user:
        return
    request.env['webvue.notify.service']._webvue_deliver(
        conversation._name, conversation.id, KIND, assignee.partner_id,
        request.env._('%(actor)s assigned you a conversation with %(customer)s',
                      actor=request.env.user.name, customer=conversation.contact_id.name),
        key=f'{KIND}:{conversation.id}:{assignee.partner_id.id}',
        values={'webvue_inbox_conversation_id': conversation.id, 'webvue_inbox_contact_name': conversation.contact_id.name},
        replace=True,
    )


class ConversationController(http.Controller):

    @http.route('/api/v1/inbox/conversations', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def list_conversations(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = conversation_domain(args)
        Conversation = request.env['webvue.inbox.conversation']
        return {
            'items': [dump_conversation(c) for c in Conversation._webvue_search_visible(domain, limit=limit, offset=offset)],
            'total': Conversation._webvue_count_visible(domain),
        }

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def get_conversation(self, conversation_id, **_):
        return detail(visible_conversation(conversation_id))

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/read', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(READ)
    def mark_read(self, conversation_id, **_):
        """Clear the unread flag and queue the read receipt; the UI calls this when it opens a conversation."""
        conversation = visible_conversation(conversation_id)
        if conversation.unread:
            conversation.unread = False
        conversation._webvue_request_read_receipt()
        return no_content()

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(READ)
    def patch_conversation(self, conversation_id, **payload):
        conversation = visible_conversation(conversation_id)
        previous = conversation.assignee_id
        conversation.write(parse_patch(conversation, payload))
        if conversation.assignee_id != previous:
            notify_assignment(conversation)
        conversation._webvue_notify_bus()
        return detail(conversation)

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/messages', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def list_messages(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        limit, offset = parse_page(request.httprequest.args)
        Message = request.env['webvue.inbox.message']
        domain = [('conversation_id', '=', conversation.id)]
        newest = Message.search(domain, order='date desc, id desc', limit=limit, offset=offset)
        return {'items': dump_messages(newest.sorted(lambda m: (m.date, m.id))), 'total': Message.search_count(domain)}

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/notes', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def add_note(self, conversation_id, **payload):
        conversation = visible_conversation(conversation_id)
        check_fields(payload, {'body'}, required=('body',))
        note = request.env['webvue.inbox.message']._webvue_post_note(conversation, parse_text(payload, 'body', MAX_BODY))
        conversation._webvue_notify_bus()
        return dump_messages(note)[0]

    @http.route('/api/v1/inbox/messages/<int:message_id>/retry', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def retry_message(self, message_id, **_):
        message = visible_message(message_id)
        message._webvue_retry()
        message.conversation_id._webvue_notify_bus()
        return dump_messages(message)[0]

    @http.route('/api/v1/inbox/contacts/<int:contact_id>', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def get_contact(self, contact_id, **_):
        return dump_contact(self._visible_contact(contact_id))

    @http.route('/api/v1/inbox/contacts/<int:contact_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def patch_contact(self, contact_id, **payload):
        contact = self._visible_contact(contact_id)
        check_fields(payload, {'name', 'email'})
        values = {}
        if 'name' in payload:
            values['name'] = parse_text(payload, 'name', 128)
        if 'email' in payload:
            email = payload['email']
            if email is not None and not (isinstance(email, str) and email_normalize(email)):
                reject('email is not a valid address', 'email')
            values['email'] = email_normalize(email) if email else False
        contact.write(values)
        return dump_contact(contact)

    @staticmethod
    def _visible_contact(contact_id):
        """A contact is visible only through a conversation the caller may see."""
        conversation = request.env['webvue.inbox.conversation']._webvue_search_visible(
            [('contact_id', '=', contact_id)], limit=1,
        )
        if not conversation:
            raise not_found()
        return conversation.contact_id

    @http.route('/api/v1/inbox/agents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def list_agents(self, **_):
        """The assignee picker: active users of the company who can reply."""
        args = request.httprequest.args
        limit, offset = parse_page(args)
        service = request.env['webvue.access.service']
        candidates = request.env.ref('webvue_inbox.group_cap_inbox_conversations_reply').all_user_ids.filtered(
            lambda user: user.active and (args.get('q', '').lower() in user.name.lower())
            and service._webvue_has_capability(user, REPLY),
        ).sorted('name')
        return {'items': [dump_ref(user) for user in candidates[offset:offset + limit]], 'total': len(candidates)}

    @http.route('/api/v1/inbox/canned-replies', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def list_canned_replies(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Canned = request.env['webvue.inbox.canned.reply']
        return {'items': [dump_canned_reply(r) for r in Canned.search([], limit=limit, offset=offset)], 'total': Canned.search_count([])}
