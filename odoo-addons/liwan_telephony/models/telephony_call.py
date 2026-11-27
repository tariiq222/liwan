# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The call record: one row per Asterisk ``linkedid``, the call key the agent sends.

Asterisk is the source of truth for the call's state; this model stores what it reported. A repeated ``event_id``
changes nothing (design 4.5), and the duration is computed from the timestamps rather than stored, so the row cannot
disagree with itself.
"""

from odoo import api, fields, models


class LiwanTelephonyCall(models.Model):
    _name = 'liwan.telephony.call'
    _description = 'Telephony call'
    _liwan_scope = 'company'
    _order = 'started_at desc, id desc'
    _rec_name = 'linkedid'

    linkedid = fields.Char(required=True, index=True, readonly=True)
    uniqueid = fields.Char(index=True, readonly=True)
    direction = fields.Selection(
        [('in', 'Incoming'), ('out', 'Outgoing'), ('internal', 'Internal')],
        required=True, readonly=True,
    )
    state = fields.Selection(
        [
            ('ringing', 'Ringing'),
            ('answered', 'Answered'),
            ('missed', 'Missed'),
            ('rejected', 'Rejected'),
            ('failed', 'Failed'),
            ('ended', 'Ended'),
        ],
        required=True, default='ringing', readonly=True,
    )
    remote_number = fields.Char(readonly=True)
    extension_number = fields.Char(readonly=True)
    queue = fields.Char(readonly=True)
    partner_id = fields.Many2one('res.partner', readonly=True, index=True)
    user_id = fields.Many2one('res.users', readonly=True, index=True)
    extension_id = fields.Many2one('liwan.telephony.extension', readonly=True, index=True)
    started_at = fields.Datetime(readonly=True, index=True)
    answered_at = fields.Datetime(readonly=True)
    ended_at = fields.Datetime(readonly=True)
    recording_state = fields.Selection(
        [('none', 'None'), ('pending', 'Pending'), ('available', 'Available'), ('expired', 'Expired')],
        default='none', required=True, readonly=True,
    )
    duration_seconds = fields.Integer(compute='_compute_duration_seconds')
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )

    _sql_constraints = [
        ('linkedid_company_unique', 'unique(linkedid, company_id)', 'A call has one row per linkedid.'),
    ]

    @api.depends('started_at', 'ended_at')
    def _compute_duration_seconds(self):
        for call in self:
            if not call.started_at or not call.ended_at:
                call.duration_seconds = 0
                continue
            delta = call.ended_at - call.started_at
            call.duration_seconds = max(int(delta.total_seconds()), 0)

    @api.model
    def _liwan_from_event(self, envelope):
        """The field values one agent envelope sets on the call it names.

        One call has several channels, and the agent sends one event per channel; the first one that carries a value
        wins for the call-wide fields, so a later internal leg cannot turn an inbound call into an outgoing one or
        erase the number. State only moves forward: a late event never returns a finished call to ringing.
        """
        call = envelope['call']
        values = {}
        direction = call.get('direction')
        if direction in ('in', 'out', 'internal'):
            values['direction'] = direction
        if call.get('state') in dict(self._fields['state'].selection):
            values['state'] = call['state']
        number = call.get('caller_number') or call.get('connected_number')
        if number:
            values['remote_number'] = number
        if call.get('dialed_exten'):
            values['extension_number'] = call['dialed_exten']
        if call.get('uniqueid'):
            values['uniqueid'] = call['uniqueid']
        for name in ('started_at', 'answered_at', 'ended_at'):
            raw = call.get(name)
            if raw:
                values[name] = raw[:19].replace('T', ' ')
        return values

    def _liwan_apply(self, values):
        """Write an event onto this call without letting it move backwards or erase what is known."""
        forward = {'ringing': 0, 'answered': 1, 'ended': 2, 'missed': 2, 'rejected': 2, 'failed': 2}
        current = forward.get(self.state, 0)
        incoming = forward.get(values.get('state'), 0)
        if incoming < current:
            values.pop('state', None)
        for name in ('remote_number', 'extension_number', 'uniqueid', 'started_at'):
            if not values.get(name) and self[name]:
                values.pop(name, None)
        for name in ('direction', 'company_id'):
            if self[name]:
                values.pop(name, None)
        if values:
            self.write(values)
        return self

    def _liwan_link_participants(self):
        """Bind the call to the extension and the employee it reached, once, from the number the agent named."""
        for call in self:
            if call.extension_id and call.user_id:
                continue
            extension = self.env['liwan.telephony.extension'].search(
                [('number', '=', call.extension_number or '')], limit=1,
            )
            if extension:
                call.write({'extension_id': extension.id, 'user_id': extension.user_id.id or False})
        return self

    def _liwan_extension_user(self):
        """The extension and the user a call belongs to, from the number the agent named."""
        number = self.extension_number or self.remote_number
        if not number:
            return self.env['liwan.telephony.extension']
        return self.env['liwan.telephony.extension'].search([('number', '=', number)], limit=1)
