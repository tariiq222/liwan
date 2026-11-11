# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The history import of one TikTok business account: a job the cron advances one page at a time.

D11: on first connect and on demand, LiwanOS imports the conversations of the last 90 days (TikTok caps one
conversation page at 100) and the 20 newest messages of each. Every step is committed before the next one, so a
long import survives a restart, and a message that is already stored (by its provider id) is never imported twice.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from odoo import api, fields, models
from odoo.exceptions import UserError

from .batch import process_each
from .constants import TIKTOK_FEATURE
from odoo.addons.liwan_inbox.adapters import errors, tiktok

_logger = logging.getLogger(__name__)

# The unfinished states: one active job per channel, and only these are advanced.
ACTIVE_STATES = ('queued', 'running')
# The phases of one import: the two conversation lists first, then their messages.
PHASE_TYPES = {'single': 'SINGLE', 'stranger': 'STRANGER'}
MESSAGE_PHASE = 'messages'
PHASE_AFTER = {'single': 'stranger', 'stranger': MESSAGE_PHASE}
# One step reads one conversation page or the messages of this many conversations (D11).
MESSAGES_PER_STEP = 10
SYNC_BATCH = 20
# The import window, and the size above which TikTok's own timestamp is milliseconds rather than seconds.
HISTORY_WINDOW = timedelta(days=90)
MILLISECONDS = 10 ** 11
ERROR_TEXT_LENGTH = 200


def conversation_time(item):
    """When a conversation last changed, as naive UTC, from TikTok's own `update_time`."""
    try:
        value = int(item.get('update_time'))
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(value / 1000 if value >= MILLISECONDS else value, timezone.utc).replace(tzinfo=None)


def conversation_name(item):
    """The provider id of one conversation of TikTok's list, or an empty string when the answer carries none."""
    value = item.get('conversation_id')
    return value if isinstance(value, str) else ''


class LiwanInboxTikTokSync(models.Model):
    """One history import of a TikTok channel, advanced by the cron until it is done or failed."""
    _name = 'liwan.inbox.tiktok.sync'
    _description = 'Customer Messages TikTok history import'
    _order = 'id desc'
    # Tenant scope with an owning company, like the event: the cron and the EU notice create a job for a
    # channel of any company, while staff reach only their companies' jobs through the group rule.
    _liwan_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                       default=lambda self: self.env.company)
    channel_id = fields.Many2one('liwan.inbox.channel', required=True, index=True, ondelete='cascade')
    state = fields.Selection(
        [('queued', 'Queued'), ('running', 'Running'), ('done', 'Done'), ('failed', 'Failed')],
        required=True, default='queued', index=True,
    )
    phase = fields.Selection(
        [('single', 'Single'), ('stranger', 'Stranger'), ('messages', 'Messages')], required=True, default='single',
    )
    cursor = fields.Integer(default=0)
    # The conversation ids still to read, as a JSON list: this job is the only reader and writer of its own queue.
    pending_conversation_ids = fields.Text(default='[]')
    conversations_count = fields.Integer(default=0)
    messages_count = fields.Integer(default=0)
    error = fields.Char()
    started_at = fields.Datetime()
    finished_at = fields.Datetime()

    @api.model
    def _liwan_run_tiktok_sync(self):
        """Cron: advance every unfinished import by one step, committing after each (D11)."""
        if not self.env['liwan.entitlement.service']._liwan_feature_write(TIKTOK_FEATURE):
            return
        process_each(
            self.search([('state', 'in', ACTIVE_STATES)], order='id', limit=SYNC_BATCH),
            lambda job: job._liwan_run_step(), self._liwan_record_failure,
        )

    @api.model
    def _liwan_record_failure(self, job, error):
        """An unexpected failure ends the job: an import is started again on demand, never retried in a loop."""
        job._liwan_fail(type(error).__name__)

    def _liwan_run_step(self):
        """Read one page of conversations, or import up to `MESSAGES_PER_STEP` conversations' messages (D11)."""
        self.ensure_one()
        if self.state not in ACTIVE_STATES:
            return
        if self.state == 'queued':
            self.write({'state': 'running', 'started_at': fields.Datetime.now()})
        try:
            credentials = self.channel_id._liwan_tiktok_credentials()
            if self.phase == MESSAGE_PHASE:
                self._liwan_import_messages(credentials)
            else:
                self._liwan_import_conversation_page(credentials)
        except errors.ProviderError as error:
            if error.retryable:
                # A rate limit or an outage: the same step runs again on the next cron run.
                _logger.info('TikTok history import %s waits for the next run (%s)', self.id, type(error).__name__)
                return
            self._liwan_fail(str(error))
        except UserError as error:
            # An expired or refused authorization: the channel now asks for a reconnect, and the job says why.
            self._liwan_fail(str(error))

    def _liwan_import_conversation_page(self, credentials):
        """Read one page of the phase's conversation list (SINGLE, then STRANGER); the last page advances the phase."""
        conversations, cursor = tiktok.list_conversations(credentials, PHASE_TYPES[self.phase], self.cursor)
        pending = self._liwan_pending_conversations()
        names = []
        for item in conversations:
            name = conversation_name(item)
            if name and name not in pending and self._liwan_is_recent(item):
                names.append(name)
        values = {
            'pending_conversation_ids': json.dumps(pending + names),
            'conversations_count': self.conversations_count + len(names),
        }
        if cursor is not None:
            self.write({**values, 'cursor': cursor})
            return
        phase = PHASE_AFTER[self.phase]
        self.write({**values, 'phase': phase, 'cursor': 0})
        if phase == MESSAGE_PHASE and not pending and not names:
            self._liwan_finish()

    def _liwan_is_recent(self, item):
        """Whether the conversation changed inside the import window (D11: the last 90 days)."""
        updated = conversation_time(item)
        return bool(updated) and updated >= fields.Datetime.now() - HISTORY_WINDOW

    def _liwan_import_messages(self, credentials):
        """Import up to `MESSAGES_PER_STEP` pending conversations, removing each one once its messages are read."""
        pending = self._liwan_pending_conversations()
        imported = 0
        while pending and imported < MESSAGES_PER_STEP:
            count = self._liwan_import_conversation(credentials, pending[0])
            pending = pending[1:]
            imported += 1
            self.write({
                'pending_conversation_ids': json.dumps(pending),
                'messages_count': self.messages_count + count,
            })
        if not pending:
            self._liwan_finish()

    def _liwan_import_conversation(self, credentials, conversation_id):
        """Import one conversation's newest messages historically; returns how many of them were new."""
        _participants, items = tiktok.list_messages(credentials, conversation_id)
        # The list arrives newest first; the oldest first keeps a reply's target and a conversation's first message
        # stored before the messages that refer to it, and makes the stored dates read in order.
        items.sort(key=lambda item: item.sent_at)
        ids = [item.provider_id for item in items if item.provider_id]
        known = self.env['liwan.inbox.message'].search_count([('provider_message_id', 'in', ids)]) if ids else 0
        self.env['liwan.inbox.inbound']._liwan_ingest_tiktok(self.channel_id, items, historical=True)
        return len(ids) - known

    def _liwan_pending_conversations(self):
        """The conversation ids the import still has to read messages from."""
        return [name for name in json.loads(self.pending_conversation_ids or '[]') if isinstance(name, str) and name]

    def _liwan_fail(self, message):
        """End the job with the reason that stopped it; it is started again on demand, never retried (D11)."""
        self.write({'state': 'failed', 'error': message[:ERROR_TEXT_LENGTH], 'finished_at': fields.Datetime.now()})

    def _liwan_finish(self):
        """End the job: every conversation it listed has been read."""
        self.write({'state': 'done', 'finished_at': fields.Datetime.now()})
