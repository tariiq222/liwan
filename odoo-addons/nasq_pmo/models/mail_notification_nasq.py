# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqMailMessage(models.Model):
    _inherit = 'mail.message'

    # nasq_notify owns nasq_notification, nasq_notification_kind,
    # nasq_notification_key and its unique index. nasq_pmo adds its task,
    # digest and charter kinds (registered in models/notification_types.py) and their
    # source columns.
    nasq_notification_kind = fields.Selection(selection_add=[
        ('assignment', 'Assignment'),
        ('comment', 'Comment'),
        ('mention', 'Mention'),
        ('deadline', 'Deadline'),
        ('overdue_digest', 'Overdue digest'),
        ('charter_review', 'Charter review'),
        ('charter_approved', 'Charter approved'),
        ('charter_returned', 'Charter returned'),
    ])
    nasq_task_id = fields.Many2one('project.task', string='nasq Task', index=True, copy=False, ondelete='cascade')
    nasq_project_id = fields.Many2one('project.project', string='nasq Project', index=True, copy=False, ondelete='cascade')
    nasq_digest_count = fields.Integer('nasq Digest Count', copy=False)
    nasq_digest_date = fields.Date('nasq Digest Date', copy=False)
    nasq_digest_task_ids = fields.Char('nasq Digest Task Ids', copy=False)
