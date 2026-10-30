# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class LiwanInboxMailMessage(models.Model):
    _inherit = 'mail.message'

    # The inbox kind (registered in models/notification_types.py) and the opaque id and
    # customer name of the conversation a bell row points at.
    liwan_notification_kind = fields.Selection(selection_add=[
        ('inbox.assigned', 'Conversation assigned'), ('inbox.first_response', 'Customer waiting for a first reply'),
        ('inbox.channel_health', 'WhatsApp number health'),
    ])
    liwan_inbox_conversation_id = fields.Integer(copy=False, index=True)
    liwan_inbox_contact_name = fields.Char(copy=False)
    # The channel (id and name) a health bell row points at.
    liwan_inbox_channel_id = fields.Integer(copy=False, index=True)
    liwan_inbox_channel_name = fields.Char(copy=False)
