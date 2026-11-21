# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.models.message import public_https

MODES = [('speak', 'Speak a text'), ('bridge', 'Bridge two numbers')]
STATES = [
    ('initiated', 'Initiated'), ('ringing', 'Ringing'), ('in_progress', 'In progress'), ('completed', 'Completed'),
    ('busy', 'Busy'), ('no_answer', 'No answer'), ('failed', 'Failed'), ('canceled', 'Canceled'),
    ('unconfirmed', 'Unconfirmed'),
]
# A row in these states may still reach the provider: it holds its connection (the plan's "non-final"
# meaning for the connection-in-use check: every state but the four final ones). A row holds it only
# with a provider call id: without one no callback can ever match the row, so it can never reach the
# provider's end.
PENDING_STATES = ('initiated', 'ringing', 'in_progress', 'unconfirmed')
CALLBACK_KIND = 'call-status'
RECORDING_CALLBACK_KIND = 'recording-status'
ERROR_TEXT_LENGTH = 200
# A call spends at most the client's connect and read timeouts; a younger no-id row may still be on
# its way to the provider (the same reasoning as the messages' ``STALE_SEND_AFTER``).
STALE_CALL_AFTER = timedelta(seconds=60)
PURGE_BATCH = 1000
RETENTION = relativedelta(months=24)


class LiwanIntegrationCall(models.Model):
    """One call a company places through a provider connection: its log row and its status.

    The row is a snapshot (provider, account and sender value are copied), so deleting the connection or
    the sender never rewrites it. Read through the ORM only by holders of ``integrations.log.read``;
    everything else goes through the ``liwan.integration.voice`` service.
    """
    _name = 'liwan.integration.call'
    _description = 'LiwanOS integration call'
    _liwan_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    connection_id = fields.Many2one('liwan.integration.connection', index=True, ondelete='set null')
    sender_id = fields.Many2one('liwan.integration.sender', index=True, ondelete='set null')
    provider = fields.Char(required=True)
    account_ref = fields.Char(required=True)
    from_value = fields.Char(required=True)
    to = fields.Char(required=True, index=True)
    mode = fields.Selection(MODES, required=True)
    speak_text = fields.Text()
    bridge_to = fields.Char()
    origin = fields.Selection([('test', 'Settings test')], required=True)
    requested_by = fields.Many2one('res.users', ondelete='set null')
    state = fields.Selection(STATES, required=True, default='initiated', index=True)
    provider_call_id = fields.Char(index=True)
    duration_seconds = fields.Integer()
    recorded = fields.Boolean(default=False)
    recording_ref = fields.Char()
    recording_duration_seconds = fields.Integer()
    error_code = fields.Char()
    error_message = fields.Char()
    status_callback_url = fields.Char()
    recording_status_callback_url = fields.Char()
    started_at = fields.Datetime()
    ended_at = fields.Datetime()

    _provider_call_unique = models.UniqueIndex(
        '(connection_id, provider_call_id) WHERE provider_call_id IS NOT NULL',
        'A provider call is logged once per connection.',
    )
    _speak_text = models.Constraint(
        'CHECK(mode <> \'speak\' OR speak_text IS NOT NULL)', 'a speak call carries the text it speaks',
    )
    _bridge_to = models.Constraint(
        'CHECK(mode <> \'bridge\' OR bridge_to IS NOT NULL)', 'a bridge call carries the customer number',
    )

    @api.model
    def _liwan_callback_urls(self, connection):
        """``{'status', 'recording'}`` callback URLs of a call on ``connection``, each False without a public HTTPS base."""
        base = (connection.get_base_url() or '').strip().rstrip('/')
        if not public_https(base):
            return {'status': False, 'recording': False}
        hooks = f'{base}/api/v1/public/integrations/hooks/{connection.provider}/{connection.id}'
        return {'status': f'{hooks}/{CALLBACK_KIND}', 'recording': f'{hooks}/{RECORDING_CALLBACK_KIND}'}

    def _liwan_status_values(self):
        """The plain state of one row, the only shape a service caller reads back."""
        self.ensure_one()
        return {
            'id': self.id,
            'mode': self.mode,
            'origin': self.origin,
            'state': self.state,
            'to': self.to,
            'from_value': self.from_value,
            'duration_seconds': self.duration_seconds or None,
            'recorded': self.recorded,
            'error_code': self.error_code or None,
            'error_message': self.error_message or None,
            'created_at': self.create_date,
            'started_at': self.started_at,
            'ended_at': self.ended_at,
        }

    def _liwan_fail(self, code, message):
        return self.write({
            'state': 'failed', 'error_code': code, 'error_message': message[:ERROR_TEXT_LENGTH],
        })

    @api.model
    def _liwan_settle_interrupted_calls(self):
        """Turn an old ``initiated`` row with no provider call id into ``unconfirmed`` (cron, root user).

        The row is committed before the provider is called (D5); a crash or timeout between that commit
        and the call leaves a row the callbacks can never match. It stays ``unconfirmed`` on the log and
        holds its connection no longer.
        """
        self.search([
            ('state', '=', 'initiated'), ('provider_call_id', '=', False),
            ('create_date', '<', fields.Datetime.now() - STALE_CALL_AFTER),
        ]).write({
            'state': 'unconfirmed', 'error_code': 'interrupted',
            'error_message': self.env._('The call was placed but no result was recorded; check the call log.'),
        })

    @api.model
    def _liwan_purge_old(self):
        """Delete the call rows older than the 24 months the log is kept, in batches (daily cron, root user).

        The call log joins the message purge cron through its own model, exactly like the message one.
        """
        cutoff = fields.Datetime.now() - RETENTION
        cron = self.env['ir.cron']
        while True:
            old = self.search([('create_date', '<', cutoff)], limit=PURGE_BATCH)
            if not old:
                return
            old.unlink()
            if cron._commit_progress(len(old)) <= 0:
                return

    # status callbacks, applied by liwan.integration.connection._liwan_apply_callback after the signature check

    def _liwan_apply_callback_status(self, kind, params):
        """Apply a verified call or recording status; False when it changes nothing (repeated, late, backward)."""
        self.ensure_one()
        module = providers.MODULES[self.provider]
        if kind == RECORDING_CALLBACK_KIND:
            values = module.recording_status(params, has_recording_ref=bool(self.recording_ref))
        elif kind == CALLBACK_KIND:
            values = module.call_status(params, self.state)
        else:
            return False
        if not values:
            return False
        if values.get('state') and values['state'] != self.state:
            values.setdefault('started_at' if values['state'] == 'in_progress' else 'ended_at', fields.Datetime.now())
        self.write(values)
        return True


class LiwanIntegrationConnectionCalls(models.Model):
    _inherit = 'liwan.integration.connection'

    def _liwan_callback_record(self, kind, params):
        """The call row a ``call-status`` or ``recording-status`` callback names on this connection.

        Both callbacks are signed over the same URL up to the kind segment, and both name the call by
        ``CallSid``, so both are verified against the status URL stored on the row they name.
        """
        if kind not in (CALLBACK_KIND, RECORDING_CALLBACK_KIND):
            return super()._liwan_callback_record(kind, params)
        self.ensure_one()
        call_id = providers.MODULES[self.provider].callback_call_id(params)
        if not call_id:
            return None
        return self.env['liwan.integration.call'].search(
            [('connection_id', '=', self.id), ('provider_call_id', '=', call_id)], limit=1,
        ) or None
