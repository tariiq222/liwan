# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class ProjectTask(models.Model):
    _inherit = 'project.task'

    # A personal task is a task without a project (Odoo's own "Private" value).
    # The record rule and the list domains filter on this column.
    nasq_personal = fields.Boolean(compute='_compute_nasq_personal', store=True, index=True)

    @api.depends('project_id')
    def _compute_nasq_personal(self):
        for task in self:
            task.nasq_personal = not task.project_id
