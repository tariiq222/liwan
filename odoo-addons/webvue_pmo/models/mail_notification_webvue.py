# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueMailMessage(models.Model):
    _inherit = 'mail.message'

    # webvue_notify owns webvue_notification, webvue_notification_kind,
    # webvue_notification_key and its unique index. webvue_pmo adds its task,
    # digest and charter kinds (registered in models/notification_types.py) and their
    # source columns.
    webvue_notification_kind = fields.Selection(selection_add=[
        ('assignment', 'Assignment'),
        ('comment', 'Comment'),
        ('mention', 'Mention'),
        ('deadline', 'Deadline'),
        ('overdue_digest', 'Overdue digest'),
        ('charter_review', 'Charter review'),
        ('charter_approved', 'Charter approved'),
        ('charter_returned', 'Charter returned'),
    ])
    webvue_task_id = fields.Many2one('project.task', string='webvue Task', index=True, copy=False, ondelete='cascade')
    webvue_project_id = fields.Many2one('project.project', string='webvue Project', index=True, copy=False, ondelete='cascade')
    webvue_digest_count = fields.Integer('webvue Digest Count', copy=False)
    webvue_digest_date = fields.Date('webvue Digest Date', copy=False)
    webvue_digest_task_ids = fields.Char('webvue Digest Task Ids', copy=False)
