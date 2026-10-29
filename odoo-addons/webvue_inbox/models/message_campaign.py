# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueInboxMessageCampaign(models.Model):
    _inherit = 'webvue.inbox.message'

    # Meta's code of the failure (a send error or a status webhook).
    error_code = fields.Integer()
    # Meta answered the send with held_for_quality_assessment; a sent or delivered status clears it.
    held_for_quality = fields.Boolean(default=False)
    # A template queued while the conversation's service window was closed: it counts against the messaging limit.
    business_initiated = fields.Boolean(default=False, index=True)
    campaign_recipient_ids = fields.One2many('webvue.inbox.campaign.recipient', 'message_id')
