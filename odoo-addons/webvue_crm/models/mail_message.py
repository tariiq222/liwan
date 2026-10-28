# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueCrmMailMessage(models.Model):
    _inherit = 'mail.message'

    # The CRM kinds, registered in models/notification_types.py. A bell row points at its
    # opportunity through the message's own model and res_id.
    webvue_notification_kind = fields.Selection(selection_add=[
        ('crm.assigned', 'Opportunity assigned'),
        ('crm.followup_due', 'Follow-up due'),
    ])
