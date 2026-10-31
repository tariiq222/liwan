# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.http import request
from odoo.tools.mail import email_normalize

from odoo.addons.liwan_api.controllers.common import (
    ApiError,
    api_handler,
    parse_page,
    parse_positive_int,
    require_capabilities,
    requires_capability,
    requires_feature,
)
from odoo.addons.liwan_inbox.controllers.helpers import (
    CONVERSATION_STATES,
    check_fields,
    find_agent,
    find_ids,
    find_one,
    no_content,
    not_found,
    parse_ids,
    parse_text,
    reject,
    unique_as_invalid,
    visible_conversation,
    visible_message,
)
from odoo.addons.liwan_inbox.controllers.reply_parsing import MAX_BODY
from odoo.addons.liwan_inbox.models.access_service import (
    ASSIGN,
    MANAGE_AUTOMATION,
    MANAGE_SETTINGS,
    READ,
    REPLY,
)
from odoo.addons.liwan_inbox.serializers.conversation import (
    dump_contact,
    dump_conversation,
    dump_conversation_detail,
    dump_messages,
    dump_ref,
)
from odoo.addons.liwan_inbox.serializers.settings import dump_canned_reply

PRIORITIES = ('low', 'normal', 'high', 'urgent')
CSAT_SCORES = ('good', 'neutral', 'bad')
PATCH_FIELDS = {'revision', 'state', 'priority', 'tag_ids', 'assignee_id', 'department_id'}
REPLY_FIELDS = {'state', 'priority', 'tag_ids'}
ASSIGN_FIELDS = {'assignee_id', 'department_id'}


def conversation_domain(args):
    """The list filters of the query string (state, priority, assignee, department_id, channel_id, csat, q)."""
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
    if args.get('csat'):
        if args['csat'] not in CSAT_SCORES:
            reject(f'csat must be one of {CSAT_SCORES}', 'csat')
        domain.append(('csat_score', '=', args['csat']))
    if args.get('priority'):
        if args['priority'] not in PRIORITIES:
            reject(f'priority must be one of {PRIORITIES}', 'priority')
        domain.append(('priority', '=', args['priority']))
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
    service = request.env['liwan.access.service']
    user = request.env.user
    return dump_conversation_detail(
        conversation, service._liwan_has_capability(user, REPLY), service._liwan_has_capability(user, ASSIGN),
    )


def parse_assignment(conversation, payload):
    values = {}
    if 'assignee_id' in payload:
        values['assignee_id'] = (
            find_agent(payload['assignee_id'], 'assignee_id', conversation.company_id) if payload['assignee_id'] is not None else False
        )
    if 'department_id' in payload:
        values['department_id'] = (
            find_one('liwan.inbox.department', payload['department_id'], 'department_id').id
            if payload['department_id'] is not None else False
        )
    return values


def check_revision(conversation, payload):
    """A second editor of a conversation changed since the caller read it: 409, so the first edit is never overwritten."""
    revision = payload.pop('revision')
    if type(revision) is not int or revision < 1:
        reject('revision must be a positive integer', 'revision')
    if revision != conversation.revision:
        raise ApiError(409, 'stale_write', 'the conversation changed; reload before saving', field='revision', details={'reason': 'inbox_conversation_stale'})


def parse_patch(conversation, payload):
    check_fields(payload, PATCH_FIELDS, required=('revision',))
    check_revision(conversation, payload)
    if not payload:
        reject('no fields to update')
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
        values['tag_ids'] = [(6, 0, find_ids('liwan.inbox.tag', ids, 'tag_ids').ids)]
    return values


class ConversationController(http.Controller):

    @http.route('/api/v1/inbox/conversations', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def list_conversations(self, **_):
        args = request.httprequest.args
        limit, offset = parse_page(args)
        domain = conversation_domain(args)
        Conversation = request.env['liwan.inbox.conversation']
        return {
            'items': [dump_conversation(c) for c in Conversation._liwan_search_visible(domain, limit=limit, offset=offset)],
            'total': Conversation._liwan_count_visible(domain),
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
        """Clear the unread flag and, for an agent who can reply, queue the read receipt; the UI calls this when it opens a conversation."""
        conversation = visible_conversation(conversation_id)
        if conversation.unread:
            conversation.unread = False
        if request.env['liwan.access.service']._liwan_has_capability(request.env.user, REPLY):
            conversation._liwan_request_read_receipt()
        return no_content()

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(READ)
    def patch_conversation(self, conversation_id, **payload):
        conversation = visible_conversation(conversation_id)
        previous, was_resolved = conversation.assignee_id, conversation.state == 'resolved'
        with unique_as_invalid('state', 'this customer already has an open conversation on the channel', 'inbox_customer_has_open_conversation'):
            conversation.write(parse_patch(conversation, payload))
        if conversation.assignee_id != previous:
            conversation._liwan_notify_assigned(actor=request.env.user)
        if conversation.state == 'resolved' and not was_resolved:
            conversation._liwan_send_csat_survey()
        conversation._liwan_notify_bus()
        return detail(conversation)

    @http.route('/api/v1/inbox/conversations/<int:conversation_id>/messages', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ)
    def list_messages(self, conversation_id, **_):
        conversation = visible_conversation(conversation_id)
        args = request.httprequest.args
        if args.get('limit') == '0':
            reject('limit must be at least 1', 'limit')
        limit, offset = parse_page(args)
        Message = request.env['liwan.inbox.message']
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
        note = request.env['liwan.inbox.message']._liwan_post_note(conversation, parse_text(payload, 'body', MAX_BODY))
        conversation._liwan_notify_bus()
        return dump_messages(note)[0]

    @http.route('/api/v1/inbox/messages/<int:message_id>/retry', type='json2', auth='user', methods=['POST'], readonly=False)
    @api_handler
    @requires_feature('inbox.enabled', operation='write')
    @requires_capability(REPLY)
    def retry_message(self, message_id, **_):
        message = visible_message(message_id)
        message._liwan_retry()
        message.conversation_id._liwan_notify_bus()
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
        conversation = request.env['liwan.inbox.conversation']._liwan_search_visible(
            [('contact_id', '=', contact_id)], limit=1,
        )
        if not conversation:
            raise not_found()
        return conversation.contact_id

    @http.route('/api/v1/inbox/agents', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ, MANAGE_AUTOMATION, match='any')
    def list_agents(self, **_):
        """The assignee picker: active users of the company who can reply."""
        args = request.httprequest.args
        limit, offset = parse_page(args)
        service = request.env['liwan.access.service']
        candidates = request.env.ref('liwan_inbox.group_cap_inbox_conversations_reply').all_user_ids.filtered(
            lambda user: user.active and (args.get('q', '').lower() in user.name.lower())
            and service._liwan_has_capability(user, REPLY),
        ).sorted('name')
        return {'items': [dump_ref(user) for user in candidates[offset:offset + limit]], 'total': len(candidates)}

    @http.route('/api/v1/inbox/canned-replies', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature('inbox.enabled', operation='read')
    @requires_capability(READ, MANAGE_SETTINGS, match='any')
    def list_canned_replies(self, **_):
        limit, offset = parse_page(request.httprequest.args)
        Canned = request.env['liwan.inbox.canned.reply']
        return {'items': [dump_canned_reply(r) for r in Canned.search([], limit=limit, offset=offset)], 'total': Canned.search_count([])}
