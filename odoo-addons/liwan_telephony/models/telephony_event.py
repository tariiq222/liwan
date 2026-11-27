# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The idempotency record of the machine route.

The agent assigns ``event_id`` when it enqueues the event and resends the same value on every retry, so this table is
what makes a retry safe: the row is written in the same transaction as the call change, and a repeat finds it and
does nothing (design 4.5).
"""
from odoo import fields, models


class LiwanTelephonyEvent(models.Model):
    _name = 'liwan.telephony.event'
    _description = 'Telephony event receipt'
    _liwan_scope = 'company'
    _order = 'received_at desc, id desc'

    event_id = fields.Char(required=True, index=True, readonly=True)
    linkedid = fields.Char(required=True, index=True, readonly=True)
    source = fields.Char(readonly=True)
    call_id = fields.Many2one('liwan.telephony.call', readonly=True, ondelete='cascade')
    received_at = fields.Datetime(required=True, default=fields.Datetime.now, readonly=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )

    _event_unique = models.Constraint('unique(event_id, company_id)', 'An event is applied once.')
