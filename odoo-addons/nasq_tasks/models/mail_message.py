# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqTasksMailMessage(models.Model):
    _inherit = 'mail.message'

    # The tasks kind (registered in models/notification_types.py) and the opaque
    # id and name of the personal task a bell row points at.
    nasq_notification_kind = fields.Selection(selection_add=[('tasks.assigned', 'Task assigned')])
    nasq_tasks_task_id = fields.Integer(copy=False, index=True)
    nasq_tasks_task_name = fields.Char(copy=False)
