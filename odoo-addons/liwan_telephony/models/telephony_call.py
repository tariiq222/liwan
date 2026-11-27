# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The call record: one row per Asterisk ``linkedid``, the call key the agent sends.

Asterisk is the source of truth for the call's state; this model stores what it reported. A repeated ``event_id``
changes nothing (design 4.5), and the duration is computed from the timestamps rather than stored, so the row cannot
disagree with itself.
"""
from datetime import datetime

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
        """The field values one agent envelope sets on the call it names."""
        call = envelope['call']
        values = {
            'direction': call.get('direction') or 'in',
            'state': call.get('state') or 'ringing',
            'remote_number': call.get('caller_number') or call.get('connected_number'),
            'extension_number': call.get('dialed_exten'),
            'uniqueid': call.get('uniqueid'),
        }
        for name in ('started_at', 'answered_at', 'ended_at'):
            raw = call.get(name)
            if raw:
                values[name] = datetime.strptime(raw[:19], '%Y-%m-%dT%H:%M:%S') if 'T' in raw else raw
        return values
