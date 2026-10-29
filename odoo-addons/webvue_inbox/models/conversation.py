# Part of Odoo. See LICENSE file for full copyright and licensing details.
from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError
from odoo.fields import Domain

from .access_service import ASSIGN, READ
from .constants import (
    CSAT_SCORES,
    PREVIEW_LENGTH,
    REPLY_WINDOW,
    STALE_UPLOAD_AGE,
    TYPING_THROTTLE,
)
from .notification_types import KINDS

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
    # The last typing request (the throttle marker) and whether the outbox still has to send it.
    typing_requested_at = fields.Datetime(copy=False)
    typing_pending = fields.Boolean(default=False, index=True, copy=False)
    # Automation: when the away message was last sent, since when the customer waits for an agent (null once an
    # agent replied), whether that wait was already alerted (reset by the next agent reply), and the customer's
    # answer to the satisfaction survey.
    away_sent_at = fields.Datetime(copy=False)
    waiting_since = fields.Datetime(compute='_compute_waiting_since', store=True, index=True)
    first_response_alerted = fields.Boolean(default=False, copy=False)
    csat_score = fields.Selection([('good', 'Good'), ('neutral', 'Neutral'), ('bad', 'Bad')], copy=False, index=True)
    csat_at = fields.Datetime(copy=False)

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

    @api.depends('message_ids.direction', 'message_ids.date', 'message_ids.author_id', 'message_ids.selected_option_id')
    def _compute_waiting_since(self):
        for conversation in self:
            messages = conversation.message_ids
            last_reply = max(messages.filtered(lambda m: m.direction == 'out' and m.author_id).mapped('date'), default=False)
            # A survey answer (tapping a csat_* button) asks for nothing: it never starts or backdates a wait.
            waiting = messages.filtered(
                lambda m: m.direction == 'in' and m.selected_option_id not in CSAT_SCORES and (not last_reply or m.date > last_reply),
            )
            conversation.waiting_since = min(waiting.mapped('date'), default=False)

    def _webvue_latest_inbound(self):
        """The newest inbound message the provider knows (a read receipt or typing call names it)."""
        inbound = self.message_ids.filtered(lambda message: message.direction == 'in' and message.provider_message_id)
        return inbound.sorted(lambda message: (message.date, message.id))[-1:]

    def _webvue_replied_since(self, moment):
        """True when an agent reply was queued at or after `moment`: that reply ends the typing it followed."""
        return any(message.direction == 'out' and message.date >= moment for message in self.message_ids)

    def _webvue_request_read_receipt(self):
        """Queue the read receipt of the newest inbound message; older ones are read with it."""
        self._webvue_latest_inbound()._webvue_request_read_receipt()

    def _webvue_request_typing(self):
        """Record that an agent is typing; the outbox shows it to the customer. Throttled, inside the window only."""
        self.ensure_one()
        now = fields.Datetime.now()
        window_open = self.reply_window_ends_at and now <= self.reply_window_ends_at
        throttled = self.typing_requested_at and now - self.typing_requested_at < TYPING_THROTTLE
        if not self._webvue_latest_inbound() or not window_open or throttled:
            return
        if self.state == 'closed' or self.channel_id.state == 'disabled':
            return
        self.write({'typing_requested_at': now, 'typing_pending': True})
        self.env['webvue.inbox.message']._webvue_wake_outbox()

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
                self.env['webvue.inbox.conversation.cycle']._webvue_end_for(idle, 'auto_closed')
                idle.write({'state': 'closed'})
            self._webvue_purge_expired(company, now - relativedelta(months=settings.retention_months))
            self.env['webvue.inbox.report.build']._webvue_purge(company, now)
        self.env['webvue.inbox.event']._webvue_purge_processed(now)
        self._webvue_purge_stale_uploads(now)
        self.env['webvue.inbox.channel']._webvue_purge_alerts(now)

    @api.model
    def _webvue_purge_stale_uploads(self, now):
        """Delete files uploaded to a conversation (for a reply) or loose (a template header sample) that nothing ever used."""
        self.env['ir.attachment'].search([
            '|', ('res_model', '=', self._name), '&', ('res_model', '=', 'webvue.inbox.template'), ('res_id', '=', 0),
            ('create_date', '<', now - STALE_UPLOAD_AGE),
        ]).unlink()

    @api.model
    def _webvue_purge_expired(self, company, cutoff):
        """Delete the company's conversations idle since `cutoff` with their attachments and bell rows, stale events and orphaned contacts."""
        expired = self.search([('company_id', '=', company.id), ('last_message_at', '<', cutoff)])
        self.env['mail.message'].search([
            ('webvue_notification_kind', 'in', KINDS), ('webvue_inbox_conversation_id', 'in', expired.ids),
        ]).unlink()
        self.env['webvue.inbox.event']._webvue_purge_unprocessed(company, cutoff)
        self.env['ir.attachment'].search([
            '|', '&', ('res_model', '=', 'webvue.inbox.message'), ('res_id', 'in', expired.message_ids.ids),
            '&', ('res_model', '=', self._name), ('res_id', 'in', expired.ids),
        ]).unlink()
        expired.unlink()
        self.env['webvue.inbox.contact'].search([
            ('company_id', '=', company.id), ('conversation_ids', '=', False),
        ]).unlink()
