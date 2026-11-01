# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanHrMailMessage(models.Model):
    _inherit = 'mail.message'

    # The HR kinds (registered in models/notification_types.py). A bell row points at its
    # leave request through ``res_id`` and keeps the leave dates in ``subject``; an onboarding step row points
    # at its plan run and keeps the step summary in ``subject``; a warning row points at its warning and keeps
    # the warning type's name in ``subject`` (never the reason).
    liwan_notification_kind = fields.Selection(selection_add=[
        ('hr.leave_approved', 'Leave request approved'),
        ('hr.leave_refused', 'Leave request refused'),
        ('hr.onboarding_step', 'Onboarding step assigned'),
        ('hr.warning_issued', 'Warning issued'),
        ('hr.insurance_plan_expiring', 'Insurance plan about to expire'),
    ])
