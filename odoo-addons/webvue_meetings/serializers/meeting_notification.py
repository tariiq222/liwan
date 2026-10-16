# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.webvue_api.serializers.common import iso


def dump_meeting_notification(notification):
    message = notification.mail_message_id
    meeting = message.env['cyan.meeting.minute'].browse(message.webvue_meeting_id).exists()
    return {
        'id': notification.id,
        'kind': message.webvue_notification_kind,
        'meeting_id': message.webvue_meeting_id,
        'meeting_name': meeting.name if meeting else '',
        'body': html2plaintext(message.body or '', include_references=False).strip(),
        'created_at': iso(message.date),
        'is_read': bool(notification.is_read),
    }
