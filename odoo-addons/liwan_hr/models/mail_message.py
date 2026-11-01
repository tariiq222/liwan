# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanHrMailMessage(models.Model):
    _inherit = 'mail.message'

    # The HR kinds (registered in models/notification_types.py). A bell row points at its
    # leave request through ``res_id`` and keeps the leave dates in ``subject``; an onboarding step row points
    # at its plan run and keeps the step summary in ``subject``.
    liwan_notification_kind = fields.Selection(selection_add=[
        ('hr.leave_approved', 'Leave request approved'),
        ('hr.leave_refused', 'Leave request refused'),
        ('hr.onboarding_step', 'Onboarding step assigned'),
    ])
