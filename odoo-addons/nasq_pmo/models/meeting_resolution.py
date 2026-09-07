# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import AccessError, UserError

CONVERT_MARKER = 'nasq_pmo.resolution_convert_depth'


class CyanMeetingResolution(models.Model):
    _inherit = 'cyan.meeting.resolution'

    def action_convert_to_task(self, project_id):
        """Mint a PMO task from this recommendation. Origin ids are opaque integers."""
        self.ensure_one()
        meeting = self.meeting_id
        meeting.check_access('read')
        if meeting.company_id != self.env.company:
            raise AccessError(self.env._("Meeting is outside the current company."))
        service = self.env['nasq.access.service']
        if not (
            service._nasq_has_capability(self.env.user, 'meetings.manage')
            or self._cyan_is_meeting_editor(meeting)
        ):
            raise AccessError(self.env._(
                "Only a meeting editor or meetings manager can convert a recommendation to a task.",
            ))
        project = self.env['project.project'].browse(project_id).exists()
        if not project:
            raise UserError(self.env._("A visible current-company project is required."))
        project._nasq_check_visible_current()
        marker = self.env.cr.precommit.data
        marker[CONVERT_MARKER] = marker.get(CONVERT_MARKER, 0) + 1
        try:
            task = self.env['project.task'].create({
                'name': self.name,
                'date_deadline': fields.Datetime.to_datetime(self.deadline) if self.deadline else False,
                'user_ids': [(6, 0, [self.responsible_id.id])] if self.responsible_id else [],
                'project_id': project.id,
                'meeting_id': meeting.id,
                'resolution_id': self.id,
            })
            if self.responsible_id:
                meeting._nasq_notify_partners(
                    self.responsible_id.partner_id,
                    'meeting_converted',
                    self.name,
                    key=f'meeting-converted:{self.id}',
                )
            return task
        finally:
            marker[CONVERT_MARKER] -= 1
            if not marker[CONVERT_MARKER]:
                marker.pop(CONVERT_MARKER, None)
