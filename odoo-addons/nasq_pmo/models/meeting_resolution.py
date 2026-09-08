# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo import fields, models
from odoo.exceptions import AccessError, UserError

CONVERT_MARKER = 'nasq_pmo.resolution_convert_depth'


class CyanMeetingResolution(models.Model):
    _inherit = 'cyan.meeting.resolution'

    def write(self, vals):
        if not self.env.su and (self._DECISION_FIELDS | {'state', 'result'}) & set(vals):
            if self.env['project.task'].with_context(active_test=False).sudo().search_count(
                [('resolution_id', 'in', self.ids)], limit=1,
            ):
                raise UserError(self.env._("Follow this recommendation on its task."))
        return super().write(vals)

    def action_convert_to_task(self, project_id):
        """Mint a PMO task from this recommendation. Origin ids are opaque integers."""
        self.ensure_one()
        self.check_access('read')
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
        if meeting.state in meeting._LOCKED_STATES:
            raise UserError(self.env._("Reopen the meeting before converting a recommendation."))
        project = self.env['project.project'].browse(project_id).exists()
        if not project:
            raise UserError(self.env._("A visible current-company project is required."))
        project._nasq_check_visible_current()
        try:
            # Enter/flush before setting the creation marker: Odoo flush and
            # rollback clear precommit.data. Clear the marker before exit too.
            with self.env.cr.savepoint():
                marker = self.env.cr.precommit.data
                previous_depth = marker.get(CONVERT_MARKER, 0)
                marker[CONVERT_MARKER] = previous_depth + 1
                try:
                    task = self.env['project.task'].create({
                        'name': self.name,
                        'priority': self.priority,
                        'date_deadline': fields.Datetime.to_datetime(self.deadline) if self.deadline else False,
                        'user_ids': [(6, 0, [self.responsible_id.id])] if self.responsible_id else [],
                        'project_id': project.id,
                        'meeting_id': meeting.id,
                        'resolution_id': self.id,
                    })
                finally:
                    if previous_depth:
                        marker[CONVERT_MARKER] = previous_depth
                    else:
                        marker.pop(CONVERT_MARKER, None)
        except IntegrityError as error:
            if error.diag.constraint_name != 'project_task_nasq_resolution_task_unique':
                raise
            raise UserError(self.env._("This recommendation has already been converted.")) from error
        if self.responsible_id:
            meeting._nasq_notify_partners(
                self.responsible_id.partner_id,
                'meeting_converted',
                self.name,
                key=f'meeting-converted:{self.id}',
            )
        return task
