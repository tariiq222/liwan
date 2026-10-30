# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Number health of a channel: Meta's last known view, the alert timeline and the bell of the channel managers."""
import logging

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

from .access_service import MANAGE_CHANNELS
from .batch import process_each
from .health_constants import (
    ACCOUNT_STATES,
    ALERT_REASON_LENGTH,
    ALERT_RETENTION_MONTHS,
    BELL_SEVERITIES,
    HEALTH_KIND,
    LIMIT_ORDER,
    MESSAGING_LIMITS,
    NAME_STATUSES,
    QUALITY_RATINGS,
    QUALITY_SEVERITY,
    SCALING_DEDUPE,
    THROUGHPUT_LEVELS,
)
from odoo.addons.liwan_inbox.adapters import whatsapp

_logger = logging.getLogger(__name__)
CHECKED_STATES = ('connected', 'error')
APPROVED_NAMES = ('approved', 'available_without_review')


class LiwanInboxChannelHealth(models.Model):
    _inherit = 'liwan.inbox.channel'

    # Meta's last known facts about the number and its business account (Meta is the source; a refresh overwrites them).
    display_phone_number = fields.Char(help='Digits only: the routing key of the webhooks that name a number.')
    verified_name = fields.Char()
    name_status = fields.Selection(NAME_STATUSES, required=True, default='unknown')
    requested_name = fields.Char()
    name_rejection_reason = fields.Char()
    quality_rating = fields.Selection(QUALITY_RATINGS, required=True, default='unknown')
    messaging_limit = fields.Selection(MESSAGING_LIMITS, required=True, default='unknown')
    throughput_level = fields.Selection(THROUGHPUT_LEVELS, required=True, default='unknown')
    code_verified = fields.Boolean(default=False)
    account_state = fields.Selection(ACCOUNT_STATES, required=True, default='active')
    account_restricted_until = fields.Datetime()
    health_checked_at = fields.Datetime()
    alert_ids = fields.One2many('liwan.inbox.channel.alert', 'channel_id')
    # Meta analytics: template insights are an irreversible opt-in; the sync keeps its last result and attempt.
    template_insights_enabled = fields.Boolean(default=False)
    currency_code = fields.Char(size=3)
    analytics_synced_at = fields.Datetime()
    analytics_attempted_at = fields.Datetime()
    analytics_error = fields.Char()
    # A manager asked for a sync now: the cron pulls it, because only the cron's identity writes the analytics tables.
    analytics_sync_requested = fields.Boolean(default=False, index=True)
    # The last registration and PIN change, for the per-number cooldown of those actions.
    register_attempted_at = fields.Datetime()
    pin_attempted_at = fields.Datetime()

    def _liwan_cooling_down(self, field, window):
        """True when the channel's `field` timestamp is younger than `window`."""
        self.ensure_one()
        return bool(self[field] and fields.Datetime.now() - self[field] < window)

    # alerts and bell

    def _liwan_alert(self, kind, severity, occurred_at=None, **values):
        """Add a row to the timeline (and ring the managers' bell for a warning or danger); returns it.

        A row of the same kind, reason and `occurred_at` is never added twice, so a webhook replay is harmless.
        """
        self.ensure_one()
        reason = values.get('reason')
        values['reason'] = reason[:ALERT_REASON_LENGTH] if reason else False
        Alert = self.env['liwan.inbox.channel.alert']
        if occurred_at and Alert.search_count([
            ('channel_id', '=', self.id), ('kind', '=', kind), ('occurred_at', '=', occurred_at), ('reason', '=', values['reason']),
        ]):
            return Alert
        alert = Alert.create({
            'channel_id': self.id, 'owner_company_id': self.owner_company_id.id, 'kind': kind, 'severity': severity,
            'occurred_at': occurred_at or fields.Datetime.now(), **values,
        })
        if severity in BELL_SEVERITIES:
            self._liwan_notify_managers(alert)
        return alert

    def _liwan_alerted_recently(self, kind, reason):
        """True when the same alert was added in the last day (for the events Meta sends without a time)."""
        self.ensure_one()
        return bool(self.env['liwan.inbox.channel.alert'].search_count([
            ('channel_id', '=', self.id), ('kind', '=', kind), ('reason', '=', reason),
            ('occurred_at', '>=', fields.Datetime.now() - SCALING_DEDUPE),
        ]))

    def _liwan_managers(self):
        """Active users who manage channels in the channel's company."""
        self.ensure_one()
        service = self.env['liwan.access.service']
        users = self.env.ref('liwan_inbox.group_cap_inbox_channels_manage').all_user_ids
        return users.filtered(
            lambda user: user.active and service._liwan_has_capability(user, MANAGE_CHANNELS, company=self.owner_company_id),
        )

    def _liwan_notify_managers(self, alert):
        for user in self._liwan_managers():
            self.env['liwan.notify.service']._liwan_deliver(
                self._name, self.id, HEALTH_KIND, user.partner_id,
                self.env._('WhatsApp number %(channel)s: %(event)s', channel=self.name, event=dict(alert._fields['kind'].selection)[alert.kind]),
                key=f'{HEALTH_KIND}:{self.id}:{user.partner_id.id}',
                values={'liwan_inbox_channel_id': self.id, 'liwan_inbox_channel_name': self.name},
                replace=True,
            )

    # refresh from Meta

    def _liwan_fetch_health(self):
        """Read the number's health from Meta and apply it; a provider error propagates."""
        self.ensure_one()
        self._liwan_apply_health(whatsapp.fetch_phone_health(self._liwan_credentials()))

    def _liwan_refresh_health(self):
        """Connection test and health refresh: the channel becomes connected, or error (with an alert the first time).

        A disabled channel that fails stays disabled, so a failed activation never resumes its traffic.
        """
        self.ensure_one()
        try:
            with self.env.cr.savepoint():
                self._liwan_fetch_health()
        except whatsapp.ProviderError as error:
            was_failing = self.state in ('error', 'disabled')
            self.write({'state': 'disabled' if self.state == 'disabled' else 'error', 'last_error': str(error)})
            if not was_failing:
                self._liwan_alert('connection_failed', 'danger', reason=str(error))
        else:
            self.write({'state': 'connected', 'last_error': False})

    def _liwan_apply_health(self, health):
        """Store Meta's reading and add an alert for every meaningful change against the previous one."""
        self.ensure_one()
        before = {name: self[name] for name in ('quality_rating', 'messaging_limit', 'throughput_level', 'name_status')}
        name_status = 'pending_review' if health.new_name_status == 'pending_review' else health.name_status
        values = {
            'display_phone_number': health.display_phone_number or False, 'verified_name': health.verified_name or False,
            'name_status': name_status, 'quality_rating': health.quality_rating, 'messaging_limit': health.messaging_limit,
            'throughput_level': health.throughput_level, 'code_verified': health.code_verified,
            'health_checked_at': fields.Datetime.now(),
        }
        if name_status not in ('pending_review', 'declined'):
            values.update({'requested_name': False, 'name_rejection_reason': False})
        self.write(values)
        self._liwan_expire_restriction()
        self._liwan_alert_quality(before['quality_rating'])
        self._liwan_alert_limit(before['messaging_limit'])
        self._liwan_alert_name(before['name_status'])
        if before['throughput_level'] == 'standard' and self.throughput_level == 'high':
            self._liwan_alert('throughput_upgraded', 'info')

    def _liwan_alert_quality(self, previous):
        rating = self.quality_rating
        if rating == previous or rating == 'unknown' or (previous == 'unknown' and rating == 'green'):
            return
        self._liwan_alert('quality_changed', QUALITY_SEVERITY[rating], quality_rating=rating)

    def _liwan_alert_limit(self, previous):
        limit = self.messaging_limit
        if limit == previous or previous not in LIMIT_ORDER or limit not in LIMIT_ORDER:
            return
        lowered = LIMIT_ORDER.index(limit) < LIMIT_ORDER.index(previous)
        self._liwan_alert(
            'messaging_limit_changed', 'warning' if lowered else 'info', messaging_limit=limit, previous_messaging_limit=previous,
        )

    def _liwan_alert_name(self, previous):
        status = self.name_status
        if status == previous:
            return
        if status == 'declined':
            self._liwan_alert('name_rejected', 'warning', requested_name=self.requested_name, reason=self.name_rejection_reason)
        elif status in APPROVED_NAMES and previous == 'pending_review':
            self._liwan_alert('name_approved', 'info', requested_name=self.verified_name)
        elif status == 'pending_review':
            self._liwan_alert('name_pending', 'info', requested_name=self.requested_name)

    def _liwan_expire_restriction(self):
        """A restriction whose end has passed is over (Meta sends no event for it)."""
        until = self.account_restricted_until
        if self.account_state == 'restricted' and until and until <= fields.Datetime.now():
            self.write({'account_state': 'active', 'account_restricted_until': False})
            self._liwan_alert('account_reinstated', 'info')

    # webhook changes

    def _liwan_apply_health_update(self, item):
        """Apply one typed account-health change that arrived by webhook."""
        self.ensure_one()
        if isinstance(item, whatsapp.QualityUpdate):
            self._liwan_apply_quality_update(item)
        elif isinstance(item, whatsapp.NameUpdate):
            self._liwan_apply_name_update(item)
        elif isinstance(item, whatsapp.AccountUpdate):
            self._liwan_apply_account_update(item)
        elif isinstance(item, whatsapp.CapabilityUpdate):
            self._liwan_set_limit(item.limit, item.occurred_at)
        elif not self._liwan_alerted_recently('scaling_denied', item.alert_type[:ALERT_REASON_LENGTH]):
            self._liwan_alert('scaling_denied', 'warning', item.occurred_at, reason=item.alert_type)

    def _liwan_set_limit(self, limit, occurred_at):
        previous = self.messaging_limit
        if limit == previous:
            return
        self.messaging_limit = limit
        self._liwan_alert_limit_change(previous, limit, occurred_at)

    def _liwan_alert_limit_change(self, previous, limit, occurred_at):
        lowered = previous in LIMIT_ORDER and limit in LIMIT_ORDER and LIMIT_ORDER.index(limit) < LIMIT_ORDER.index(previous)
        self._liwan_alert(
            'messaging_limit_changed', 'warning' if lowered else 'info', occurred_at,
            messaging_limit=limit, previous_messaging_limit=previous,
        )

    def _liwan_apply_quality_update(self, item):
        if item.current_limit:
            self._liwan_set_limit(item.current_limit, item.occurred_at)
        if item.event != 'THROUGHPUT_UPGRADE':
            try:
                self._liwan_fetch_health()  # Meta's word names the event, not the rating: read the rating
            except whatsapp.ProviderError as error:
                # The event's other changes stand; the 6-hourly refresh reads the rating.
                _logger.warning('health read after a quality event of channel %s failed: %s', self.id, type(error).__name__)
        elif self.throughput_level != 'high':
            self.throughput_level = 'high'
            self._liwan_alert('throughput_upgraded', 'info', item.occurred_at)

    def _liwan_apply_name_update(self, item):
        decision = item.decision
        if decision == 'APPROVED':
            self.write({
                'name_status': 'approved', 'verified_name': item.requested_name or self.verified_name,
                'requested_name': False, 'name_rejection_reason': False,
            })
            self._liwan_alert('name_approved', 'info', item.occurred_at, requested_name=item.requested_name)
        elif decision == 'REJECTED' and (self.name_status, self.name_rejection_reason) != ('declined', item.rejection_reason):
            self.write({
                'name_status': 'declined', 'requested_name': item.requested_name or self.requested_name,
                'name_rejection_reason': item.rejection_reason,
            })
            self._liwan_alert(
                'name_rejected', 'warning', item.occurred_at, requested_name=item.requested_name, reason=item.rejection_reason,
            )
        elif decision in ('PENDING', 'DEFERRED') and (self.name_status, self.requested_name) != ('pending_review', item.requested_name):
            self.write({'name_status': 'pending_review', 'requested_name': item.requested_name, 'name_rejection_reason': False})
            self._liwan_alert('name_pending', 'info', item.occurred_at, requested_name=item.requested_name)

    def _liwan_apply_account_update(self, item):
        event = item.event
        if event == 'ACCOUNT_RESTRICTION':
            until = max((r.expires_at for r in item.restrictions if r.expires_at), default=False)
            reason = item.restrictions[0].kind if item.restrictions else event
            self._liwan_set_account_state('restricted', 'account_restricted', 'warning', item, reason, until)
        elif event == 'ACCOUNT_VIOLATION':
            self._liwan_alert('account_violation', 'danger', item.occurred_at, reason=item.violation_type or event)
        elif event == 'ACCOUNT_OFFBOARDED' or (event == 'DISABLED_UPDATE' and item.ban_state == 'DISABLE'):
            self._liwan_set_account_state('disabled', 'account_disabled', 'danger', item, event)
        elif event == 'DISABLED_UPDATE' and item.ban_state == 'SCHEDULE_FOR_DISABLE':
            self._liwan_set_account_state(
                'scheduled_for_disable', 'account_disabled', 'warning', item, item.ban_state, item.ban_date or False,
            )
        elif event == 'ACCOUNT_RECONNECTED' or (event == 'DISABLED_UPDATE' and item.ban_state == 'REINSTATE'):
            self._liwan_set_account_state('active', 'account_reinstated', 'info', item, event)

    def _liwan_set_account_state(self, state, kind, severity, item, reason, until=False):
        """Move the account to `state` (restricted or scheduled states keep their end date); a repeat changes nothing."""
        if (self.account_state, self.account_restricted_until or False) == (state, until):
            return
        self.write({'account_state': state, 'account_restricted_until': until})
        self._liwan_alert(kind, severity, item.occurred_at, reason=reason, expires_at=until)

    # cron

    @api.model
    def _liwan_run_health(self):
        """Refresh the health of every connected channel (6-hourly)."""
        channels = self.search([('kind', '=', 'whatsapp'), ('state', 'in', CHECKED_STATES)])
        process_each(channels, lambda channel: channel._liwan_refresh_health(), self._liwan_health_failed)

    @api.model
    def _liwan_run_analytics(self):
        """Pull Meta's cost and template analytics of every connected channel (daily)."""
        self.env['liwan.inbox.meta.analytics']._liwan_run()

    @api.model
    def _liwan_run_analytics_requested(self):
        """Pull the analytics of the channels whose manager asked for a sync now."""
        self.env['liwan.inbox.meta.analytics']._liwan_run_requested()

    @api.model
    def _liwan_health_failed(self, channel, error):
        _logger.warning('health refresh of channel %s failed: %s', channel.id, type(error).__name__)

    @api.model
    def _liwan_purge_alerts(self, now):
        self.env['liwan.inbox.channel.alert'].search([
            ('occurred_at', '<', now - relativedelta(months=ALERT_RETENTION_MONTHS)),
        ]).unlink()
        channel_ids = self.search([]).ids
        self.env['mail.message'].search([
            ('liwan_notification_kind', '=', HEALTH_KIND), ('liwan_inbox_channel_id', 'not in', channel_ids),
        ]).unlink()
