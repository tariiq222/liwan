# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The project a meeting, a series or a recommendation belongs to (the meetings/PMO bridge)."""
from odoo import fields, models

from odoo.addons.liwan_meetings.models.meeting_minute import LiwanMeetingMinute
from odoo.addons.liwan_meetings.models.meeting_resolution import (
    LiwanMeetingResolution,
)


class LiwanMeetingMinuteProject(models.Model):
    _inherit = 'liwan.meeting.minute'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _CONTENT_FIELDS = LiwanMeetingMinute._CONTENT_FIELDS | {'project_id'}


class LiwanMeetingResolutionProject(models.Model):
    _inherit = 'liwan.meeting.resolution'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _DECISION_FIELDS = LiwanMeetingResolution._DECISION_FIELDS | {'project_id'}


class LiwanMeetingSeriesProject(models.Model):
    _inherit = 'liwan.meeting.series'

    project_id = fields.Many2one('project.project', check_company=True, index=True)

    def _liwan_extra_meeting_defaults(self):
        return {**super()._liwan_extra_meeting_defaults(), 'project_id': self.project_id.id}
