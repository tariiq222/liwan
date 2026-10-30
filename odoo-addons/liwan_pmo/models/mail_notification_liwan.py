# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanMailMessage(models.Model):
    _inherit = 'mail.message'

    # liwan_notify owns liwan_notification, liwan_notification_kind,
    # liwan_notification_key and its unique index. liwan_pmo adds its task,
    # digest and charter kinds (registered in models/notification_types.py) and their
    # source columns.
    liwan_notification_kind = fields.Selection(selection_add=[
        ('assignment', 'Assignment'),
        ('comment', 'Comment'),
        ('mention', 'Mention'),
        ('deadline', 'Deadline'),
        ('overdue_digest', 'Overdue digest'),
        ('charter_review', 'Charter review'),
        ('charter_approved', 'Charter approved'),
        ('charter_returned', 'Charter returned'),
    ])
    liwan_task_id = fields.Many2one('project.task', string='liwan Task', index=True, copy=False, ondelete='cascade')
    liwan_project_id = fields.Many2one('project.project', string='liwan Project', index=True, copy=False, ondelete='cascade')
    liwan_digest_count = fields.Integer('liwan Digest Count', copy=False)
    liwan_digest_date = fields.Date('liwan Digest Date', copy=False)
    liwan_digest_task_ids = fields.Char('liwan Digest Task Ids', copy=False)
