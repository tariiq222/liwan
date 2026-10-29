# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A WhatsApp marketing campaign: an approved template sent to an audience, with its schedule and lifecycle."""
from odoo import api, fields, models
from odoo.exceptions import ValidationError
from odoo.fields import Domain

from .campaign_constants import CAMPAIGN_STATES, MAX_DAILY_CAP, PAUSE_REASONS
from .campaign_param import template_needs
from .constants import (
    CAMPAIGN_CRON,
    CAMPAIGN_RECIPIENTS_LIMIT,
    FREQUENCY_RETRY_AFTER,
    MESSAGES_OUT_LIMIT,
    ROLLING_DAY,
)
from .template import APPROVED

EDITABLE_STATES = ('draft', 'scheduled', 'paused')
STAT_KEYS = ('pending', 'skipped', 'queued', 'sent', 'delivered', 'read', 'failed')
# The recipients counted by an extra condition on top of the exclusive state buckets.
EXTRA_STATS = {
    'replied': ('replied_at', '!=', False),
    'unsubscribed': ('unsubscribed_at', '!=', False),
    'held': ('message_id.held_for_quality', '=', True),
}


class WebVueInboxCampaign(models.Model):
    _name = 'webvue.inbox.campaign'
    _description = 'Customer Inbox campaign'
    _order = 'create_date desc, id desc'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)
    channel_id = fields.Many2one('webvue.inbox.channel', required=True, index=True, ondelete='restrict')
    # A template that Meta or an agent deletes leaves the campaign without one; it then pauses as template_unavailable.
    template_id = fields.Many2one('webvue.inbox.template', index=True, ondelete='set null')
    audience_id = fields.Many2one('webvue.inbox.audience', required=True, index=True, ondelete='restrict')
    param_ids = fields.One2many('webvue.inbox.campaign.param', 'campaign_id')
    # The file of a media-header template, and the WhatsApp media id it was uploaded as (once, at the first send).
    header_attachment_id = fields.Many2one('ir.attachment', ondelete='set null')
    header_media_id = fields.Char(copy=False)
    header_media_uploaded_at = fields.Datetime(copy=False)
    state = fields.Selection(CAMPAIGN_STATES, required=True, default='draft', index=True)
    pause_reason = fields.Selection(PAUSE_REASONS)
    pause_detail = fields.Char(size=200)
    scheduled_at = fields.Datetime()
    send_within_hours = fields.Boolean(default=False)
    # Contacts messaged per rolling 24 hours; 0 means only Meta's messaging limit.
    daily_cap = fields.Integer(default=0)
    launched_at = fields.Datetime()
    launched_by_id = fields.Many2one('res.users', ondelete='set null')
    completed_at = fields.Datetime()
    snapshot_done = fields.Boolean(default=False)
    # Consecutive dispatcher steps that failed unexpectedly; the campaign pauses after a few.
    prepare_failures = fields.Integer(default=0)
    # The recipients are purged with the retention window; the campaign then keeps its final statistics here.
    stats_frozen = fields.Boolean(default=False)
    frozen_total = fields.Integer()
    frozen_pending = fields.Integer()
    frozen_skipped = fields.Integer()
    frozen_queued = fields.Integer()
    frozen_sent = fields.Integer()
    frozen_delivered = fields.Integer()
    frozen_read = fields.Integer()
    frozen_failed = fields.Integer()
    frozen_replied = fields.Integer()
    frozen_unsubscribed = fields.Integer()
    frozen_held = fields.Integer()
    recipient_ids = fields.One2many('webvue.inbox.campaign.recipient', 'campaign_id')
    waiting = fields.Selection(
        [('schedule', 'Schedule'), ('working_hours', 'Working hours'), ('daily_cap', 'Daily cap'),
         ('messaging_limit', 'Messaging limit')], compute='_compute_waiting',
    )
    can_edit = fields.Boolean(compute='_compute_can')
    can_delete = fields.Boolean(compute='_compute_can')

    @api.constrains('company_id', 'channel_id', 'template_id', 'audience_id')
    def _check_company(self):
        for campaign in self:
            parts = (campaign.channel_id.owner_company_id, campaign.template_id.company_id, campaign.audience_id.company_id)
            if any(part and part != campaign.company_id for part in parts):
                raise ValidationError(self.env._('The channel, template and audience of a campaign belong to its company.'))

    @api.constrains('daily_cap')
    def _check_daily_cap(self):
        for campaign in self:
            if not 0 <= campaign.daily_cap <= MAX_DAILY_CAP:
                raise ValidationError(self.env._('daily_cap must be between 0 and %(max)s', max=MAX_DAILY_CAP))

    @api.depends('state')
    def _compute_can(self):
        Recipient = self.env['webvue.inbox.campaign.recipient']
        for campaign in self:
            campaign.can_edit = campaign.state in EDITABLE_STATES
            campaign.can_delete = campaign.state != 'running' and not Recipient.search_count(
                [('campaign_id', '=', campaign.id), ('dispatched_at', '!=', False)], limit=1,
            )

    # statistics

    @api.model
    def _webvue_stats(self, campaigns):
        """{campaign id: the contract's stats} for `campaigns`, from a few grouped reads."""
        Recipient = self.env['webvue.inbox.campaign.recipient']
        stats = {campaign.id: dict.fromkeys((*STAT_KEYS, *EXTRA_STATS, 'total'), 0) for campaign in campaigns}
        live = campaigns.filtered(lambda campaign: not campaign.stats_frozen)
        for campaign in campaigns - live:
            stats[campaign.id] = {key: campaign[f'frozen_{key}'] for key in stats[campaign.id]}
        for campaign, state, count in Recipient._read_group([('campaign_id', 'in', live.ids)], ['campaign_id', 'state'], ['__count']):
            stats[campaign.id][state] = count
            stats[campaign.id]['total'] += count
        for key, condition in EXTRA_STATS.items():
            for campaign, count in Recipient._read_group(
                Domain('campaign_id', 'in', live.ids) & Domain([condition]), ['campaign_id'], ['__count'],
            ):
                stats[campaign.id][key] = count
        return stats

    def _compute_waiting(self):
        for campaign in self:
            campaign.waiting = campaign._webvue_waiting_reason()

    def _webvue_waiting_reason(self):
        """Why a scheduled or running campaign is not sending right now (None when it is, or is not meant to)."""
        self.ensure_one()
        now = fields.Datetime.now()
        if self.state == 'scheduled':
            return 'schedule'
        if self.state != 'running':
            return None
        settings = self.env['webvue.inbox.settings']._get_for_company(self.company_id)
        if self.send_within_hours and not settings._webvue_is_open(now):
            return 'working_hours'
        pending = self.env['webvue.inbox.campaign.recipient'].search_count([('campaign_id', '=', self.id), ('state', '=', 'pending')], limit=1)
        if not self.snapshot_done or not pending:
            return None
        if self.daily_cap and self._webvue_dispatched_24h() >= self.daily_cap:
            return 'daily_cap'
        if self.channel_id._webvue_remaining_24h() == 0:
            return 'messaging_limit'
        return None

    def _webvue_dispatched_24h(self):
        """Recipients dispatched in the last rolling 24 hours (what the daily cap counts)."""
        self.ensure_one()
        return self.env['webvue.inbox.campaign.recipient'].search_count([
            ('campaign_id', '=', self.id), ('dispatched_at', '>', fields.Datetime.now() - ROLLING_DAY),
        ])

    # recipients and limits

    @api.model
    def _webvue_limit_rooms(self):
        """(outbound messages room, campaign recipients room) left this month; None means unlimited."""
        entitlement = self.env['webvue.entitlement.service']
        Message = self.env['webvue.inbox.message']
        Recipient = self.env['webvue.inbox.campaign.recipient']
        messages = entitlement._webvue_limit_value(MESSAGES_OUT_LIMIT)
        recipients = entitlement._webvue_limit_value(CAMPAIGN_RECIPIENTS_LIMIT)
        return (
            None if messages is None else max(messages - Message._webvue_count_outbound_this_month(), 0),
            None if recipients is None else max(recipients - Recipient._webvue_count_dispatched_this_month(), 0),
        )

    # actions

    def _webvue_wake(self):
        """Ask the cron worker to run the dispatcher now."""
        self.env['ir.cron'].browse(self.env['ir.model.data']._xmlid_to_res_id(CAMPAIGN_CRON))._trigger()

    def _webvue_require_state(self, *states):
        self.ensure_one()
        if self.state not in states:
            raise ValidationError(self.env._('The campaign is %(state)s; this action needs it to be %(states)s.', state=self.state, states=', '.join(states)))

    def _webvue_template_problem(self):
        """Why the campaign's template cannot be sent (None when it can)."""
        template = self.template_id
        if not template:
            return self.env._('The campaign has no template.')
        if template.channel_id != self.channel_id:
            return self.env._('The template belongs to another channel.')
        if template.status != APPROVED or not template.supported:
            return template.status_reason or self.env._('The template is %(status)s, not approved.', status=template.status)
        if template.category == 'authentication':
            return self.env._('An authentication template cannot be used in a campaign.')
        if template.header_type == 'location':
            return self.env._('A template with a location header cannot be used in a campaign.')
        return None

    def _webvue_params_problem(self):
        template = self.template_id
        if {(param.location, param.position) for param in self.param_ids} != template_needs(template):
            return self.env._('The parameters do not match the placeholders of the template.')
        if template.header_type in ('image', 'video', 'document') and not self.header_attachment_id:
            return self.env._('The template header needs a %(kind)s file.', kind=template.header_type)
        return None

    def _webvue_preflight(self):
        """Raise a 422-style ValidationError for the first reason the campaign cannot be launched."""
        self.ensure_one()
        problem = self._webvue_template_problem() or self._webvue_params_problem()
        if problem:
            raise ValidationError(problem)
        if self.channel_id.state != 'connected':
            raise ValidationError(self.env._('The channel is not connected.'))
        if self.scheduled_at and self.scheduled_at < fields.Datetime.now():
            raise ValidationError(self.env._('scheduled_at is in the past.'))
        if not self.audience_id.reachable_count:
            raise ValidationError(self.env._('The audience has no contact a campaign may message.'))
        if 0 in self._webvue_limit_rooms():
            raise ValidationError(self.env._('The monthly limit of messages or campaign recipients is reached.'))

    def action_launch(self):
        self._webvue_require_state('draft')
        self._webvue_preflight()
        now = fields.Datetime.now()
        waits = self.scheduled_at and self.scheduled_at > now
        self.write({
            'state': 'scheduled' if waits else 'running', 'launched_at': now, 'launched_by_id': self.env.user.id,
        })
        self._webvue_wake()

    def action_pause(self):
        self._webvue_require_state('scheduled', 'running')
        self._webvue_pause('manual')

    def _webvue_pause(self, reason, detail=None):
        """Pause the campaign; the dispatcher then removes its queued, never-sent messages."""
        self.write({'state': 'paused', 'pause_reason': reason, 'pause_detail': (detail or '')[:200] or False})
        self._webvue_wake()

    def action_resume(self):
        self._webvue_require_state('paused')
        waits = self.scheduled_at and self.scheduled_at > fields.Datetime.now() and not self.snapshot_done
        self.write({'state': 'scheduled' if waits else 'running', 'pause_reason': False, 'pause_detail': False})
        self._webvue_wake()

    def action_cancel(self):
        self._webvue_require_state('scheduled', 'running', 'paused')
        self.recipient_ids.filtered_domain([('state', 'in', ('pending', 'queued'))]).write({'skip_reason': 'cancelled'})
        self.write({'state': 'cancelled', 'completed_at': fields.Datetime.now(), 'pause_reason': False, 'pause_detail': False})
        self._webvue_wake()

    def action_retry(self):
        """Send again the recipients Meta capped for frequency at least a day ago; returns how many."""
        self._webvue_require_state('running', 'paused', 'done')
        cutoff = fields.Datetime.now() - FREQUENCY_RETRY_AFTER
        retry = self.recipient_ids.filtered_domain([('failure', '=', 'frequency_capped'), ('sent_at', '<=', cutoff)])
        if not retry:
            raise ValidationError(self.env._('No recipient is ready to be retried: a frequency-capped one waits 24 hours.'))
        retry._webvue_reset()
        if self.state == 'done':
            self.write({'state': 'running', 'completed_at': False})
        self._webvue_wake()
        return len(retry)

    def unlink(self):
        for campaign in self:
            if not campaign.can_delete:
                raise ValidationError(self.env._('A campaign that is running or has sent messages cannot be deleted.'))
        self.header_attachment_id.unlink()
        return super().unlink()

    # content

    def _webvue_resolve(self, contact):
        """(body parameters, header values, button values) for `contact`, or None when a placeholder has no value for them."""
        self.ensure_one()
        template = self.template_id
        values = {}
        for param in self.param_ids:
            text = param._webvue_value_for(contact)
            if not text:
                return None
            values[param.location, param.position] = text
        body = [values['body', position] for position in range(1, template.param_count + 1)]
        header = {'text': values['header', 1]} if ('header', 1) in values else {}
        buttons = [(index, values['button', index]) for index, _kind in template._webvue_button_needs()]
        return body, header, buttons
