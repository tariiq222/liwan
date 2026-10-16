# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueTasksMailMessage(models.Model):
    _inherit = 'mail.message'

    # The tasks kind (registered in models/notification_types.py) and the opaque
    # id and name of the personal task a bell row points at.
    webvue_notification_kind = fields.Selection(selection_add=[('tasks.assigned', 'Task assigned')])
    webvue_tasks_task_id = fields.Integer(copy=False, index=True)
    webvue_tasks_task_name = fields.Char(copy=False)
