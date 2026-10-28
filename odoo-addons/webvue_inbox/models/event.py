# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models
from odoo.exceptions import UserError

from .batch import process_each
from .constants import EVENT_BATCH, MAX_ATTEMPTS, PROCESSED_EVENT_DAYS
from odoo.addons.webvue_inbox.adapters import whatsapp

ERROR_TEXT_LENGTH = 200


class WebVueInboxEvent(models.Model):
    """The verified raw body of one webhook delivery, kept until it is processed."""
    _name = 'webvue.inbox.event'
    _description = 'Customer Inbox webhook event'
    _order = 'id'
    # Tenant scope with an owning company, for the same reason as the channel: the webhook identity
    # creates events for channels of any company.
    _webvue_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                       default=lambda self: self.env.company)
    channel_id = fields.Many2one('webvue.inbox.channel', required=True, index=True, ondelete='cascade')
    payload = fields.Text(required=True)
    state = fields.Selection(
        [('pending', 'Pending'), ('done', 'Done'), ('failed', 'Failed')], required=True, default='pending', index=True,
    )
    error = fields.Char()
    attempts = fields.Integer(default=0)
    processed_at = fields.Datetime()

    @api.model
    def _webvue_run_events(self):
        """Process a batch of pending (or retryable failed) events, committing after each one."""
        events = self.search([
            ('state', 'in', ('pending', 'failed')), ('attempts', '<', MAX_ATTEMPTS),
        ], limit=EVENT_BATCH)
        process_each(events, lambda event: event._webvue_process(), self._webvue_record_failure)

    @api.model
    def _webvue_record_failure(self, event, error):
        text = str(error) if isinstance(error, UserError) else type(error).__name__
        event.write({'state': 'failed', 'attempts': event.attempts + 1, 'error': text[:ERROR_TEXT_LENGTH]})

    def _webvue_process(self):
        self.ensure_one()
        channel = self.channel_id
        items = whatsapp.parse_events(json.loads(self.payload), channel.phone_number_id)
        changed = self.env['webvue.inbox.inbound']._webvue_ingest(channel, items)
        channel.last_event_at = self.create_date
        self.write({'state': 'done', 'processed_at': fields.Datetime.now(), 'error': False})
        changed._webvue_notify_bus()

    @api.model
    def _webvue_purge_processed(self, now):
        self.search([
            ('state', '=', 'done'), ('processed_at', '<', now - relativedelta(days=PROCESSED_EVENT_DAYS)),
        ]).unlink()

    @api.model
    def _webvue_purge_unprocessed(self, company, cutoff):
        """Delete the company's events that never succeeded and are older than `cutoff`; they hold customer text."""
        self.search([
            ('owner_company_id', '=', company.id), ('state', '!=', 'done'), ('create_date', '<', cutoff),
        ]).unlink()
