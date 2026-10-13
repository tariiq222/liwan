# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import ValidationError


class ProjectTask(models.Model):
    _inherit = 'project.task'

    # A personal task is a task without a project (Odoo's own "Private" value).
    # The record rule and the list domains filter on this column.
    nasq_personal = fields.Boolean(compute='_compute_nasq_personal', store=True, index=True)
    # Odoo 19 forbids ``parent_id`` on a project-less task, so a personal sub-task
    # (a checklist item, depth 1) points at its parent through these own fields.
    nasq_parent_id = fields.Many2one('project.task', string='Personal parent task',
                                     index=True, ondelete='cascade', copy=False)
    nasq_child_ids = fields.One2many('project.task', 'nasq_parent_id', string='Personal sub-tasks')

    @api.depends('project_id')
    def _compute_nasq_personal(self):
        for task in self:
            task.nasq_personal = not task.project_id

    @api.constrains('nasq_parent_id', 'project_id')
    def _check_nasq_parent(self):
        for task in self.filtered('nasq_parent_id'):
            parent = task.nasq_parent_id
            if task.project_id or parent.project_id or parent == task or parent.nasq_parent_id:
                raise ValidationError(self.env._(
                    'A personal sub-task needs a personal parent task that is not itself a sub-task.'))
