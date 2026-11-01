# Part of Odoo. See LICENSE file for full copyright and licensing details.
from markupsafe import Markup

from odoo import api, models
from odoo.exceptions import AccessError, MissingError
from odoo.fields import Domain
from odoo.tools.mail import plaintext2html

from odoo.addons.liwan_api.controllers.common import ApiError, parse_positive_int

CHAT_TYPES = ('chat', 'group', 'channel')
LIST_FILTERS = frozenset({'all', 'unread', 'groups', 'channels', 'starred'})
MAX_LIMIT = 50
MEMBER_REMOVED_NOTICE = 'liwan_member_removed'


class LiwanChatService(models.AbstractModel):
    _name = 'liwan.chat.service'
    _description = 'LiwanOS Chat Service'
    _liwan_scope = 'global'

    @api.model
    def _liwan_require_chat_access(self):
        """Active internal LiwanOS users only. Admins are not exempt later."""
        user = self.env.user
        if not self._liwan_is_internal_chat_user(user):
            raise AccessError(self.env._('Chat is limited to active internal LiwanOS users.'))

    @api.model
    def _liwan_is_internal_chat_user(self, user):
        if (
            not user
            or not user.active
            or user.share
            or user._is_public()
            or self.env.company not in user.company_ids
        ):
            return False
        if user.has_group('liwan_core.group_employee'):
            return True
        access_service = self.env['liwan.access.service']
        keys = access_service._liwan_capability_keys(user, company=self.env.company)
        if keys:
            return True
        identity = access_service._liwan_identity(user)
        return any(role.get('source') == 'assignment' for role in identity['roles'])

    @api.model
    def _liwan_eligible_user_domain(self, include_self=False):
        domain = [
            ('active', '=', True),
            ('share', '=', False),
            ('company_ids', 'in', [self.env.company.id]),
        ]
        if not include_self:
            domain.append(('id', '!=', self.env.uid))
        return domain

    @api.model
    def _liwan_internal_users(self, users):
        return users.filtered(self._liwan_is_internal_chat_user)

    @api.model
    def _liwan_search_recipients(self, q=None, limit=20, offset=0):
        self._liwan_require_chat_access()
        domain = self._liwan_eligible_user_domain()
        if q:
            domain.append(('name', 'ilike', q))
        users = self._liwan_internal_users(
            self.env['res.users'].search(domain, order='name, id'),
        )
        return users[offset:offset + limit], len(users)

    @api.model
    def _liwan_resolve_recipient_partners(self, user_ids):
        return self._liwan_resolve_user_partners(user_ids, include_self=False)

    @api.model
    def _liwan_resolve_user_partners(self, user_ids, include_self=True, allow_empty=False):
        self._liwan_require_chat_access()
        if not isinstance(user_ids, list) or (not user_ids and not allow_empty):
            raise ApiError(422, 'invalid', 'user_ids must be a non-empty list', field='user_ids')
        parsed = []
        seen = set()
        for raw in user_ids:
            user_id = parse_positive_int(raw, 'user_ids')
            if not include_self and user_id == self.env.uid:
                raise ApiError(422, 'invalid', 'cannot chat with yourself', field='user_ids')
            if user_id not in seen:
                seen.add(user_id)
                parsed.append(user_id)
        domain = [('id', 'in', parsed)] + self._liwan_eligible_user_domain(include_self=include_self)
        users = self._liwan_internal_users(self.env['res.users'].search(domain))
        if set(users.ids) != set(parsed):
            raise ApiError(
                422, 'invalid',
                'recipient must be an active internal user in the current company',
                field='user_ids',
            )
        return users.mapped('partner_id')

    @api.model
    def _liwan_self_member(self, channel):
        return self.env['discuss.channel.member'].search([
            ('channel_id', '=', channel.id),
            ('partner_id', '=', self.env.user.partner_id.id),
        ], limit=1)

    @api.model
    def _liwan_member_channel(self, channel_id):
        """Load a native chat/group only when the caller is an explicit member."""
        self._liwan_require_chat_access()
        channel = self.env['discuss.channel'].browse(int(channel_id))
        if not channel.exists():
            raise MissingError(self.env._('Conversation %(id)s does not exist', id=channel_id))
        # The access check comes before any field is read: reading one of a channel the caller cannot see
        # raises Odoo's own refusal, which names the model and the user instead of the documented text.
        # A channel of another type answers like an unreadable one, so the answer does not tell them apart.
        not_member = AccessError(self.env._('You are not a member of this conversation.'))
        try:
            channel.check_access('read')
        except AccessError:
            raise not_member from None
        if channel.channel_type not in CHAT_TYPES:
            raise not_member
        member = self._liwan_self_member(channel)
        if not member:
            # Stock group_system can read every channel. LiwanOS still requires membership.
            raise AccessError(self.env._('You are not a member of this conversation.'))
        return channel

    @api.model
    def _liwan_comment_domain(self, channel_ids):
        return [
            ('model', '=', 'discuss.channel'),
            ('res_id', 'in', list(channel_ids)),
            ('message_type', '=', 'comment'),
        ]

    @api.model
    def _liwan_last_comments(self, channels):
        if not channels:
            return {}
        messages = self.env['mail.message'].search(
            self._liwan_comment_domain(channels.ids),
            order='id desc',
        )
        last = {}
        for message in messages:
            last.setdefault(message.res_id, message)
        return last

    @api.model
    def _liwan_list_channels(self, q=None, list_filter='all'):
        self._liwan_require_chat_access()
        if list_filter not in LIST_FILTERS:
            raise ApiError(422, 'invalid', "filter must be all, unread, groups, channels, or starred", field='filter')
        domain = Domain('is_member', '=', True)
        if list_filter == 'groups':
            domain &= Domain('channel_type', '=', 'group')
        elif list_filter == 'channels':
            domain &= Domain('channel_type', '=', 'channel')
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
        elif list_filter == 'starred':
            starred_ids = self.env['mail.message'].search([
                ('model', '=', 'discuss.channel'),
                ('message_type', '=', 'comment'),
                ('starred_partner_ids', 'in', self.env.user.partner_id.id),
            ]).mapped('res_id')
            channels = channels.filtered(lambda channel: channel.id in starred_ids)
        return channels

    @api.model
    def _liwan_create_channel(self, user_ids=None, name=None, channel_type=None):
        self._liwan_require_chat_access()
        if channel_type not in (None, 'direct', 'group', 'channel'):
            raise ApiError(422, 'invalid', 'type must be direct, group, or channel', field='type')
        if channel_type == 'channel':
            if not isinstance(name, str) or not name.strip():
                raise ApiError(422, 'invalid', 'name must not be empty', field='name')
            # Managed accounts hold base.group_user, not the legacy employee group, so the
            # channel's own read rule (group_public_id) must name the group every account holds.
            group = self.env.ref('base.group_user')
            return self.env['discuss.channel']._create_channel(name.strip(), group.id)
        partners = self._liwan_resolve_recipient_partners(user_ids)
        if name is not None and not isinstance(name, str):
            raise ApiError(422, 'invalid', 'name must be a string', field='name')
        title = (name or '').strip()
        Channel = self.env['discuss.channel']
        if channel_type == 'direct' and len(partners) != 1:
            raise ApiError(422, 'invalid', 'a direct chat needs one other user', field='user_ids')
        if channel_type == 'group' and len(partners) < 2:
            raise ApiError(422, 'invalid', 'a group needs at least two other users', field='user_ids')
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
    def _liwan_channel_messages(self, channel, before=None, after=None, limit=50, q=None, starred=False):
        base_domain = self._liwan_comment_domain([channel.id])
        domain = list(base_domain)
        if q:
            domain.append(('body', 'ilike', q))
        if starred:
            domain.append(('starred_partner_ids', 'in', self.env.user.partner_id.id))
        if before is not None and after is not None:
            raise ApiError(422, 'invalid', 'pass before or after, not both')
        if before is not None:
            domain.append(('id', '<', parse_positive_int(before, 'before')))
        if after is not None:
            domain.append(('id', '>', parse_positive_int(after, 'after')))
        filtered_domain = list(base_domain)
        if q:
            filtered_domain.append(('body', 'ilike', q))
        if starred:
            filtered_domain.append(('starred_partner_ids', 'in', self.env.user.partner_id.id))
        total = self.env['mail.message'].search_count(filtered_domain)
        order = 'id asc' if after is not None else 'id desc'
        messages = self.env['mail.message'].search(domain, order=order, limit=limit)
        return messages.sorted(key=lambda message: message.id), total

    @api.model
    def _liwan_post_message(self, channel, body=None, attachment=None, parent_id=None, mention_user_ids=None):
        if body is not None and not isinstance(body, str):
            raise ApiError(422, 'invalid', 'body must be a string', field='body')
        text = body or ''
        if not text.strip() and not attachment:
            raise ApiError(422, 'invalid', 'body must not be empty', field='body')
        attachments = None
        if attachment:
            attachments = [(attachment['name'], attachment['raw'])]
        if parent_id is not None:
            parent = self.env['mail.message'].search([
                ('id', '=', parent_id),
                ('model', '=', channel._name),
                ('res_id', '=', channel.id),
                ('message_type', '=', 'comment'),
            ], limit=1)
            if not parent:
                raise MissingError(self.env._('Message %(id)s does not exist', id=parent_id))
        else:
            parent = self.env['mail.message']
        mention_partners = self.env['res.partner']
        if mention_user_ids is not None:
            mention_partners = self._liwan_resolve_user_partners(
                mention_user_ids, include_self=True, allow_empty=True,
            )
            member_partners = channel.channel_member_ids.partner_id
            if mention_partners - member_partners:
                raise ApiError(422, 'invalid', 'mentions must be conversation members', field='mention_user_ids')
        values = {
            'body': plaintext2html(text),
            'message_type': 'comment',
            'subtype_xmlid': 'mail.mt_comment',
            'attachments': attachments,
        }
        if parent:
            values['parent_id'] = parent.id
        if mention_partners:
            values['partner_ids'] = mention_partners.ids
        return channel.message_post(
            **values,
        )

    @api.model
    def _liwan_channel_message(self, channel, message_id):
        message = self.env['mail.message'].search([
            ('id', '=', parse_positive_int(message_id, 'message_id')),
            ('model', '=', channel._name),
            ('res_id', '=', channel.id),
            ('message_type', '=', 'comment'),
        ], limit=1)
        if not message:
            raise MissingError(self.env._('Message %(id)s does not exist', id=message_id))
        return message

    @api.model
    def _liwan_notify_channel(self, channel, event, partner_ids=None, extra=None):
        partners = self.env['res.partner'].browse(
            partner_ids if partner_ids is not None else channel.channel_member_ids.partner_id.ids,
        )
        payload = {'id': channel.id, 'event': event, **(extra or {})}
        bus = self.env['bus.bus']
        for partner in partners:
            bus._sendone(partner, 'liwan/chat', payload)

    @api.model
    def _liwan_delete_message(self, channel, message):
        """Delete a message its author wrote, the way the company chose: clear it to a «deleted» row or remove it for everyone.

        Returns the mode that applied.
        """
        mode = self.env['liwan.chat.settings']._liwan_effective()['message_delete_mode']
        if mode == 'permanent':
            attachments = message.attachment_ids
            message.unlink()
            attachments.unlink()
            return mode
        # sudo: mail.message - the caller proved membership and authorship; clearing a message reads its link previews
        # (`message_link_preview_ids`, base.group_erp_manager only), as the stock thread controller does after its own
        # author check. The same elevated record drops the message's reactions, whose model is system-only.
        message = message.sudo()
        channel._message_update_content(message, body='', attachment_ids=[])
        message.reaction_ids.unlink()
        if message.pinned_at:
            channel.set_message_pin(message.id, False)
        return mode

    @api.model
    def _liwan_mark_read(self, channel, message_id):
        member = self._liwan_self_member(channel)
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
    def _liwan_channel_members(self, channel):
        partners = channel.channel_member_ids.partner_id
        return self._liwan_internal_users(self.env['res.users'].search(
            [('partner_id', 'in', partners.ids)] + self._liwan_eligible_user_domain(include_self=True),
            order='name, id',
        ))

    @api.model
    def _liwan_remove_member(self, channel, user_id):
        """The group's creator removes another member and leaves a notice in the conversation."""
        if channel.channel_type != 'group' or channel.create_uid != self.env.user:
            raise ApiError(403, 'forbidden', 'only the group creator can remove members')
        if user_id == self.env.uid:
            raise ApiError(422, 'invalid', 'leave the conversation instead of removing yourself')
        user = self.env['res.users'].with_context(active_test=False).browse(user_id).exists()
        member = channel.channel_member_ids.filtered(lambda item: user and item.partner_id == user.partner_id)
        if not member:
            raise ApiError(404, 'not_found', 'member does not exist')
        if channel.member_count <= 2:
            raise ApiError(422, 'invalid', 'a group must keep at least two members')
        before = channel.channel_member_ids.partner_id.ids
        # sudo: discuss.channel.member - the stock is_self rule lets a member unlink only their own row; the
        # creator check above is what authorizes removing another member of this group.
        channel.sudo()._action_unfollow(partner=member.partner_id, post_leave_message=False)
        channel.message_post(
            body=Markup('<div class="o_mail_notification" data-oe-type="%s" data-oe-id="%s">%s</div>') % (
                MEMBER_REMOVED_NOTICE, user.id, user.name,
            ),
            message_type='comment',
            subtype_xmlid='mail.mt_comment',
        )
        self._liwan_notify_channel(channel, 'members_updated', before)
        return channel

    @api.model
    def _liwan_channel_attachment(self, channel, attachment_id):
        """One downloadable file of a comment in ``channel``, found by id without scanning the history."""
        message = self.env['mail.message'].search(
            [*self._liwan_comment_domain([channel.id]), ('attachment_ids', 'in', [attachment_id])], limit=1,
        )
        return message.attachment_ids.filtered(
            lambda attachment: attachment.id == attachment_id and attachment.type == 'binary' and not attachment.url,
        )

    @api.model
    def _liwan_channel_attachments(self, channel):
        messages = self.env['mail.message'].search(self._liwan_comment_domain([channel.id]))
        return messages.attachment_ids.filtered(
            lambda attachment: attachment.type == 'binary' and not attachment.url,
        ).sorted(key=lambda attachment: attachment.id, reverse=True)
