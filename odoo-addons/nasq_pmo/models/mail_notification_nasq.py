# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqMailMessage(models.Model):
    _inherit = 'mail.message'

    nasq_notification = fields.Boolean('nasq Notification', index=True, copy=False)
    nasq_notification_kind = fields.Selection(
        [
            ('assignment', 'Assignment'),
            ('comment', 'Comment'),
            ('deadline', 'Deadline'),
            ('overdue_digest', 'Overdue digest'),
        ],
        string='nasq Notification Kind', copy=False, index=True,
    )
    nasq_notification_key = fields.Char('nasq Notification Key', copy=False, index=True)
    nasq_task_id = fields.Many2one('project.task', string='nasq Task', index=True, copy=False, ondelete='cascade')
    nasq_digest_count = fields.Integer('nasq Digest Count', copy=False)
    nasq_digest_date = fields.Date('nasq Digest Date', copy=False)
    nasq_digest_task_ids = fields.Char('nasq Digest Task Ids', copy=False)

    _nasq_notification_key_unique = models.UniqueIndex(
        '(nasq_notification_key) WHERE nasq_notification_key IS NOT NULL',
    )
