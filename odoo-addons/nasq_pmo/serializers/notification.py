# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.nasq_api.serializers.common import iso


def dump_notification(notification, live_tasks=None):
    message = notification.mail_message_id
    if message.nasq_notification_kind == 'overdue_digest':
        if live_tasks is None:
            message_text = 'live_tasks is required for overdue digest serialization'
            raise ValueError(message_text)
        tasks = live_tasks
        local_date = message.nasq_digest_date
        count = len(tasks)
        return {
            'id': notification.id,
            'kind': 'overdue_digest',
            'digest_id': notification.id,
            'overdue_count': count,
            'local_date': local_date.isoformat() if local_date else None,
            'body': f'{count} overdue tasks',
            'created_at': iso(message.date),
            'is_read': bool(notification.is_read),
        }
    if message.nasq_notification_kind in {
        'meeting_invite', 'meeting_resolution', 'meeting_converted',
        'meeting_changed', 'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
    }:
        meeting = message.env['cyan.meeting.minute'].browse(message.nasq_meeting_id).exists()
        return {
            'id': notification.id,
            'kind': message.nasq_notification_kind,
            'meeting_id': message.nasq_meeting_id,
            'meeting_name': meeting.name if meeting else '',
            'body': html2plaintext(message.body or '', include_references=False).strip(),
            'created_at': iso(message.date),
            'is_read': bool(notification.is_read),
        }
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
