# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class NasqMailMessage(models.Model):
    _inherit = 'mail.message'

    nasq_notification = fields.Boolean('nasq Notification', index=True, copy=False)
    nasq_notification_kind = fields.Selection(
        [('assignment', 'Assignment'), ('comment', 'Comment'), ('deadline', 'Deadline')],
        string='nasq Notification Kind', copy=False, index=True,
    )
    nasq_notification_key = fields.Char('nasq Notification Key', copy=False, index=True)
    nasq_task_id = fields.Many2one('project.task', string='nasq Task', index=True, copy=False, ondelete='cascade')

    _nasq_notification_key_unique = models.UniqueIndex(
        '(nasq_notification_key) WHERE nasq_notification_key IS NOT NULL',
    )
