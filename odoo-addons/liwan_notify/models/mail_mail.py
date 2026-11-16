# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
from datetime import timedelta

from odoo import api, fields, models
from odoo.exceptions import ValidationError

from .mail_domain_provider import MailProviderError

_logger = logging.getLogger(__name__)

# Protection ceilings (owner decision D5): per tenant, counted over the contract rows of the database.
# The operator may change either through the parameter; 0 turns the ceiling off.
DAILY_CEILING = 2000
MINUTE_CEILING = 60
DAILY_CEILING_PARAM = 'liwan_notify.mail_daily_ceiling'
MINUTE_CEILING_PARAM = 'liwan_notify.mail_minute_ceiling'
# OCI counts one email per recipient and per 2 MB chunk of the message.
CHUNK_BYTES = 2 * 1024 * 1024
# One message goes to at most this many addresses: the relay's own default (deploy/odoo-mail/relay.py:112, ODOO_MAIL_MAX_RECIPIENTS).
MAX_RECIPIENTS = 50
# Above this encoded size a document goes as a download link, never as an attachment.
MAX_ENCODED_BYTES = 1_500_000
# The wait before the second and the third attempt; the number of waits fixes the attempt cap.
RETRY_DELAYS = (timedelta(minutes=5), timedelta(minutes=30))
MAX_ATTEMPTS = len(RETRY_DELAYS) + 1
RETRYABLE_FAILURES = ('mail_smtp', 'unknown')
RETENTION = timedelta(days=90)
# The failure reasons ``send`` writes when it holds a row back: no attempt was made, so none is spent.
HOLD_REASONS = ('mail_domain_unverified', 'mail_paused', 'mail_sender_changed')
# The provider status of a row stops being asked once it is final, or once the row is older than this.
DELIVERY_STATUS_WINDOW = timedelta(days=14)
PROVIDER_STATUSES = [
    ('submitted', 'Submitted'),
    ('accepted', 'Accepted'),
    ('relayed', 'Relayed'),
    ('bounced', 'Bounced'),
    ('complained', 'Complained'),
    ('suppressed', 'Suppressed'),
]
FINAL_PROVIDER_STATUSES = ('relayed', 'bounced', 'complained', 'suppressed')
# Automatic pause (spec 6.4): over the window, with at least the minimum sent, a hard-bounce or complaint rate above
# its threshold pauses the tenant domain. The operator may change each through its parameter.
PAUSE_WINDOW = timedelta(days=7)
PAUSE_MIN_SENT = 50
PAUSE_BOUNCE_RATE = 0.05
PAUSE_COMPLAINT_RATE = 0.001
PAUSE_MIN_SENT_PARAM = 'liwan_notify.mail_pause_min_sent'
PAUSE_BOUNCE_RATE_PARAM = 'liwan_notify.mail_pause_bounce_rate'
PAUSE_COMPLAINT_RATE_PARAM = 'liwan_notify.mail_pause_complaint_rate'


class LiwanMailMail(models.Model):
    """The delivery log of tenant business mail lives on the stock outgoing row, as one source of truth.

    A contract row is one with ``liwan_kind`` set; stock Odoo mail without a kind is never touched here.
    ``liwan_attempts`` counts the times the row was queued for sending (the first send is attempt 1).
    ``scheduled_date`` is the moment the contract lets the row leave, so every ceiling count reads it.
    """
    _inherit = 'mail.mail'

    # Redeclared for its index only: the ceiling counts and the queue cron both filter by this stock field.
    scheduled_date = fields.Datetime(index=True)
    liwan_kind = fields.Char('liwan Mail Kind', copy=False)
    liwan_attempts = fields.Integer('liwan Send Attempts', copy=False)
    liwan_weight = fields.Integer(
        'liwan Billed Weight', copy=False,
        help='One per recipient and per 2 MB chunk of the encoded message, fixed when the contract creates the row; the ceilings sum it.',
    )
    liwan_sensitive = fields.Boolean(
        'liwan Sensitive Mail', copy=False,
        help='After a successful send the body and attachments are removed; the row stays for its weight and its log.',
    )
    liwan_provider_status = fields.Selection(PROVIDER_STATUSES, 'liwan Provider Status', copy=False)
    liwan_provider_checked_at = fields.Datetime('liwan Provider Checked At', copy=False)

    def _postprocess_sent_message(self, success_pids, success_emails, failure_reason=False, failure_type=None):
        """Scrub a sensitive contract row once it is sent: its content goes, its row (weight, kind, state) stays."""
        result = super()._postprocess_sent_message(
            success_pids, success_emails, failure_reason=failure_reason, failure_type=failure_type,
        )
        outbox = self.env['liwan.mail.send']._liwan_outbox()
        sent = outbox.browse(self.ids).exists().filtered(
            lambda mail: mail.liwan_kind and mail.liwan_sensitive and mail.state == 'sent',
        )
        if sent:
            attachments = sent.attachment_ids
            sent.write({'body_html': False, 'attachment_ids': [(5, 0, 0)]})
            attachments.unlink()
        return result

    def send(self, auto_commit=False, raise_exception=False, post_send_callback=None):
        """Hold back a contract row whose sender the tenant may not use now (unverified, paused, or a changed domain).

        The rule is checked again at the moment of sending, so a row deferred by a ceiling cannot leave after its
        domain lost verification or was paused. A held row goes to ``exception`` with a ``HOLD_REASONS`` reason and
        spends no attempt; the retry cron sends it once the domain may send again.
        """
        held = self.browse()
        contract = self.filtered('liwan_kind')
        if contract:
            sender, refusal = self.env['liwan.mail.send']._liwan_sender_or_refusal()
            held = contract.filtered(lambda mail: refusal or mail.email_from != sender)
            if held:
                self.env['liwan.mail.send']._liwan_outbox().browse(held.ids).write({
                    'state': 'exception', 'failure_type': 'unknown',
                    'failure_reason': refusal.code if refusal else 'mail_sender_changed',
                })
        return super(LiwanMailMail, self - held).send(
            auto_commit=auto_commit, raise_exception=raise_exception, post_send_callback=post_send_callback,
        )

    @api.model
    def _liwan_retry_failed(self):
        """Queue again the contract rows a transient failure left in ``exception``, up to the attempt cap.

        Each goes through the same slot logic as a new row, after its retry delay, so retries respect both ceilings,
        and takes the tenant's current sender. While the tenant may not send (unverified or paused domain) nothing is
        queued again and no attempt is spent. A row ``send`` held back (``HOLD_REASONS``) was never tried: it is
        queued at once, outside the attempt cap, and keeps its attempt count. An invalid or missing address is a final
        failure and is not in ``RETRYABLE_FAILURES``.
        """
        send = self.env['liwan.mail.send']
        sender, refusal = send._liwan_sender_or_refusal()
        if refusal or not sender:
            return
        failed = self.search([
            ('liwan_kind', '!=', False),
            ('state', '=', 'exception'),
            ('failure_type', 'in', RETRYABLE_FAILURES),
            ('liwan_attempts', '>=', 1),
            '|', ('failure_reason', 'in', HOLD_REASONS), ('liwan_attempts', '<', MAX_ATTEMPTS),
        ])
        now = fields.Datetime.now()
        send._liwan_lock_slots()
        for mail in failed:
            held = mail.failure_reason in HOLD_REASONS
            earliest = now if held else now + RETRY_DELAYS[mail.liwan_attempts - 1]
            mail.write({
                'state': 'outgoing',
                'email_from': sender,
                'failure_type': False,
                'failure_reason': False,
                'scheduled_date': send._liwan_slot(mail.liwan_weight, earliest, mail),
                'liwan_attempts': mail.liwan_attempts + (0 if held else 1),
            })
        if failed:
            self.env.ref('mail.ir_cron_mail_scheduler_action')._trigger(
                at=min(failed.mapped('scheduled_date')) + timedelta(seconds=59),
            )

    @api.model
    def _liwan_purge_old(self):
        """Remove the contract rows past the retention, whatever their state, with the attachments the contract made for them."""
        old = self.search([
            ('liwan_kind', '!=', False),
            ('create_date', '<', fields.Datetime.now() - RETENTION),
        ])
        old.attachment_ids.unlink()
        old.unlink()

    @api.model
    def _liwan_fetch_delivery_status(self):
        """Hourly: ask the provider the delivery status of recent contract rows not final yet, by our Message-Id, then pause if needed."""
        domain = self.env['liwan.mail.domain']._liwan_tenant_domain()
        if not domain or not domain._liwan_provider_configured():
            return
        since = fields.Datetime.now() - DELIVERY_STATUS_WINDOW
        rows = self.search([
            ('liwan_kind', '!=', False),
            ('state', '=', 'sent'),
            ('message_id', '!=', False),
            ('scheduled_date', '>=', since),
            '|', ('liwan_provider_status', '=', False), ('liwan_provider_status', 'not in', FINAL_PROVIDER_STATUSES),
        ])
        if rows:
            try:
                statuses = domain._liwan_provider().fetch_delivery_status(domain, rows.mapped('message_id'), since)
            except MailProviderError as error:
                _logger.warning('mail domain %s: delivery status not read: %s', domain.id, type(error).__name__)
                return
            now = fields.Datetime.now()
            for mail in rows:
                status = statuses.get(mail.message_id)
                mail.write({'liwan_provider_status': status or mail.liwan_provider_status or 'submitted',
                            'liwan_provider_checked_at': now})
        self._liwan_pause_if_needed(domain)

    @api.model
    def _liwan_rate_param(self, param, default, cast):
        value = self.env['ir.config_parameter']._get_param(param)
        if value is None:
            return default
        try:
            number = cast(value)
        except ValueError:
            number = -1
        if number < 0:
            raise ValidationError(self.env._('liwan_notify: the parameter %(param)s must be a number of 0 or more.', param=param))
        return number

    @api.model
    def _liwan_pause_if_needed(self, domain):
        """Pause the tenant domain when its hard-bounce or complaint rate over the window passes its threshold."""
        if domain.paused or domain.state != 'verified':
            return
        start = max(fields.Datetime.now() - PAUSE_WINDOW, domain.resumed_at or fields.Datetime.now() - PAUSE_WINDOW)
        groups = dict(self._read_group(
            [('liwan_kind', '!=', False), ('state', '=', 'sent'), ('scheduled_date', '>=', start)],
            ['liwan_provider_status'], ['__count'],
        ))
        sent = sum(groups.values())
        if sent < self._liwan_rate_param(PAUSE_MIN_SENT_PARAM, PAUSE_MIN_SENT, int):
            return
        bounce_rate = groups.get('bounced', 0) / sent
        complaint_rate = groups.get('complained', 0) / sent
        if bounce_rate > self._liwan_rate_param(PAUSE_BOUNCE_RATE_PARAM, PAUSE_BOUNCE_RATE, float):
            reason = self.env._('Too many messages bounced (%(rate)s%% over 7 days).', rate=round(bounce_rate * 100, 1))
        elif complaint_rate > self._liwan_rate_param(PAUSE_COMPLAINT_RATE_PARAM, PAUSE_COMPLAINT_RATE, float):
            reason = self.env._('Too many recipients reported spam (%(rate)s%% over 7 days).', rate=round(complaint_rate * 100, 2))
        else:
            return
        domain.write({'paused': True, 'pause_reason': reason, 'paused_at': fields.Datetime.now()})
