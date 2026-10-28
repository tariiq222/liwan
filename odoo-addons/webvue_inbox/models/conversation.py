# Part of Odoo. See LICENSE file for full copyright and licensing details.
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError
from odoo.fields import Domain

from .access_service import ASSIGN, READ
from .constants import PREVIEW_LENGTH, REPLY_WINDOW

BUS_CHANNEL = 'webvue/inbox'


class WebVueInboxConversation(models.Model):
    _name = 'webvue.inbox.conversation'
    _description = 'Customer Inbox conversation'
    _order = 'last_message_at desc, id desc'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    channel_id = fields.Many2one('webvue.inbox.channel', required=True, index=True, ondelete='restrict')
    contact_id = fields.Many2one('webvue.inbox.contact', required=True, index=True, ondelete='restrict')
    identity_id = fields.Many2one('webvue.inbox.contact.identity', required=True, index=True, ondelete='restrict')
    department_id = fields.Many2one('webvue.inbox.department', index=True, ondelete='set null')
    assignee_id = fields.Many2one('res.users', index=True, ondelete='set null')
    state = fields.Selection(
        [('open', 'Open'), ('pending', 'Pending'), ('resolved', 'Resolved'), ('closed', 'Closed')],
        required=True, default='open', index=True,
    )
    priority = fields.Selection(
        [('low', 'Low'), ('normal', 'Normal'), ('high', 'High'), ('urgent', 'Urgent')],
        required=True, default='normal',
    )
    tag_ids = fields.Many2many('webvue.inbox.tag', 'webvue_inbox_conversation_tag_rel', 'conversation_id', 'tag_id')
    unread = fields.Boolean(default=False)
    message_ids = fields.One2many('webvue.inbox.message', 'conversation_id')
    # Notes are internal, so they never count as the last message or as activity.
    last_message_at = fields.Datetime(compute='_compute_last_message', store=True, index=True)
    last_message_preview = fields.Char(compute='_compute_last_message', store=True)
    last_inbound_at = fields.Datetime(compute='_compute_last_inbound', store=True)
    reply_window_ends_at = fields.Datetime(compute='_compute_last_inbound', store=True)

    _one_open_per_identity = models.UniqueIndex(
        "(channel_id, identity_id) WHERE state != 'closed'",
        'A customer has one open conversation per channel.',
    )

    @api.depends('message_ids.direction', 'message_ids.date', 'message_ids.body')
    def _compute_last_message(self):
        for conversation in self:
            customer_visible = conversation.message_ids.filtered(lambda message: message.direction != 'note')
            last = customer_visible.sorted(lambda message: (message.date, message.id))[-1:]
            conversation.last_message_at = last.date
            conversation.last_message_preview = ' '.join(last.body.split())[:PREVIEW_LENGTH] if last else False

    @api.depends('message_ids.direction', 'message_ids.date')
    def _compute_last_inbound(self):
        for conversation in self:
            inbound = conversation.message_ids.filtered(lambda message: message.direction == 'in')
            last = max(inbound.mapped('date'), default=False)
            conversation.last_inbound_at = last
            conversation.reply_window_ends_at = last + REPLY_WINDOW if last else False

    @api.constrains('state')
    def _check_single_open(self):
        for conversation in self.filtered(lambda c: c.state != 'closed'):
            clash = self.search_count([
                ('id', '!=', conversation.id), ('channel_id', '=', conversation.channel_id.id),
                ('identity_id', '=', conversation.identity_id.id), ('state', '!=', 'closed'),
            ])
            if clash:
                raise ValidationError(self.env._('This customer already has an open conversation on the channel.'))

    # visibility

    @api.model
    def _webvue_visible_domain(self, user=None):
        """The one definition of which conversations `user` may see (policy of the user's company)."""
        user = user or self.env.user
        service = self.env['webvue.access.service']
        if service._webvue_has_capability(user, ASSIGN):
            return Domain.TRUE
        policy = self.env['webvue.inbox.settings']._get_for_company().visibility_policy
        if policy == 'all':
            return Domain.TRUE
        mine = Domain('assignee_id', '=', user.id)
        if policy == 'assigned_only':
            return mine
        return (
            mine
            | Domain('department_id.member_ids', 'in', [user.id])
            | (Domain('assignee_id', '=', False) & Domain('department_id', '=', False))
        )

    @api.model
    def _webvue_search_visible(self, domain=(), **kwargs):
        return self.search(Domain.AND([Domain(list(domain)), self._webvue_visible_domain()]), **kwargs)

    @api.model
    def _webvue_count_visible(self, domain=()):
        return self.search_count(Domain.AND([Domain(list(domain)), self._webvue_visible_domain()]))

    def _webvue_recipients(self):
        """Active users who hold the read capability and may see this conversation (bus audience)."""
        self.ensure_one()
        scoped = self.with_company(self.company_id)
        service = scoped.env['webvue.access.service']
        readers = scoped.env.ref('webvue_inbox.group_cap_inbox_conversations_read').all_user_ids.filtered('active')
        return readers.filtered(
            lambda user: service._webvue_has_capability(user, READ, company=self.company_id)
            and self.filtered_domain(scoped._webvue_visible_domain(user)),
        )

    def _webvue_notify_bus(self):
        """Tell every user who may see each conversation that it changed (id only, no content)."""
        bus = self.env['bus.bus']
        for conversation in self:
            for user in conversation._webvue_recipients():
                bus._sendone(user.partner_id, BUS_CHANNEL, {'event': 'conversation', 'id': conversation.id})

    # maintenance (cron)

    @api.model
    def _webvue_run_maintenance(self):
        """Close idle conversations, purge data past retention and delete processed events."""
        now = fields.Datetime.now()
        for company in self.env['res.company'].search([]):
            settings = self.env['webvue.inbox.settings']._get_for_company(company)
            if settings.auto_close_hours:
                idle = self.search([
                    ('company_id', '=', company.id), ('state', '!=', 'closed'),
                    ('last_message_at', '<', now - relativedelta(hours=settings.auto_close_hours)),
                ])
                idle.write({'state': 'closed'})
            self._webvue_purge_expired(company, now - relativedelta(months=settings.retention_months))
        self.env['webvue.inbox.event']._webvue_purge_processed(now)

    @api.model
    def _webvue_purge_expired(self, company, cutoff):
        """Delete the company's conversations idle since `cutoff` with their attachments and bell rows, stale events and orphaned contacts."""
        expired = self.search([('company_id', '=', company.id), ('last_message_at', '<', cutoff)])
        self.env['mail.message'].search([
            ('webvue_notification_kind', '=', 'inbox.assigned'), ('webvue_inbox_conversation_id', 'in', expired.ids),
        ]).unlink()
        self.env['webvue.inbox.event']._webvue_purge_unprocessed(company, cutoff)
        self.env['ir.attachment'].search([
            ('res_model', '=', 'webvue.inbox.message'), ('res_id', 'in', expired.message_ids.ids),
        ]).unlink()
        expired.unlink()
        self.env['webvue.inbox.contact'].search([
            ('company_id', '=', company.id), ('conversation_ids', '=', False),
        ]).unlink()
