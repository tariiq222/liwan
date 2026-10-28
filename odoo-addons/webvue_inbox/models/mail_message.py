# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueInboxMailMessage(models.Model):
    _inherit = 'mail.message'

    # The inbox kind (registered in models/notification_types.py) and the opaque id and
    # customer name of the conversation a bell row points at.
    webvue_notification_kind = fields.Selection(selection_add=[('inbox.assigned', 'Conversation assigned')])
    webvue_inbox_conversation_id = fields.Integer(copy=False, index=True)
    webvue_inbox_contact_name = fields.Char(copy=False)
