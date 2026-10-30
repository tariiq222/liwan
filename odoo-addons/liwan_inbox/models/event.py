# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from .batch import process_each
from .constants import EVENT_BATCH, MAX_ATTEMPTS, PROCESSED_EVENT_DAYS
from odoo.addons.liwan_inbox.adapters import whatsapp

ERROR_TEXT_LENGTH = 200


class LiwanInboxEvent(models.Model):
    """The verified raw body of one webhook delivery, kept until it is processed."""
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
    state = fields.Selection(
        [('pending', 'Pending'), ('done', 'Done'), ('failed', 'Failed')], required=True, default='pending', index=True,
    )
    error = fields.Char()
    attempts = fields.Integer(default=0)
    processed_at = fields.Datetime()

    @api.model
    def _liwan_run_events(self):
        """Process a batch of pending (or retryable failed) events, committing after each one."""
        events = self.search([
            ('state', 'in', ('pending', 'failed')), ('attempts', '<', MAX_ATTEMPTS),
        ], limit=EVENT_BATCH)
        process_each(events, lambda event: event._liwan_process(), self._liwan_record_failure)

    @api.model
    def _liwan_record_failure(self, event, error):
        text = str(error) if isinstance(error, UserError) else type(error).__name__
        event.write({'state': 'failed', 'attempts': event.attempts + 1, 'error': text[:ERROR_TEXT_LENGTH]})

    def _liwan_process(self):
        self.ensure_one()
        channel = self.channel_id
        items = whatsapp.parse_events(json.loads(self.payload), channel.phone_number_id, channel.business_account_id, channel.display_phone_number)
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
