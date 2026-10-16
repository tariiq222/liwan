# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The project a meeting, a series or a recommendation belongs to (the meetings/PMO bridge)."""
from odoo import fields, models

from odoo.addons.webvue_meetings.models.meeting_minute import WebVueMeetingMinute
from odoo.addons.webvue_meetings.models.meeting_resolution import (
    WebVueMeetingResolution,
)


class WebVueMeetingMinuteProject(models.Model):
    _inherit = 'webvue.meeting.minute'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _CONTENT_FIELDS = WebVueMeetingMinute._CONTENT_FIELDS | {'project_id'}


class WebVueMeetingResolutionProject(models.Model):
    _inherit = 'webvue.meeting.resolution'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _DECISION_FIELDS = WebVueMeetingResolution._DECISION_FIELDS | {'project_id'}


class WebVueMeetingSeriesProject(models.Model):
    _inherit = 'webvue.meeting.series'

    project_id = fields.Many2one('project.project', check_company=True, index=True)

    def _webvue_extra_meeting_defaults(self):
        return {**super()._webvue_extra_meeting_defaults(), 'project_id': self.project_id.id}
