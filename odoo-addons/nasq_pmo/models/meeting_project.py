# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The project a meeting, a series or a recommendation belongs to (the meetings/PMO bridge)."""
from odoo import fields, models

from .meeting_workspace import NasqMeetingResolutionWorkspace, NasqMeetingWorkspace


class CyanMeetingMinuteProject(models.Model):
    _inherit = 'cyan.meeting.minute'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _CONTENT_FIELDS = NasqMeetingWorkspace._CONTENT_FIELDS | {'project_id'}


class CyanMeetingResolutionProject(models.Model):
    _inherit = 'cyan.meeting.resolution'

    project_id = fields.Many2one('project.project', check_company=True, index=True)
    _DECISION_FIELDS = NasqMeetingResolutionWorkspace._DECISION_FIELDS | {'project_id'}


class NasqMeetingSeriesProject(models.Model):
    _inherit = 'nasq.meeting.series'

    project_id = fields.Many2one('project.project', check_company=True, index=True)

    def _nasq_extra_meeting_defaults(self):
        return {**super()._nasq_extra_meeting_defaults(), 'project_id': self.project_id.id}
