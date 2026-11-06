# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The readiness check of the setup agent for liwan_meetings: the application is in use once it holds its first main record."""
from odoo import api, models

RECORD_CHECK = {
    'key': 'meetings.meetings', 'owner': 'liwan_meetings', 'feature_key': 'meetings.enabled', 'model': 'liwan.meeting.event',
    'capability': 'meetings.read', 'page': '/meetings',
    'label_ar': 'لا اجتماعات بعد: أنشئ أول اجتماع',
    'label_en': 'No meetings yet: create the first meeting',
}


class LiwanMeetingsAiReadiness(models.AbstractModel):
    _inherit = 'liwan.ai.readiness'

    @api.model
    def _liwan_ai_record_checks(self):
        return (*super()._liwan_ai_record_checks(), RECORD_CHECK)
