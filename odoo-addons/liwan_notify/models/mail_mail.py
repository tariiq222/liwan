# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models

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
        help='One per recipient and per 2 MB chunk, fixed when the contract creates the row; the ceilings sum it.',
    )

    @api.model
    def _liwan_retry_failed(self):
        """Queue again the contract rows a transient failure left in ``exception``, up to the attempt cap.

        Each goes through the same slot logic as a new row, after its retry delay, so retries respect both ceilings.
        An invalid or missing address is a final failure and is not in ``RETRYABLE_FAILURES``.
        """
        failed = self.search([
            ('liwan_kind', '!=', False),
            ('state', '=', 'exception'),
            ('failure_type', 'in', RETRYABLE_FAILURES),
            ('liwan_attempts', '>=', 1),
            ('liwan_attempts', '<', MAX_ATTEMPTS),
        ])
        now = fields.Datetime.now()
        send = self.env['liwan.mail.send']
        failed.write({'state': 'outgoing'})
        for mail in failed:
            mail.write({
                'scheduled_date': send._liwan_slot(mail.liwan_weight, now + RETRY_DELAYS[mail.liwan_attempts - 1], mail),
                'liwan_attempts': mail.liwan_attempts + 1,
            })
        if failed:
            self.env.ref('mail.ir_cron_mail_scheduler_action')._trigger(
                at=min(failed.mapped('scheduled_date')) + timedelta(seconds=59),
            )

    @api.model
    def _liwan_purge_old(self):
        """Remove the contract rows past the retention, with the attachments the contract made for them."""
        old = self.search([
            ('liwan_kind', '!=', False),
            ('create_date', '<', fields.Datetime.now() - RETENTION),
        ])
        old.attachment_ids.unlink()
        old.unlink()
