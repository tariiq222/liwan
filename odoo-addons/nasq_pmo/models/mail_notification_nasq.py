# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqMailMessage(models.Model):
    _inherit = 'mail.message'

    nasq_notification = fields.Boolean('nasq Notification', index=True, copy=False)
    nasq_notification_kind = fields.Selection(
        [
            ('assignment', 'Assignment'),
            ('comment', 'Comment'),
            ('mention', 'Mention'),
            ('deadline', 'Deadline'),
            ('overdue_digest', 'Overdue digest'),
            ('meeting_invite', 'Meeting invite'),
            ('meeting_resolution', 'Meeting resolution'),
            ('meeting_converted', 'Meeting converted'),
            ('meeting_changed', 'Meeting changed'),
            ('meeting_cancelled', 'Meeting cancelled'),
            ('meeting_reminder', 'Meeting reminder'),
            ('meeting_resolution_overdue', 'Meeting resolution overdue'),
        ],
        string='nasq Notification Kind', copy=False, index=True,
    )
    nasq_meeting_id = fields.Integer(copy=False, index=True)
    nasq_notification_key = fields.Char('nasq Notification Key', copy=False, index=True)
    nasq_task_id = fields.Many2one('project.task', string='nasq Task', index=True, copy=False, ondelete='cascade')
    nasq_digest_count = fields.Integer('nasq Digest Count', copy=False)
    nasq_digest_date = fields.Date('nasq Digest Date', copy=False)
    nasq_digest_task_ids = fields.Char('nasq Digest Task Ids', copy=False)

    _nasq_notification_key_unique = models.UniqueIndex(
        '(nasq_notification_key) WHERE nasq_notification_key IS NOT NULL',
    )
