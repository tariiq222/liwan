# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date, datetime

from odoo import fields, models
from odoo.exceptions import AccessError, ValidationError

from .project_task import DEPENDENCY_WRITE_MARKER, SCHEDULE_WRITE_MARKER


def _raise_on_dependency_cycle(task, ids):
    """Raise ValidationError when ``ids`` reach back to ``task`` through ``depend_on_ids``.

    Kept as a module-level helper so ``_webvue_set_dependencies`` stays short;
    the walk, its order and its error are the ones it had inline.
    """
    all_tasks = task.env['project.task'].with_context(active_test=False).search([
        ('company_id', '=', task.env.company.id),
        ('project_id', '=', task.project_id.id),
        ('project_id.active', '=', True),
        ('project_id.company_id', '=', task.env.company.id),
    ])
    dependency_graph = {
        candidate.id: set(candidate.depend_on_ids.ids) & set(all_tasks.ids)
        for candidate in all_tasks
    }
    pending = list(ids)
    visited = set()
    while pending:
        dependency_id = pending.pop()
        if dependency_id == task.id:
            raise ValidationError(task.env._("Task dependencies cannot contain a cycle."))
        if dependency_id in visited:
            continue
        visited.add(dependency_id)
        pending.extend(dependency_graph.get(dependency_id, ()))


class ProjectTaskSchedule(models.Model):
    _inherit = 'project.task'

    def _webvue_can_manage_dependencies(self):
        self.ensure_one()
        project = self.project_id
        return bool(
            project
            and project.active
            and project.company_id == self.env.company
            and project._webvue_can_manage(),
        )

    def _webvue_can_manage_schedule(self):
        self.ensure_one()
        project = self.project_id
        return bool(
            project
            and project.active
            and project.company_id == self.env.company
            and project._webvue_can_manage(),
        )

    def _webvue_set_schedule(self, start, end):
        """Set the date-only schedule pair after its dedicated manager check.

        This is intentionally separate from generic task writes. Project copy and
        schedule callers use this checked mutation path, while direct ORM/RPC
        writes cannot manufacture the internal marker used below.
        """
        self.ensure_one()
        self._webvue_check_visible_current()
        project = self.project_id
        if not project or not project.active or project.company_id != self.env.company:
            raise AccessError(self.env._("Scheduling requires an active current-company project."))
        project._webvue_check_visible_current()
        if not self._webvue_can_manage_schedule():
            raise AccessError(self.env._("Only the project manager can change task scheduling."))
        for value, label in ((start, 'start'), (end, 'end')):
            if value is not False and value is not None and (
                not isinstance(value, date) or isinstance(value, datetime)
            ):
                raise ValidationError(self.env._("Schedule %(field)s must be a calendar date or empty.", field=label))
        start = start or False
        end = end or False
        if bool(start) != bool(end):
            raise ValidationError(self.env._("Schedule start and end must be set together."))
        if start and end and start > end:
            raise ValidationError(self.env._("Schedule start must be on or before the end date."))
        marker = self.env.cr.precommit.data
        previous_depth = marker.get(SCHEDULE_WRITE_MARKER)
        marker[SCHEDULE_WRITE_MARKER] = (previous_depth or 0) + 1
        try:
            self.write({
                'webvue_planned_start': start,
                'date_deadline': fields.Datetime.to_datetime(end) if end else False,
            })
        finally:
            if previous_depth is None:
                marker.pop(SCHEDULE_WRITE_MARKER, None)
            else:
                marker[SCHEDULE_WRITE_MARKER] = previous_depth
        return self

    def _webvue_set_dependencies(self, ids):
        """Replace prerequisites after the project-scoped manage check.

        ``depend_on_ids`` is intentionally absent from TASK_WRITABLE_FIELDS;
        this operation has its own project-manager capability and validation
        boundary rather than becoming a generic task write field.
        """
        self.ensure_one()
        self._webvue_check_visible_current()
        project = self.project_id
        if not project or not project.active or project.company_id != self.env.company:
            raise ValidationError(self.env._("Dependencies require an active current-company project."))
        if not self._webvue_can_manage_dependencies():
            raise AccessError(self.env._("Only the project manager can change task dependencies."))
        if any(isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in ids):
            raise ValidationError(self.env._("Dependency ids must be positive integers."))
        if not project.allow_task_dependencies and ids:
            raise ValidationError(self.env._("Task dependencies are disabled for this project."))
        if len(ids) != len(set(ids)):
            raise ValidationError(self.env._("Dependency ids must be unique."))
        candidates = self.env['project.task'].search([
            ('id', 'in', ids),
            ('active', '=', True),
            ('company_id', '=', self.env.company.id),
            ('project_id', '=', project.id),
            ('project_id.active', '=', True),
            ('project_id.company_id', '=', self.env.company.id),
        ])
        if len(candidates) != len(ids):
            raise ValidationError(self.env._("Dependencies must belong to the same readable project."))
        candidates._webvue_check_visible_current()
        if self.id in candidates.ids:
            raise ValidationError(self.env._("A task cannot depend on itself."))
        _raise_on_dependency_cycle(self, ids)
        marker = self.env.cr.precommit.data
        previous_depth = marker.get(DEPENDENCY_WRITE_MARKER)
        marker[DEPENDENCY_WRITE_MARKER] = (previous_depth or 0) + 1
        try:
            self.write({'depend_on_ids': [(6, 0, ids)]})
        finally:
            if previous_depth is None:
                marker.pop(DEPENDENCY_WRITE_MARKER, None)
            else:
                marker[DEPENDENCY_WRITE_MARKER] = previous_depth
        return self

    def _webvue_validate_schedule_invariant(self):
        for task in self:
            start = task.webvue_planned_start
            end = fields.Date.to_date(task.date_deadline) if task.date_deadline else False
            if start and (not end or start > end):
                raise ValidationError(self.env._(
                    "Schedule start and end must be set together, with start on or before the end date.",
                ))
        return self
