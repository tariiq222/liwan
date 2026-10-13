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
    # bypass_search_access: the personal-task rules follow this field to the parent's creator and
    # assignees; without it that path would apply the same rules to the parent again, without end.
    # Cost, accepted: an ORM caller can probe a parent through a domain such as
    # ``nasq_parent_id.name`` on the sub-tasks it may read, so the creator and assignees of a
    # sub-task can learn facts about its parent's columns. They are people the parent's
    # participants chose to work with, no route exposes such a domain, and the parent's own
    # record rules still guard reading the parent.
    nasq_parent_id = fields.Many2one('project.task', string='Personal parent task',
                                     index=True, ondelete='cascade', copy=False,
                                     bypass_search_access=True)
    nasq_child_ids = fields.One2many('project.task', 'nasq_parent_id', string='Personal sub-tasks')

    @api.depends('project_id')
    def _compute_nasq_personal(self):
        for task in self:
            task.nasq_personal = not task.project_id

    @api.constrains('nasq_parent_id', 'project_id', 'company_id')
    def _check_nasq_parent(self):
        for task in self.filtered('nasq_parent_id'):
            parent = task.nasq_parent_id
            # A parent loaded earlier in the transaction may have gained a project since (a
            # convert in another request): read the project fresh.
            parent.invalidate_recordset(['project_id'])
            if (
                task.project_id or parent.project_id or parent == task or parent.nasq_parent_id
                or task.nasq_child_ids or parent.company_id != task.company_id
            ):
                raise ValidationError(self.env._(
                    'A personal sub-task needs a personal parent task of its own company, and neither side may have a further level.'))
