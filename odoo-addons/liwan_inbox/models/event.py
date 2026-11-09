# Part of Odoo. See LICENSE file for full copyright and licensing details.
import hashlib
import json

from dateutil.relativedelta import relativedelta
from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import UserError

from .batch import process_each
from .constants import (
    EVENT_BATCH,
    MAX_ATTEMPTS,
    PROCESSED_EVENT_DAYS,
    TIKTOK_ECHO_SETTLE,
)
from odoo.addons.liwan_inbox.adapters import tiktok, whatsapp

ERROR_TEXT_LENGTH = 200


class LiwanInboxEvent(models.Model):
    """The verified raw body of one webhook delivery, kept until it is processed.

    A delivery is stored once per channel: `dedupe_key` is the SHA-256 of the channel and the raw body, so a
    provider's replay of an already accepted delivery creates no second row and therefore no second side effect
    (a consent change, a message). The key lives as long as the row does (`_liwan_purge_processed` keeps a
    processed event for `PROCESSED_EVENT_DAYS`), which is the documented replay window.
    """
    _name = 'liwan.inbox.event'
    _description = 'Customer Inbox webhook event'
    _order = 'id'
    # Tenant scope with an owning company, for the same reason as the channel: the webhook identity
    # creates events for channels of any company.
    _liwan_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                       default=lambda self: self.env.company)
    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    payload = fields.Text(required=True)
    # Derived from the channel and the raw body by `_liwan_store`, the only writer of a delivery.
    dedupe_key = fields.Char(required=True, copy=False)
    state = fields.Selection(
        [('pending', 'Pending'), ('done', 'Done'), ('failed', 'Failed')], required=True, default='pending', index=True,
    )
    error = fields.Char()
    attempts = fields.Integer(default=0)
    processed_at = fields.Datetime()

    _dedupe_unique = models.UniqueIndex('(dedupe_key)', 'A webhook delivery is stored once per channel.')

    @api.model
    def _liwan_dedupe_key(self, channel, raw):
        """The SHA-256 of one channel's raw body: the same delivery always derives the same key."""
        return hashlib.sha256(b'%d:' % channel.id + raw).hexdigest()

    @api.model
    def _liwan_store(self, channel, raw):
        """Store one verified delivery for ``channel``, or nothing when it was already stored.

        Idempotent by construction: the unique key turns a replay (or a concurrent duplicate) into a
        UniqueViolation the savepoint absorbs, so the caller reports success and no second side effect runs.
        """
        try:
            with self.env.cr.savepoint():
                return self.create({
                    'channel_id': channel.id,
                    'owner_company_id': channel.owner_company_id.id,
                    'payload': raw.decode(),
                    'dedupe_key': self._liwan_dedupe_key(channel, raw),
                })
        except UniqueViolation:
            return self.browse()

    @api.model
    def _liwan_run_events(self):
        """Process a batch of pending (or retryable failed) events, committing after each one.

        A TikTok event younger than `TIKTOK_ECHO_SETTLE` waits for the next run: the outbox may still be sending
        the message TikTok echoes, and processing the echo first would store the same message twice (D6).
        """
        events = self.search([
            ('state', 'in', ('pending', 'failed')), ('attempts', '<', MAX_ATTEMPTS),
            '|', ('channel_id.kind', '!=', 'tiktok'),
            ('create_date', '<=', fields.Datetime.now() - TIKTOK_ECHO_SETTLE),
        ], limit=EVENT_BATCH)
        process_each(events, lambda event: event._liwan_process(), self._liwan_record_failure)

    @api.model
    def _liwan_record_failure(self, event, error):
        text = str(error) if isinstance(error, UserError) else type(error).__name__
        event.write({'state': 'failed', 'attempts': event.attempts + 1, 'error': text[:ERROR_TEXT_LENGTH]})

    def _liwan_process(self):
        self.ensure_one()
        channel = self.channel_id
        payload = json.loads(self.payload)
        if channel.kind == 'tiktok':
            items = tiktok.parse_event(payload, channel.tiktok_business_id)
            changed = self.env['liwan.inbox.inbound']._liwan_ingest_tiktok(channel, items)
        else:
            items = whatsapp.parse_events(payload, channel.phone_number_id, channel.business_account_id, channel.display_phone_number)
            changed = self.env['liwan.inbox.inbound']._liwan_ingest(channel, items)
        channel.last_event_at = self.create_date
        self.write({'state': 'done', 'processed_at': fields.Datetime.now(), 'error': False})
        changed._liwan_notify_bus()

    @api.model
    def _liwan_purge_processed(self, now):
        self.search([
            ('state', '=', 'done'), ('processed_at', '<', now - relativedelta(days=PROCESSED_EVENT_DAYS)),
        ]).unlink()

    @api.model
    def _liwan_purge_unprocessed(self, company, cutoff):
        """Delete the company's events that never succeeded and are older than `cutoff`; they hold customer text."""
        self.search([
            ('owner_company_id', '=', company.id), ('state', '!=', 'done'), ('create_date', '<', cutoff),
        ]).unlink()
