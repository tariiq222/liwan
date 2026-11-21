# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

import phonenumbers

from odoo import api, fields, models

from .call import PENDING_STATES
from .messaging import ELEVATED_MODELS, refuse
from .registry import SENDER_USES
from odoo.addons.liwan_integrations_sa import providers
from odoo.addons.liwan_integrations_sa.providers import errors
from odoo.addons.liwan_integrations_sa.providers.twilio import voice as twilio_voice

_logger = logging.getLogger(__name__)

TEXT_MAX = 500
SPEAK = 'speak'
BRIDGE = 'bridge'


class LiwanIntegrationVoice(models.AbstractModel):
    """The one entry point to place a call through the company's provider connection.

    An application calls it as its own user, who holds no ACL on senders, settings, logs or secrets: the
    caller's route checks the caller's own capability, and this service checks the company, the tenant's
    right to act outward, the use's feature and the daily limit. Like ``liwan.mail.send`` it keeps its
    elevation inside and returns plain data, never a recordset.

    The log row is created and committed on its own cursor before the provider is called (D5): a crash or
    a timeout after the request was written leaves the row ``initiated`` on the log instead of vanishing
    with the caller's request, and nothing is ever retried automatically. The outcome is written the same
    way, so each step reads what the previous one committed.
    """
    _name = 'liwan.integration.voice'
    _description = 'LiwanOS voice service'
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
    def _liwan_speak(self, to, text, origin, language='ar', sender=None):
        """Place one call that speaks ``text`` to ``to`` and return its plain state ``{'id', 'state', ...}``."""
        if not isinstance(text, str) or not text.strip():
            refuse('invalid', self.env._('The spoken text must not be empty.'), field='text')
        if len(text) > TEXT_MAX:
            refuse('text_too_long', self.env._('The spoken text has at most %(max)s characters.', max=TEXT_MAX), field='text')
        return self._liwan_place(to, origin, sender, mode=SPEAK, speak_text=text, language=language)

    @api.model
    def _liwan_bridge(self, agent_number, customer_number, origin, sender=None):
        """Place one call to ``agent_number`` that dials ``customer_number`` in when the agent answers."""
        return self._liwan_place(agent_number, origin, sender, mode=BRIDGE, agent_number=customer_number)

    @api.model
    def _liwan_status(self, record_id, origin, requested_by=None):
        """The plain state of one row of ``origin`` in the current company (and of ``requested_by`` when given), or None."""
        domain = [('id', '=', record_id), ('company_id', '=', self.env.company.id), ('origin', '=', origin)]
        if requested_by is not None:
            domain.append(('requested_by', '=', requested_by.id))
        row = self._liwan_elevated('liwan.integration.call').search(domain, limit=1)
        return row._liwan_status_values() if row else None

    @api.model
    def _liwan_has_pending(self, connection):
        """Whether a call on ``connection`` may still reach the provider (not in a final state, not unconfirmed)."""
        return bool(self._liwan_elevated('liwan.integration.call').search_count(
            [('connection_id', '=', connection.id), ('state', 'in', PENDING_STATES)], limit=1,
        ))

    # internals

    @api.model
    def _liwan_place(self, to, origin, sender, mode, speak_text=None, language=None, agent_number=None):
        """Check the caller's right, commit the log row, call the provider once, commit the outcome (D5).

        ``to`` is the number Twilio dials first: the customer of a speak call, the agent of a bridge call.
        """
        company = self.env.company
        self._liwan_check_outward()
        resolved = self._liwan_resolve_sender(sender)
        number = self._liwan_normalize(to, company)
        agent = self._liwan_normalize(agent_number, company) if agent_number else None
        record = self._liwan_elevated('liwan.integration.settings')._liwan_values(company)['record_calls'] and mode == SPEAK
        self._liwan_check_daily_limit(company)
        values = {
            'company_id': company.id, 'connection_id': resolved.connection_id.id, 'sender_id': resolved.id,
            'provider': resolved.connection_id.provider, 'account_ref': resolved.connection_id.external_id,
            'from_value': resolved.value, 'to': number, 'mode': mode,
            'speak_text': speak_text or False, 'bridge_to': agent or False, 'origin': origin,
            'requested_by': self.env.uid,
        }
        row_id = self._liwan_create_row(company, values)
        state = self._liwan_call(company, values, row_id, speak_text, language, record)
        return {'id': row_id, **self._liwan_read_state(company, row_id, state, values)}

    @api.model
    def _liwan_check_daily_limit(self, company):
        """The per-company daily safety limit (D6), counted on its own cursor: the log rows of today were
        committed by earlier cursors, which this request's snapshot predates.
        """
        limit = self._liwan_elevated('liwan.integration.settings')._liwan_values(company)['daily_call_limit']
        today = fields.Datetime.to_datetime(fields.Date.context_today(self))
        with self.env.registry.cursor() as cursor:
            count = self._liwan_cursor_env(cursor, company)['liwan.integration.call'].sudo().search_count(
                [('company_id', '=', company.id), ('create_date', '>=', today)],
            )
        if count >= limit:
            refuse('daily_limit_reached', self.env._('The daily call limit of this company is reached.'), status=429)

    @api.model
    def _liwan_check_outward(self):
        if not self.env['liwan.entitlement.service']._liwan_may_act_outward():
            refuse('tenant_read_only', self.env._('Calling is paused while the subscription is not active.'), status=403)

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
    def _liwan_resolve_sender(self, sender=None):
        """The active voice sender of the company: the given one, or the channel default."""
        Sender = self._liwan_elevated('liwan.integration.sender')
        domain = [
            ('company_id', '=', self.env.company.id), ('channel', '=', 'voice'), ('active', '=', True),
        ]
        sender_id = sender.id if isinstance(sender, models.BaseModel) else sender
        if sender_id:
            found = Sender.search([*domain, ('id', '=', sender_id)], limit=1)
            if not found:
                refuse('sender_unavailable', self.env._('The sender is not available for voice calls.'), field='sender_id')
        else:
            found = Sender.search([*domain, ('is_default', '=', True)], limit=1)
            if not found:
                refuse('no_default_sender', self.env._('Choose a default sender for voice calls first.'), field='sender_id')
        connection = found.connection_id
        if connection.state == 'disabled':
            refuse('connection_disabled', self.env._('The connection of this sender is disabled.'), field='sender_id')
        use = connection._liwan_use(f'{connection.provider}.{SENDER_USES["voice"]}')
        self.env['liwan.entitlement.service'].require_read(use['feature_key'])
        return found

    @api.model
    def _liwan_create_row(self, company, values):
        """Create the log row on its own committed cursor, so it exists before any byte reaches Twilio (D5).

        A request cursor cannot be committed here: it would commit the caller's whole request. A fresh
        ``registry.cursor()`` commits only this row — the same pattern as ``liwan.outbound.mail`` and the
        payroll refusal audit. The environment on that cursor is the elevated one of the current company:
        the caller holds no ACL on the call log, and every value it stores was resolved and checked above.
        """
        urls = self.env['liwan.integration.call']._liwan_callback_urls(
            self._liwan_elevated('liwan.integration.connection').browse(values['connection_id']),
        )
        with self.env.registry.cursor() as cursor:
            Call = self._liwan_cursor_env(cursor, company)['liwan.integration.call'].sudo()
            row_id = Call.create({
                **values, 'status_callback_url': urls['status'], 'recording_status_callback_url': urls['recording'],
            }).id
            cursor.flush()
            cursor.commit()
        return row_id

    def _liwan_call(self, company, values, row_id, speak_text, language, record):
        """One provider call for the committed row; its outcome is written on its own committed cursor.

        The call's own values come from ``values``, resolved above: the request cursor's snapshot predates
        the committed row and would not see it. The credentials are read elevated, like every read here.
        """
        connection = self._liwan_elevated('liwan.integration.connection').browse(values['connection_id'])
        try:
            credentials = connection._liwan_provider_credentials()
            twiml = (
                twilio_voice.say_twiml(speak_text, language) if values['mode'] == SPEAK
                else twilio_voice.bridge_twiml(values['bridge_to'])
            )
            placed = providers.MODULES[values['provider']].create_call(connection.external_id, credentials, {
                'to': values['to'], 'sender_value': values['from_value'], 'twiml': twiml,
                'status_callback': self._liwan_status_url(connection) or None,
                'record': record,
                'recording_status_callback': self._liwan_recording_url(connection) if record else None,
            })
        except errors.ProviderError as error:
            outcome = {
                'state': 'unconfirmed' if error.unconfirmed else 'failed',
                'error_code': str(error.code) if error.code is not None else None,
                'error_message': str(error)[:200] or None,
            }
        else:
            outcome = {'state': placed['status'], 'provider_call_id': placed['provider_call_id']}
        try:
            self._liwan_write_outcome(company, row_id, outcome)
        except Exception:  # noqa: BLE001 - the call is already placed; the outcome write must not mask it
            _logger.warning('integration call %s outcome not written: %s', row_id, outcome.get('state'))
        return {'state': outcome['state'], 'error_code': outcome.get('error_code'), 'error_message': outcome.get('error_message')}

    @api.model
    def _liwan_status_url(self, connection):
        return self.env['liwan.integration.call']._liwan_callback_urls(connection)['status']

    @api.model
    def _liwan_recording_url(self, connection):
        return self.env['liwan.integration.call']._liwan_callback_urls(connection)['recording']

    @api.model
    def _liwan_write_outcome(self, company, row_id, outcome):
        """Write the provider outcome on its own committed cursor; the row was already placed (D5)."""
        values = {
            key: value for key, value in outcome.items()
            if value is not None or key in ('error_code', 'error_message')
        }
        with self.env.registry.cursor() as cursor:
            self._liwan_cursor_env(cursor, company)['liwan.integration.call'].sudo().browse(row_id).write(values)
            cursor.flush()
            cursor.commit()

    @api.model
    def _liwan_read_state(self, company, row_id, fallback, values):
        """The full plain state of the committed row, read on its own cursor; a vanished row keeps the
        outcome the provider call returned.
        """
        try:
            with self.env.registry.cursor() as cursor:
                row = self._liwan_cursor_env(cursor, company)['liwan.integration.call'].sudo().browse(row_id)
                state = row._liwan_status_values() if row.exists() else None
        except Exception:  # noqa: BLE001 - the call is already placed; the state read must not mask it
            _logger.warning('integration call %s state not read', row_id)
            state = None
        if state:
            return state
        return {
            'mode': values['mode'], 'state': fallback['state'], 'to': values['to'], 'from_value': values['from_value'],
            'duration_seconds': None, 'recorded': False, 'error_code': fallback.get('error_code'),
            'error_message': fallback.get('error_message'), 'created_at': None, 'started_at': None, 'ended_at': None,
        }

    @api.model
    def _liwan_cursor_env(self, cursor, company):
        """The elevated environment of the current company and user on ``cursor``; the row it touches was
        resolved and checked above in the caller's own company (see ``_liwan_create_row``).
        """
        context = dict(self.env.context, allowed_company_ids=[company.id])
        return api.Environment(cursor, self.env.uid, context)
