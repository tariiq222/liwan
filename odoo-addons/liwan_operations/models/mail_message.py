# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanOperationsMailMessage(models.Model):
    _inherit = 'mail.message'

    # The Operations kinds (registered in models/notification_types.py). A bell row points at its
    # request through ``res_id`` and keeps the request name in ``subject``.
    liwan_notification_kind = fields.Selection(selection_add=[
        ('operations.review_requested', 'Operations request needs review'),
        ('operations.approved', 'Operations request approved'),
        ('operations.rejected', 'Operations request rejected'),
        ('operations.returned', 'Operations request returned'),
    ])
