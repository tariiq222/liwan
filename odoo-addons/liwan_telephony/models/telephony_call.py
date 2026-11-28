# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The call record: one row per Asterisk ``linkedid``, the call key the agent sends.

Asterisk is the source of truth for the call's state; this model stores what it reported. A repeated ``event_id``
changes nothing (design 4.5), and the duration is computed from the timestamps rather than stored, so the row cannot
disagree with itself. The remote party is stored in E.164 or left empty: a number the phone library cannot read is
never guessed with a plus in front of it.
"""
import re
from datetime import datetime, timezone

from odoo import api, fields, models
from odoo.exceptions import UserError

from .res_company import lookup_order
from odoo.addons.phone_validation.tools.phone_validation import phone_format

DIRECTIONS = (('in', 'Incoming'), ('out', 'Outgoing'), ('internal', 'Internal'))
STATES = (
    ('ringing', 'Ringing'), ('answered', 'Answered'), ('missed', 'Missed'),
    ('rejected', 'Rejected'), ('failed', 'Failed'), ('ended', 'Ended'),
)
RECORDING_STATES = (
    ('none', 'None'), ('available', 'Available'), ('expired', 'Expired'),
)
# How far a call has moved. A late event never returns a finished call to ringing.
STATE_PROGRESS = {'ringing': 0, 'answered': 1, 'ended': 2, 'missed': 2, 'rejected': 2, 'failed': 2}
# The states at the end of the ladder: a call that reached one has no more events to come.
TERMINAL_STATES = tuple(state for state, progress in STATE_PROGRESS.items() if progress == max(STATE_PROGRESS.values()))
# How far a recording has moved. The file exists once the call's legs ended, and a recording the retention run
# deleted never comes back: a retried or reconciled ``ready`` event finds no file on disk.
RECORDING_PROGRESS = {'none': 0, 'available': 1, 'expired': 2}
# The fields that only move one way, each with its ladder: a value at the top of its ladder is final.
ORDERED_LADDERS = {'state': STATE_PROGRESS, 'recording_state': RECORDING_PROGRESS}
# The one value of ``call.recording`` the agent sends: the recording file exists once the call's legs ended.
RECORDING_READY = 'ready'
# E.164: a plus, a country code that does not start with zero, and at most fifteen digits in all.
E164 = re.compile(r'^\+[1-9][0-9]{6,14}$')
# The call key the agent accepts, and the only one its recording delete route deletes: one letter or digit, then up
# to 127 of them or dot, underscore and dash (``CALL_ID`` in ``apps/pbx-agent/src/pbx_agent/signing.py``). Both sides
# read one rule, so an event the agent could never delete a recording for is refused before it is stored.
LINKEDID_PATTERN = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,127}')
# The country a number without a country prefix is read in, when the call's company names none.
DEFAULT_PHONE_COUNTRY = 'base.sa'
TIMESTAMP_FIELDS = ('started_at', 'answered_at', 'ended_at')


def parse_iso_timestamp(value):
    """Parse an ISO-8601 datetime string into UTC naive ``YYYY-MM-DD HH:MM:SS``, or raise ``ValueError``."""
    if not isinstance(value, str) or 'T' not in value:
        msg = 'expected an ISO-8601 datetime string'
        raise ValueError(msg)
    normalized = f'{value[:-1]}+00:00' if value.endswith(('Z', 'z')) else value
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.strftime('%Y-%m-%d %H:%M:%S')


def moves_forward(current, incoming, ladder):
    """Whether ``incoming`` may replace ``current`` on ``ladder``: never behind it, and never over a final value."""
    return ladder[current] < max(ladder.values()) and ladder[incoming] >= ladder[current]


class LiwanTelephonyCall(models.Model):
    _name = 'liwan.telephony.call'
    _description = 'Telephony call'
    _liwan_scope = 'company'
    _check_company_auto = True
    _order = 'started_at desc, id desc'
    _rec_name = 'linkedid'

    linkedid = fields.Char(required=True, index=True, readonly=True)
    direction = fields.Selection(DIRECTIONS, required=True, readonly=True)
    state = fields.Selection(STATES, required=True, default='ringing', readonly=True)
    remote_number = fields.Char(readonly=True, index=True)
    # The extension number the last event named, until an extension of the tenant is linked.
    extension_number = fields.Char(readonly=True)
    partner_id = fields.Many2one('res.partner', readonly=True, index=True, check_company=True)
    user_id = fields.Many2one('res.users', readonly=True, index=True)
    extension_id = fields.Many2one('liwan.telephony.extension', readonly=True, index=True, check_company=True)
    started_at = fields.Datetime(readonly=True, index=True)
    answered_at = fields.Datetime(readonly=True)
    ended_at = fields.Datetime(readonly=True)
    recording_state = fields.Selection(RECORDING_STATES, default='none', required=True, readonly=True)
    duration_seconds = fields.Integer(compute='_compute_duration_seconds')
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )

    _linkedid_company_unique = models.Constraint('unique(linkedid, company_id)', 'A call has one row per linkedid.')

    @api.depends('started_at', 'ended_at')
    def _compute_duration_seconds(self):
        for call in self:
            if not call.started_at or not call.ended_at:
                call.duration_seconds = 0
                continue
            delta = call.ended_at - call.started_at
            call.duration_seconds = max(int(delta.total_seconds()), 0)

    @api.model
    def _liwan_e164(self, number, company):
        """``number`` in E.164 as the phone library reads it in the country of ``company`` (Saudi Arabia when the
        company names none), or None for a number it refuses.

        None is also what a deployment without the phone library gets: its tool hands the text back as it came,
        which is not E.164, so nothing is stored rather than a plus put in front of raw digits.
        """
        if not isinstance(number, str) or not number.strip():
            return None
        country = company.country_id or self.env.ref(DEFAULT_PHONE_COUNTRY)
        try:
            formatted = phone_format(
                number.strip(), country.code, country.phone_code, force_format='E164', raise_exception=True,
            )
        except UserError:
            return None
        return formatted if E164.fullmatch(formatted) else None

    @api.model
    def _liwan_parties(self, event, direction):
        """``(remote party, extension number)`` the event's leg names for a call of ``direction``.

        The direction is the call's, fixed by its first event: the agent labels each leg by the context the channel
        was created in, so a later leg of the same call can carry another label. An incoming call's remote party is
        the caller and its extension the dialled one, an outgoing call's remote party is the connected number (or
        the dialled extension when unanswered or from CEL) and its extension the caller, and an internal call
        reaches an extension and has no remote party.
        """
        call = event['call']
        if direction == 'out':
            return call.get('connected_number') or call.get('dialed_exten'), call.get('caller_number')
        if direction == 'internal':
            return None, call.get('dialed_exten')
        return call.get('caller_number'), call.get('dialed_exten')

    @api.model
    def _liwan_event_values(self, event, company, direction):
        """The field values one agent event sets on the call of ``direction`` it names, in ``company``.

        Only what the event carries is returned, so the first event that carries a value sets it and a later one
        never erases it. The state and the recording state are written as they came: ``_liwan_apply`` owns the
        ordering that keeps them from moving backwards.
        """
        call = event['call']
        values = {'direction': direction, 'state': call['state']}
        remote, extension = self._liwan_parties(event, direction)
        number = self._liwan_e164(remote, company)
        if number:
            values['remote_number'] = number
        if extension:
            values['extension_number'] = extension
        if call.get('recording') == RECORDING_READY:
            values['recording_state'] = 'available'
        for name in TIMESTAMP_FIELDS:
            if call.get(name):
                values[name] = parse_iso_timestamp(call[name])
        return values

    @api.model
    def _liwan_by_linkedid(self, linkedid, company=None):
        """The call Asterisk keys ``linkedid`` in the tenant, or none: of ``company`` when it has one, else of any
        other company the caller belongs to. One call has one row, whatever branch's extension made it."""
        for company_id in lookup_order(self.env.user, company):
            found = self.with_company(company_id).search([('linkedid', '=', linkedid)], limit=1)
            if found:
                return found
        return self.browse()

    def _liwan_apply(self, values):
        """Write an event onto this call without letting it move backwards or forget what it knows.

        The state and the recording state only move one way, and their last values are final: a late, retried or
        reconciled event leaves a finished call finished and an expired recording expired. The direction and the
        company were decided by the first event, the start and the remote number by the first event that carried them,
        and the extension number stays once an extension is linked.
        """
        for name, ladder in ORDERED_LADDERS.items():
            if name in values and not moves_forward(self[name], values[name], ladder):
                del values[name]
        for name in ('direction', 'remote_number', 'started_at'):
            if self[name]:
                values.pop(name, None)
        if self.extension_id:
            values.pop('extension_number', None)
        if values:
            self.write(values)
        return self

    def _liwan_link_participants(self):
        """Bind the call, each once, to the extension the event named, to that extension's user and to the partner
        behind the call's number.

        The extension is searched strictly inside ``call.company_id`` so a call can never link another branch's
        extension.
        """
        Extension = self.env['liwan.telephony.extension']
        for call in self:
            if not call.extension_id and call.extension_number:
                extension = Extension.with_company(call.company_id).search([
                    ('number', '=', call.extension_number),
                    ('company_id', '=', call.company_id.id),
                ], limit=1)
                if extension:
                    call.write({'extension_id': extension.id, 'user_id': extension.user_id.id or False})
            if not call.partner_id and call.remote_number:
                partner = self._liwan_partner(call.remote_number, call.company_id)
                if partner:
                    call.write({'partner_id': partner.id})
        return self

    @api.model
    def _liwan_partner(self, number, company):
        """The partner of ``company``, or a shared one, whose sanitized phone is the E.164 ``number``, or none."""
        return self.env['res.partner'].search(
            [('phone_sanitized', '=', number), ('company_id', 'in', [False, company.id])], limit=1, order='id',
        )
