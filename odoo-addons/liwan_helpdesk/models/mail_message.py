# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class MailMessage(models.Model):
    _inherit = 'mail.message'

    # The Support Desk kinds, registered in models/notification_types.py.
    liwan_notification_kind = fields.Selection(selection_add=[
        ('helpdesk.assigned', 'Ticket assigned'),
        ('helpdesk.auto_closed', 'Ticket closed for inactivity'),
    ])
