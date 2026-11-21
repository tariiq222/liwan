# Part of Odoo. See LICENSE file for full copyright and licensing details.
import ipaddress
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from dateutil.relativedelta import relativedelta

from odoo import api, fields, models

from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.providers import errors

_logger = logging.getLogger(__name__)

CHANNELS = [('sms', 'SMS'), ('whatsapp', 'WhatsApp')]
STATES = [
    ('queued', 'Queued'), ('sent', 'Sent'), ('delivered', 'Delivered'), ('undelivered', 'Undelivered'),
    ('failed', 'Failed'), ('unconfirmed', 'Unconfirmed'),
]
# A row in these states may still reach the provider: it holds its connection.
PENDING_STATES = ('queued', 'unconfirmed')
RETRY_STATES = ('failed', 'unconfirmed')
BODY_MAX = 1600
ERROR_TEXT_LENGTH = 200
CALLBACK_KIND = 'message-status'
OUTBOX_CRON = 'liwan_integrations_sa.ir_cron_integration_message_outbox'
OUTBOX_BATCH = 100
OUTBOX_COMPANY_BATCH = 20
# Rows looked at to fill one batch fairly across companies.
OUTBOX_SCAN = 1000
MAX_ATTEMPTS = 5
# Backoff after the attempts 1-4; the fifth attempt fails outright, so the fifth slot is never read.
BACKOFF_MINUTES = (1, 2, 4, 8)
# A send spends at most the client's connect and read timeouts; a younger marker may still be in flight.
STALE_SEND_AFTER = timedelta(seconds=60)
RETENTION = relativedelta(months=24)
PURGE_BATCH = 1000
# The GSM-7 basic character set and its extension table (each extension character takes two septets).
GSM7_BASIC = (
    '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
    '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
)
GSM7_EXTENSION = '^{}\\[~]|€\f'


def estimate_segments(body):
    """The SMS segments ``body`` takes: GSM-7 160 alone or 153 per part, otherwise UCS-2 70 alone or 67 per part."""
    body = body or ''
    if all(char in GSM7_BASIC or char in GSM7_EXTENSION for char in body):
        length = sum(2 if char in GSM7_EXTENSION else 1 for char in body)
        single, part = 160, 153
    else:
        # UCS-2 counts UTF-16 code units: a character outside the basic plane takes two.
        length = len(body.encode('utf-16-le')) // 2
        single, part = 70, 67
    if length <= single:
        return 1
    return -(-length // part)


def public_https(base):
    """Whether ``base`` is a public HTTPS origin a provider can call back: https, a host name, no local address."""
    parts = urlsplit(base or '')
    host = (parts.hostname or '').lower()
    if parts.scheme != 'https' or not host or host == 'localhost' or host.endswith(('.localhost', '.local')):
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return '.' in host
    return address.is_global


class LiwanIntegrationMessage(models.Model):
    """One SMS or WhatsApp message a company sends through a provider connection: its queue entry and its log row.

    The row is a snapshot (provider, account and sender value are copied), so deleting the connection or the sender
    never rewrites it. Read through the ORM only by holders of ``integrations.log.read``; everything else goes through
    the ``liwan.integration.messaging`` service.
    """
    _name = 'liwan.integration.message'
    _description = 'LiwanOS integration message'
    _liwan_scope = 'company'
    _order = 'id desc'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    channel = fields.Selection(CHANNELS, required=True)
    connection_id = fields.Many2one('liwan.integration.connection', index=True, ondelete='set null')
    sender_id = fields.Many2one('liwan.integration.sender', index=True, ondelete='set null')
    provider = fields.Char(required=True)
    account_ref = fields.Char(required=True)
    sender_value = fields.Char(required=True)
    to = fields.Char(required=True, index=True)
    body = fields.Text()
    content_sid = fields.Char()
    content_variables = fields.Json()
    origin = fields.Selection([('test', 'Settings test')], required=True)
    requested_by = fields.Many2one('res.users', ondelete='set null')
    state = fields.Selection(STATES, required=True, default='queued', index=True)
    read_at = fields.Datetime()
    provider_message_id = fields.Char()
    segments = fields.Integer()
    error_code = fields.Char()
    error_message = fields.Char()
    status_callback_url = fields.Char()
    sent_at = fields.Datetime()
    attempts = fields.Integer(default=0)
    next_attempt_at = fields.Datetime(default=fields.Datetime.now, index=True)
    send_token = fields.Char(copy=False)
    send_started_at = fields.Datetime(copy=False)

    _provider_message_unique = models.UniqueIndex(
        '(connection_id, provider_message_id) WHERE provider_message_id IS NOT NULL',
        'A provider message is logged once per connection.',
    )
    _body_length = models.Constraint(f'CHECK(char_length(body) <= {BODY_MAX})', f'a message body has at most {BODY_MAX} characters')
    _content = models.Constraint(
        'CHECK((body IS NOT NULL) <> (content_sid IS NOT NULL))', 'a message has a body or a template, never both',
    )

    @api.model
    def _liwan_callback_url(self, connection):
        """The status callback URL of a message on ``connection``, or False without a public HTTPS base."""
        base = (connection.get_base_url() or '').strip().rstrip('/')
        if not public_https(base):
            return False
        return f'{base}/api/v1/public/integrations/hooks/{connection.provider}/{connection.id}/{CALLBACK_KIND}'

    def _liwan_status_values(self):
        """The plain state of one row, the only shape a service caller reads back."""
        self.ensure_one()
        return {
            'id': self.id,
            'channel': self.channel,
            'origin': self.origin,
            'state': self.state,
            'to': self.to,
            'sender_value': self.sender_value,
            'segments': self.segments,
            'error_code': self.error_code or None,
            'error_message': self.error_message or None,
            'has_receipt': bool(self.status_callback_url),
            'created_at': self.create_date,
            'sent_at': self.sent_at,
            'read_at': self.read_at,
        }

    # the outbox: the cron that sends queued rows, run as the root user

    @api.model
    def _liwan_run_outbox(self):
        if not self.env['liwan.entitlement.service']._liwan_may_act_outward():
            return
        self._liwan_settle_interrupted_sends()
        due = self.search([
            ('state', '=', 'queued'), ('send_token', '=', False), ('next_attempt_at', '<=', fields.Datetime.now()),
        ], order='next_attempt_at, id', limit=OUTBOX_SCAN)
        batch, per_company, capped = self.browse(), {}, False
        for message in due:
            if len(batch) == OUTBOX_BATCH:
                capped = True
                break
            taken = per_company.get(message.company_id.id, 0)
            if taken == OUTBOX_COMPANY_BATCH:
                capped = True
                continue
            per_company[message.company_id.id] = taken + 1
            batch |= message
        cron = self.env['ir.cron']
        cron._commit_progress(remaining=len(batch))
        for message in batch:
            if not message._liwan_claim():
                continue
            # The claim is durable before the provider is called: a crash from here on settles as unconfirmed.
            cron._commit_progress(0)
            try:
                with self.env.cr.savepoint():
                    message.with_company(message.company_id)._liwan_deliver()
            except Exception as error:  # noqa: BLE001 - one bad row must not block the queue; its claim settles it
                _logger.warning('integration message %s failed: %s', message.id, type(error).__name__)
            cron._commit_progress(1)
        if capped or len(due) == OUTBOX_SCAN:
            self._liwan_wake_outbox()

    @api.model
    def _liwan_wake_outbox(self):
        cron_id = self.env['ir.model.data']._xmlid_to_res_id(OUTBOX_CRON, raise_if_not_found=False)
        if cron_id:
            self.env['ir.cron'].browse(cron_id)._trigger()

    def _liwan_claim(self):
        """Take this queued row for one send attempt; False when another run took it first.

        One conditional update on the row: two runs at once cannot both see it unclaimed.
        """
        self.ensure_one()
        self.flush_recordset()
        self.env.cr.execute(
            'UPDATE liwan_integration_message SET send_token = %s, send_started_at = %s '
            "WHERE id = %s AND state = 'queued' AND send_token IS NULL RETURNING id",
            (secrets.token_hex(16), fields.Datetime.now(), self.id),
        )
        claimed = bool(self.env.cr.fetchone())
        self.invalidate_recordset(['send_token', 'send_started_at'])
        return claimed

    @api.model
    def _liwan_settle_interrupted_sends(self):
        """A claimed row whose send left no result may be at the provider: it becomes unconfirmed, never re-sent."""
        stuck = self.search([
            ('state', '=', 'queued'), ('send_token', '!=', False),
            '|', ('send_started_at', '=', False), ('send_started_at', '<', fields.Datetime.now() - STALE_SEND_AFTER),
        ], limit=OUTBOX_BATCH)
        stuck.write({
            'state': 'unconfirmed', 'send_token': False, 'send_started_at': False, 'error_code': 'interrupted',
            'error_message': self.env._('A send attempt recorded no result; check with the recipient before retrying.'),
        })

    def _liwan_deliver(self):
        self.ensure_one()
        connection, sender = self.connection_id, self.sender_id
        if not connection or connection.state == 'disabled':
            return self._liwan_fail('connection_disabled', self.env._('The connection is disabled or deleted.'))
        if not sender or not sender.active:
            return self._liwan_fail('sender_unavailable', self.env._('The sender is archived or deleted.'))
        try:
            credentials = connection._liwan_provider_credentials()
            sent = providers.MODULES[self.provider].send_message(connection.external_id, credentials, {
                'channel': self.channel, 'to': self.to, 'sender_kind': sender.kind, 'sender_value': self.sender_value,
                'body': self.body, 'content_sid': self.content_sid, 'content_variables': self.content_variables,
                'status_callback': self.status_callback_url or None,
            })
        except errors.ProviderError as error:
            return self._liwan_record_failure(error)
        values = {
            'provider_message_id': sent['provider_message_id'], 'segments': sent['segments'] or self._liwan_estimate(),
            'attempts': self.attempts + 1, 'send_token': False, 'send_started_at': False,
        }
        if sent['accepted']:
            values.update({'state': 'sent', 'sent_at': fields.Datetime.now(), 'error_code': False, 'error_message': False})
        else:
            values.update({
                'state': 'failed', 'error_code': sent['error_code'] or 'provider_refused',
                'error_message': (sent['error_message'] or '')[:ERROR_TEXT_LENGTH] or False,
            })
        return self.write(values)

    def _liwan_estimate(self):
        return estimate_segments(self.body) if self.body else 1

    def _liwan_fail(self, code, message):
        return self.write({
            'state': 'failed', 'error_code': code, 'error_message': message[:ERROR_TEXT_LENGTH],
            'send_token': False, 'send_started_at': False,
        })

    def _liwan_record_failure(self, error):
        """A provider refusal: retryable ones wait 1, 2, 4, 8 then 16 minutes, unconfirmed ones are never re-sent."""
        attempts = self.attempts + 1
        values = {
            'attempts': attempts, 'send_token': False, 'send_started_at': False,
            'error_code': str(error.code) if error.code is not None else ('unconfirmed' if error.unconfirmed else 'provider_error'),
            'error_message': str(error)[:ERROR_TEXT_LENGTH],
        }
        if error.unconfirmed:
            values['state'] = 'unconfirmed'
        elif error.retryable and attempts < MAX_ATTEMPTS:
            values['next_attempt_at'] = fields.Datetime.now() + relativedelta(minutes=BACKOFF_MINUTES[attempts - 1])
        else:
            values['state'] = 'failed'
        self.write(values)

    # status callbacks, applied by liwan.integration.connection._liwan_apply_callback after the signature check

    def _liwan_apply_callback_status(self, kind, params):
        """Apply a verified delivery status; False when it changes nothing (repeated, late, backward or unknown)."""
        self.ensure_one()
        if kind != CALLBACK_KIND:
            return False
        values = providers.MODULES[self.provider].message_status(params, self.state, bool(self.read_at))
        if not values:
            return False
        if values.pop('read', False):
            values['read_at'] = fields.Datetime.now()
        self.write(values)
        return True

    @api.model
    def _liwan_purge_old(self):
        """Delete the rows older than the 24 months the log is kept, in batches (daily cron, root user)."""
        cutoff = fields.Datetime.now() - RETENTION
        cron = self.env['ir.cron']
        while True:
            old = self.search([('create_date', '<', cutoff)], limit=PURGE_BATCH)
            if not old:
                return
            old.unlink()
            if cron._commit_progress(len(old)) <= 0:
                return


class LiwanIntegrationConnectionMessages(models.Model):
    _inherit = 'liwan.integration.connection'

    def _liwan_callback_record(self, kind, params):
        """The message row a ``message-status`` callback names on this connection, by the provider message id."""
        if kind != CALLBACK_KIND:
            return super()._liwan_callback_record(kind, params)
        self.ensure_one()
        module = providers.MODULES.get(self.provider)
        message_id = module.callback_message_id(params) if callable(getattr(module, 'callback_message_id', None)) else None
        if not message_id:
            return None
        return self.env['liwan.integration.message'].search(
            [('connection_id', '=', self.id), ('provider_message_id', '=', message_id)], limit=1,
        ) or None
