# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError


def _validate_deliverables(value, env=None):
    # `env._()` is called directly: babel only extracts `_` and `_lt`, so a local
    # alias would keep these messages out of every .pot forever.
    if value in (None, False):
        return []
    if not isinstance(value, list):
        raise ValidationError(env._("Milestone deliverables must be a list."))
    normalized = []
    for row in value:
        if not isinstance(row, dict) or set(row) != {'name', 'done'}:
            raise ValidationError(env._("Milestone deliverables must contain exactly name and done."))
        name = row['name']
        if not isinstance(name, str) or not name.strip():
            raise ValidationError(env._("Milestone deliverable names must not be empty."))
        if not isinstance(row['done'], bool):
            raise ValidationError(env._("Milestone deliverable done must be a boolean."))
        normalized.append({'name': name.strip(), 'done': row['done']})
    return normalized


class ProjectMilestone(models.Model):
    _name = 'project.milestone'
    _inherit = ['project.milestone', 'liwan.project.child.visibility']
    _liwan_tool_key = 'planning'

    def _liwan_check_visible(self):
        for milestone in self:
            milestone.project_id._liwan_check_tool('planning')
        return self

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not self.env.su:
                project = self.env['project.project'].browse(vals.get('project_id')).exists()
                project._liwan_check_tool_write('planning')
                project._liwan_check_manage()
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.su:
            self._liwan_check_manage()
            if 'project_id' in vals:
                project = self.env['project.project'].browse(vals['project_id']).exists()
                project._liwan_check_tool_write('planning')
                project._liwan_check_manage()
        return super().write(vals)

    def unlink(self):
        if not self.env.su:
            self._liwan_check_manage()
        return super().unlink()

    liwan_start_date = fields.Date(copy=False, index=True)
    liwan_deliverables = fields.Json(default=lambda self: [], copy=True)

    @api.constrains('liwan_start_date', 'deadline', 'project_id')
    def _check_liwan_schedule(self):
        for milestone in self:
            milestone._liwan_validate_schedule_bounds()

    @api.constrains('liwan_deliverables')
    def _check_liwan_deliverables(self):
        for milestone in self:
            _validate_deliverables(milestone.liwan_deliverables, self.env)

    def _liwan_validate_schedule_bounds(self):
        """Validate this milestone and all linked task date bounds.

        The task query deliberately runs with archived records enabled and in a
        scalar-only sudo context. Hidden task content never leaves this method;
        it is needed so a parent date cannot shrink around an inaccessible task.
        """
        for milestone in self:
            _validate_deliverables(milestone.liwan_deliverables, self.env)
            start = fields.Date.to_date(milestone.liwan_start_date) if milestone.liwan_start_date else False
            deadline = fields.Date.to_date(milestone.deadline) if milestone.deadline else False
            project = milestone.project_id
            if project and not project._liwan_tool_enabled('planning'):
                continue
            if start and deadline and start > deadline:
                raise ValidationError(self.env._("Milestone start date must be on or before its deadline."))
            if project:
                project_start = fields.Date.to_date(project.date_start) if project.date_start else False
                project_end = fields.Date.to_date(project.date) if project.date else False
                if project_start and start and start < project_start:
                    raise ValidationError(self.env._("Milestone start date must be on or after the project start date."))
                if project_start and deadline and deadline < project_start:
                    raise ValidationError(self.env._("Milestone deadline must be on or after the project start date."))
                if project_end and start and start > project_end:
                    raise ValidationError(self.env._("Milestone start date must be on or before the project end date."))
                if project_end and deadline and deadline > project_end:
                    raise ValidationError(self.env._("Milestone deadline must be on or before the project end date."))

            tasks = self.env['project.task'].with_context(active_test=False).search([
                ('milestone_id', '=', milestone.id),
            ])
            for task in tasks:
                if task.project_id != project:
                    raise ValidationError(self.env._("Milestone and task must belong to the same project."))
                task_start = fields.Date.to_date(task.liwan_planned_start) if task.liwan_planned_start else False
                task_end = fields.Date.to_date(task.date_deadline) if task.date_deadline else False
                if start and task_start and task_start < start:
                    raise ValidationError(self.env._("Task planned start must be on or after the milestone start date."))
                if start and task_end and task_end < start:
                    raise ValidationError(self.env._("Task deadline must be on or after the milestone start date."))
                if deadline and task_start and task_start > deadline:
                    raise ValidationError(self.env._("Task planned start must be on or before the milestone deadline."))
                if deadline and task_end and task_end > deadline:
                    raise ValidationError(self.env._("Task deadline must be on or before the milestone deadline."))
        return self

    def _liwan_validate_task_bounds(self, task):
        """Validate one changed task without rescanning sibling task records."""
        self.ensure_one()
        if not self.project_id._liwan_tool_enabled('planning'):
            return task
        _validate_deliverables(self.liwan_deliverables, self.env)
        start = fields.Date.to_date(self.liwan_start_date) if self.liwan_start_date else False
        deadline = fields.Date.to_date(self.deadline) if self.deadline else False
        if task.project_id != self.project_id:
            raise ValidationError(self.env._("Milestone and task must belong to the same project."))
        task_start = fields.Date.to_date(task.liwan_planned_start) if task.liwan_planned_start else False
        task_end = fields.Date.to_date(task.date_deadline) if task.date_deadline else False
        if start and task_start and task_start < start:
            raise ValidationError(self.env._("Task planned start must be on or after the milestone start date."))
        if start and task_end and task_end < start:
            raise ValidationError(self.env._("Task deadline must be on or after the milestone start date."))
        if deadline and task_start and task_start > deadline:
            raise ValidationError(self.env._("Task planned start must be on or before the milestone deadline."))
        if deadline and task_end and task_end > deadline:
            raise ValidationError(self.env._("Task deadline must be on or before the milestone deadline."))
        return task
