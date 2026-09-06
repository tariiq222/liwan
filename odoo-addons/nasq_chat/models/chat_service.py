# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import AccessError, MissingError
from odoo.fields import Domain
from odoo.tools.mail import plaintext2html

from odoo.addons.nasq_api.controllers.common import ApiError, parse_positive_int

CHAT_TYPES = ('chat', 'group')
LIST_FILTERS = frozenset({'all', 'unread', 'groups'})
MAX_LIMIT = 50


class NasqChatService(models.AbstractModel):
    _name = 'nasq.chat.service'
    _description = 'Nasq Chat Service'

    @api.model
    def _nasq_require_chat_access(self):
        """Active internal Nasq users only. Admins are not exempt later."""
        user = self.env.user
        if not self._nasq_is_internal_chat_user(user):
            raise AccessError(self.env._('Chat is limited to active internal Nasq users.'))

    @api.model
    def _nasq_is_internal_chat_user(self, user):
        if (
            not user
            or not user.active
            or user.share
            or user._is_public()
            or self.env.company not in user.company_ids
        ):
            return False
        if user.has_group('nasq_core.group_employee'):
            return True
        access_service = self.env['nasq.access.service']
        keys = access_service._nasq_capability_keys(user, company=self.env.company)
        if keys:
            return True
        identity = access_service._nasq_identity(user)
        return any(role.get('source') == 'assignment' for role in identity['roles'])

    @api.model
    def _nasq_eligible_user_domain(self, include_self=False):
        domain = [
            ('active', '=', True),
            ('share', '=', False),
            ('company_ids', 'in', [self.env.company.id]),
        ]
        if not include_self:
            domain.append(('id', '!=', self.env.uid))
        return domain

    @api.model
    def _nasq_internal_users(self, users):
        return users.filtered(self._nasq_is_internal_chat_user)

    @api.model
    def _nasq_search_recipients(self, q=None, limit=20, offset=0):
        self._nasq_require_chat_access()
        domain = self._nasq_eligible_user_domain()
        if q:
            domain.append(('name', 'ilike', q))
        users = self._nasq_internal_users(
            self.env['res.users'].search(domain, order='name, id'),
        )
        return users[offset:offset + limit], len(users)

    @api.model
    def _nasq_resolve_recipient_partners(self, user_ids):
        self._nasq_require_chat_access()
        if not isinstance(user_ids, list) or not user_ids:
            raise ApiError(422, 'invalid', 'user_ids must be a non-empty list', field='user_ids')
        parsed = []
        seen = set()
        for raw in user_ids:
            user_id = parse_positive_int(raw, 'user_ids')
            if user_id == self.env.uid:
                raise ApiError(422, 'invalid', 'cannot chat with yourself', field='user_ids')
            if user_id not in seen:
                seen.add(user_id)
                parsed.append(user_id)
        users = self._nasq_internal_users(self.env['res.users'].search(
            [('id', 'in', parsed)] + self._nasq_eligible_user_domain(),
        ))
        if set(users.ids) != set(parsed):
            raise ApiError(
                422, 'invalid',
                'recipient must be an active internal user in the current company',
                field='user_ids',
            )
        return users.mapped('partner_id')

    @api.model
    def _nasq_self_member(self, channel):
        return self.env['discuss.channel.member'].search([
            ('channel_id', '=', channel.id),
            ('partner_id', '=', self.env.user.partner_id.id),
        ], limit=1)

    @api.model
    def _nasq_member_channel(self, channel_id):
        """Load a native chat/group only when the caller is an explicit member."""
        self._nasq_require_chat_access()
        channel = self.env['discuss.channel'].browse(int(channel_id))
        if not channel.exists() or channel.channel_type not in CHAT_TYPES:
            raise MissingError(self.env._('Conversation %(id)s does not exist', id=channel_id))
        try:
            channel.check_access('read')
        except AccessError:
            raise AccessError(self.env._('You are not a member of this conversation.')) from None
        member = self._nasq_self_member(channel)
        if not member:
            # Stock group_system can read every channel. Nasq still requires membership.
            raise AccessError(self.env._('You are not a member of this conversation.'))
        return channel

    @api.model
    def _nasq_comment_domain(self, channel_ids):
        return [
            ('model', '=', 'discuss.channel'),
            ('res_id', 'in', list(channel_ids)),
            ('message_type', '=', 'comment'),
        ]

    @api.model
    def _nasq_last_comments(self, channels):
        if not channels:
            return {}
        messages = self.env['mail.message'].search(
            self._nasq_comment_domain(channels.ids),
            order='id desc',
        )
        last = {}
        for message in messages:
            last.setdefault(message.res_id, message)
        return last

    @api.model
    def _nasq_list_channels(self, q=None, list_filter='all'):
        self._nasq_require_chat_access()
        if list_filter not in LIST_FILTERS:
            raise ApiError(422, 'invalid', "filter must be all, unread, or groups", field='filter')
        domain = Domain('is_member', '=', True)
        if list_filter == 'groups':
            domain &= Domain('channel_type', '=', 'group')
        else:
            domain &= Domain('channel_type', 'in', list(CHAT_TYPES))
        if q:
            domain &= Domain('name', 'ilike', q) | Domain('channel_partner_ids.name', 'ilike', q)
        channels = self.env['discuss.channel'].search(domain, order='last_interest_dt desc, id desc')
        if list_filter == 'unread':
            # Unread is computed on the member. Filter before the caller pages.
            channels = channels.filtered(
                lambda channel: channel.self_member_id and channel.self_member_id.message_unread_counter > 0,
            )
        return channels

    @api.model
    def _nasq_create_channel(self, user_ids, name=None):
        partners = self._nasq_resolve_recipient_partners(user_ids)
        if name is not None and not isinstance(name, str):
            raise ApiError(422, 'invalid', 'name must be a string', field='name')
        title = (name or '').strip()
        Channel = self.env['discuss.channel']
        if len(partners) == 1:
            if title:
                raise ApiError(422, 'invalid', 'direct chats do not take a name', field='name')
            return Channel._get_or_create_chat(partners.ids)
        if len(partners) < 2:
            raise ApiError(422, 'invalid', 'a group needs at least two other users', field='user_ids')
        # Native _create_group does not add the caller. Include the creator explicitly.
        member_ids = (partners | self.env.user.partner_id).ids
        return Channel._create_group(member_ids, name=title)

    @api.model
    def _nasq_channel_messages(self, channel, before=None, after=None, limit=50):
        domain = self._nasq_comment_domain([channel.id])
        if before is not None and after is not None:
            raise ApiError(422, 'invalid', 'pass before or after, not both')
        if before is not None:
            domain.append(('id', '<', parse_positive_int(before, 'before')))
        if after is not None:
            domain.append(('id', '>', parse_positive_int(after, 'after')))
        total = self.env['mail.message'].search_count(self._nasq_comment_domain([channel.id]))
        order = 'id asc' if after is not None else 'id desc'
        messages = self.env['mail.message'].search(domain, order=order, limit=limit)
        return messages.sorted(key=lambda message: message.id), total

    @api.model
    def _nasq_post_message(self, channel, body=None, attachment=None):
        text = body if isinstance(body, str) else ''
        if not text.strip() and not attachment:
            raise ApiError(422, 'invalid', 'body must not be empty', field='body')
        if body is not None and not isinstance(body, str):
            raise ApiError(422, 'invalid', 'body must be a string', field='body')
        attachments = None
        if attachment:
            attachments = [(attachment['name'], attachment['raw'])]
        return channel.message_post(
            body=plaintext2html(text),
            message_type='comment',
            subtype_xmlid='mail.mt_comment',
            attachments=attachments,
        )

    @api.model
    def _nasq_mark_read(self, channel, message_id):
        member = self._nasq_self_member(channel)
        if not member:
            raise AccessError(self.env._('You are not a member of this conversation.'))
        observed = parse_positive_int(message_id, 'message_id')
        message = self.env['mail.message'].search([
            ('id', '=', observed),
            ('model', '=', 'discuss.channel'),
            ('res_id', '=', channel.id),
            ('message_type', '=', 'comment'),
        ], limit=1)
        if not message:
            raise MissingError(self.env._('Message %(id)s does not exist', id=observed))
        member._mark_as_read(message.id)
        return channel

    @api.model
    def _nasq_channel_members(self, channel):
        partners = channel.channel_member_ids.partner_id
        return self._nasq_internal_users(self.env['res.users'].search(
            [('partner_id', 'in', partners.ids)] + self._nasq_eligible_user_domain(include_self=True),
            order='name, id',
        ))

    @api.model
    def _nasq_channel_attachments(self, channel):
        messages = self.env['mail.message'].search(self._nasq_comment_domain([channel.id]))
        return messages.attachment_ids.filtered(
            lambda attachment: attachment.type == 'binary' and not attachment.url,
        ).sorted(key=lambda attachment: attachment.id, reverse=True)
