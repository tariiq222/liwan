# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Who listened to which recording, and when.

A read-only audit the customer can show: the record is written by the route that hands out the signed link, never by a
user, and it is never edited or deleted (design 4.4 and section 11.1).
"""
from odoo import fields, models


class LiwanTelephonyRecordingAccess(models.Model):
    _name = 'liwan.telephony.recording.access'
    _description = 'Telephony recording access'
    _liwan_scope = 'company'
    _check_company_auto = True
    _order = 'listened_at desc, id desc'

    call_id = fields.Many2one(
        'liwan.telephony.call', required=True, index=True, ondelete='restrict', check_company=True,
    )
    user_id = fields.Many2one('res.users', required=True, index=True, ondelete='restrict')
    listened_at = fields.Datetime(required=True, default=fields.Datetime.now, readonly=True)
    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True,
    )
