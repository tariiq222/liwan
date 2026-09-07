# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.nasq_api.serializers.common import iso


def dump_notification(notification):
    message = notification.mail_message_id
    task = message.nasq_task_id
    return {
        'id': notification.id,
        'kind': message.nasq_notification_kind,
        'task_id': task.id,
        'task_name': task.display_name,
        'body': html2plaintext(message.body or '', include_references=False).strip(),
        'created_at': iso(message.date),
        'is_read': bool(notification.is_read),
    }
