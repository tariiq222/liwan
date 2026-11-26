# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The company's telephony settings, per design section 7.

Every value a sector would want differently is a setting with a default, not code: the recording policy, the
announcement, retention, the default outbound line, and whether an IVR and business hours are in use.
"""
from odoo import fields, models


class LiwanTelephonySettings(models.Model):
    _name = 'liwan.telephony.settings'
    _description = 'Telephony settings'
    _liwan_scope = 'company'
    _rec_name = 'company_id'

    company_id = fields.Many2one(
        'res.company', required=True, default=lambda self: self.env.company, index=True, ondelete='cascade',
    )
    recording_policy = fields.Selection(
        [('always', 'Always'), ('on_demand', 'On demand'), ('off', 'Off')],
        required=True, default='always',
    )
    recording_announcement = fields.Boolean(
        default=True, help='Play the notice that the call is recorded. Cannot be turned off while the policy is always.',
    )
    retention_days = fields.Integer(default=90, help='How long a recording is kept before deletion.')
    default_line_id = fields.Many2one('liwan.telephony.line', help='The line an outbound call uses by default.')
    ivr_enabled = fields.Boolean(default=False)
    business_hours_enabled = fields.Boolean(default=False)
    outbound_international = fields.Boolean(
        default=False, help='Allow calls outside the country. Off by default, because an open trunk is a fraud risk.',
    )

    _sql_constraints = [
        ('company_unique', 'unique(company_id)', 'A company has one telephony settings record.'),
    ]

    def write(self, values):
        """A recorded call must say so: the announcement cannot be turned off while recording is always."""
        for settings in self:
            policy = values.get('recording_policy', settings.recording_policy)
            announcement = values.get('recording_announcement', settings.recording_announcement)
            if policy == 'always' and announcement is False:
                message = 'The recording announcement stays on while every call is recorded.'
                raise ValueError(message)
        return super().write(values)
