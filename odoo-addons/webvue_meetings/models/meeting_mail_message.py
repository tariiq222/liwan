# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueMeetingMailMessage(models.Model):
    _inherit = 'mail.message'

    # The meeting kinds (registered in models/meeting_notification_types.py)
    # and the opaque id of the meeting a bell row points at.
    webvue_notification_kind = fields.Selection(selection_add=[
        ('meeting_invite', 'Meeting invite'),
        ('meeting_series_invite', 'Meeting series invite'),
        ('meeting_resolution', 'Meeting resolution'),
        ('meeting_converted', 'Meeting converted'),
        ('meeting_changed', 'Meeting changed'),
        ('meeting_cancelled', 'Meeting cancelled'),
        ('meeting_reminder', 'Meeting reminder'),
        ('meeting_resolution_overdue', 'Meeting resolution overdue'),
    ])
    webvue_meeting_id = fields.Integer(copy=False, index=True)
