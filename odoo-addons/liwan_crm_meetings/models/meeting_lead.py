# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CRM opportunity a meeting belongs to (the CRM/meetings bridge)."""
from odoo import fields, models

from odoo.addons.liwan_meetings.models.meeting_minute import LiwanMeetingMinute


class LiwanMeetingMinuteLead(models.Model):
    _inherit = 'liwan.meeting.minute'

    # A meeting is a formal record that stays valid without its opportunity, so deleting the
    # opportunity clears the link instead of deleting the meeting (the project link does the same).
    lead_id = fields.Many2one('crm.lead', check_company=True, index=True, ondelete='set null')
    _CONTENT_FIELDS = LiwanMeetingMinute._CONTENT_FIELDS | {'lead_id'}
