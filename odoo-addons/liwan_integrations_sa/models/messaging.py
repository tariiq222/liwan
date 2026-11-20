# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

import phonenumbers

from odoo import api, fields, models

from .message import BODY_MAX, PENDING_STATES, RETRY_STATES
from .registry import SENDER_USES
from .sender import CHANNEL_CAPABILITIES
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MESSAGING_CHANNELS = ('sms', 'whatsapp')
CONTENT_SID = re.compile(r'HX[0-9a-fA-F]{32}')
CONTENT_VARIABLES_MAX = 50
CONTENT_VARIABLE_KEY_MAX = 64
CONTENT_VARIABLE_VALUE_MAX = 1024
# The only models the service reads and writes for its caller, who holds no ACL on any of them.
ELEVATED_MODELS = ('liwan.integration.message', 'liwan.integration.sender', 'liwan.integration.settings')


def refuse(code, message, field=None, status=422):
    raise LiwanAccessRule(code, message, field=field, status=status)


class LiwanIntegrationMessaging(models.AbstractModel):
    """The one entry point to send an SMS or WhatsApp message through the company's provider connection.

    An application calls it as its own user, who holds no ACL on senders, settings, logs or secrets: the caller's route
    checks the caller's own capability, and this service checks the company, the tenant's right to act outward, the
    use's feature and the daily limit. Like ``liwan.mail.send`` it keeps its elevation inside (``_liwan_elevated``)
    and returns plain data, never a recordset. It never calls the provider: the outbox cron does.
    """
    _name = 'liwan.integration.messaging'
    _description = 'LiwanOS messaging service'
    _liwan_scope = 'global'

    @api.model
    def _liwan_elevated(self, model):
        """``model`` in the elevated environment of the current company; only the ACL rows that give these models to
        the integrations capability groups block the caller, and every read here filters the company itself.
        """
        if model not in ELEVATED_MODELS:
            raise ValueError(model)
        return self.env[model].sudo().with_company(self.env.company)

    @api.model
    def _liwan_send(self, to, origin, channel='sms', body=None, content_sid=None, content_variables=None, sender=None):
        """Queue one message and return its plain state ``{'id', 'state', ...}``; a refusal is a ``LiwanAccessRule``.

        ``sender`` is a sender id (or record) of the company; without it the company default of ``channel`` is used.
        """
        company = self.env.company
        self._liwan_check_outward()
        if channel not in MESSAGING_CHANNELS:
            refuse('invalid', self.env._('The channel must be SMS or WhatsApp.'), field='channel')
        self._liwan_check_content(body, content_sid, content_variables)
        number = self._liwan_normalize(to, company)
        resolved = self._liwan_resolve_sender(channel, sender)
        return self._liwan_queue(company, resolved, {
            'channel': channel, 'to': number, 'origin': origin, 'body': body or False,
            'content_sid': content_sid or False, 'content_variables': content_variables or False,
        })

    @api.model
    def _liwan_status(self, record_id, origin, requested_by=None):
        """The plain state of one row of ``origin`` in the current company (and of ``requested_by`` when given), or None."""
        domain = [('id', '=', record_id), ('company_id', '=', self.env.company.id), ('origin', '=', origin)]
        if requested_by is not None:
            domain.append(('requested_by', '=', requested_by.id))
        row = self._liwan_elevated('liwan.integration.message').search(domain, limit=1)
        return row._liwan_status_values() if row else None

    @api.model
    def _liwan_retry(self, message_id):
        """Queue a failed or unconfirmed row once more as a new row; the old row stays as it is (D5)."""
        self._liwan_check_outward()
        Message = self._liwan_elevated('liwan.integration.message')
        row = Message.search([('id', '=', message_id), ('company_id', '=', self.env.company.id)], limit=1)
        if not row:
            return None
        if row.state not in RETRY_STATES:
            refuse('invalid', self.env._('Only a failed or unconfirmed message can be sent again.'), field='state')
        resolved = self._liwan_resolve_sender(row.channel, row.sender_id.id or None, required=True)
        return self._liwan_queue(self.env.company, resolved, {
            'channel': row.channel, 'to': row.to, 'origin': row.origin, 'body': row.body,
            'content_sid': row.content_sid, 'content_variables': row.content_variables,
        })

    @api.model
    def _liwan_has_pending(self, connection):
        """Whether a message on ``connection`` may still reach the provider (queued or unconfirmed)."""
        return bool(self._liwan_elevated('liwan.integration.message').search_count(
            [('connection_id', '=', connection.id), ('state', 'in', PENDING_STATES)], limit=1,
        ))

    # internals

    @api.model
    def _liwan_check_content(self, body, content_sid, content_variables):
        if bool(body) == bool(content_sid):
            refuse('invalid', self.env._('A message has a body or a template, not both.'), field='body')
        if body is not None and not isinstance(body, str):
            refuse('invalid', self.env._('The body must be text.'), field='body')
        if body and len(body) > BODY_MAX:
            refuse('body_too_long', self.env._('A message has at most %(max)s characters.', max=BODY_MAX), field='body')
        if content_sid and not (isinstance(content_sid, str) and CONTENT_SID.fullmatch(content_sid)):
            refuse('invalid', self.env._('The template id is not valid.'), field='content_sid')
        if content_variables is None:
            return
        if not content_sid or not isinstance(content_variables, dict) or len(content_variables) > CONTENT_VARIABLES_MAX or not all(
            isinstance(key, str) and 1 <= len(key) <= CONTENT_VARIABLE_KEY_MAX
            and isinstance(value, str) and len(value) <= CONTENT_VARIABLE_VALUE_MAX
            for key, value in content_variables.items()
        ):
            refuse('invalid', self.env._('Template variables are a map of names to text.'), field='content_variables')

    @api.model
    def _liwan_normalize(self, to, company):
        """``to`` as E.164; a local number is read in the company's country."""
        region = company.country_id.code or None
        try:
            parsed = phonenumbers.parse(to, region) if isinstance(to, str) and to.strip() else None
        except phonenumbers.NumberParseException:
            parsed = None
        if not parsed or not phonenumbers.is_valid_number(parsed):
            refuse('invalid_phone', self.env._('The phone number is not valid.'), field='to')
        return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)

    @api.model
    def _liwan_resolve_sender(self, channel, sender=None, required=False):
        """The active sender of the company for ``channel``: the given one, or the channel default."""
        Sender = self._liwan_elevated('liwan.integration.sender')
        domain = [('company_id', '=', self.env.company.id), ('channel', '=', channel), ('active', '=', True)]
        sender_id = sender.id if isinstance(sender, models.BaseModel) else sender
        if sender_id:
            found = Sender.search([*domain, ('id', '=', sender_id)], limit=1)
            if not found:
                refuse('sender_unavailable', self.env._('The sender is not available for this channel.'), field='sender_id')
        elif required:
            refuse('sender_unavailable', self.env._('The sender of this message no longer exists.'), field='sender_id')
        else:
            found = Sender.search([*domain, ('is_default', '=', True)], limit=1)
            if not found:
                refuse('no_default_sender', self.env._('Choose a default sender for this channel first.'), field='sender_id')
        connection = found.connection_id
        if connection.state == 'disabled':
            refuse('connection_disabled', self.env._('The connection of this sender is disabled.'), field='sender_id')
        if CHANNEL_CAPABILITIES[channel] not in connection._liwan_definition()['capabilities']:
            refuse('sender_unavailable', self.env._('The provider of this sender cannot send messages.'), field='sender_id')
        use = connection._liwan_use(f'{connection.provider}.{SENDER_USES[channel]}')
        self.env['liwan.entitlement.service'].require_read(use['feature_key'])
        return found

    @api.model
    def _liwan_check_outward(self):
        if not self.env['liwan.entitlement.service']._liwan_may_act_outward():
            refuse('tenant_read_only', self.env._('Sending is paused while the subscription is not active.'), status=403)

    @api.model
    def _liwan_queue(self, company, sender, values):
        Message = self._liwan_elevated('liwan.integration.message')
        limit = self._liwan_elevated('liwan.integration.settings')._liwan_values(company)['daily_message_limit']
        today = fields.Datetime.to_datetime(fields.Date.context_today(self))
        if Message.search_count([('company_id', '=', company.id), ('create_date', '>=', today)]) >= limit:
            refuse('daily_limit_reached', self.env._('The daily message limit of this company is reached.'), status=429)
        connection = sender.connection_id
        row = Message.create({
            **values, 'company_id': company.id, 'connection_id': connection.id, 'sender_id': sender.id,
            'provider': connection.provider, 'account_ref': connection.external_id, 'sender_value': sender.value,
            'requested_by': self.env.uid, 'status_callback_url': Message._liwan_callback_url(connection),
        })
        Message._liwan_wake_outbox()
        return row._liwan_status_values()
