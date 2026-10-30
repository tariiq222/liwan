# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tools import html2plaintext

from odoo.addons.liwan_api.serializers.common import iso

CHARTER_REVIEW_KIND = 'charter_review'
CHARTER_APPROVED_KIND = 'charter_approved'
CHARTER_RETURNED_KIND = 'charter_returned'
CHARTER_DECISION_KINDS = (CHARTER_APPROVED_KIND, CHARTER_RETURNED_KIND)
CHARTER_KINDS = (CHARTER_REVIEW_KIND, *CHARTER_DECISION_KINDS)


def dump_notification(notification, live_tasks=None):
    message = notification.mail_message_id
    if message.liwan_notification_kind == 'overdue_digest':
        if live_tasks is None:
            message_text = 'live_tasks is required for overdue digest serialization'
            raise ValueError(message_text)
        tasks = live_tasks
        local_date = message.liwan_digest_date
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
    if message.liwan_notification_kind in CHARTER_KINDS:
        project = message.liwan_project_id
        return {
            'id': notification.id,
            'kind': message.liwan_notification_kind,
            'project_id': project.id,
            'project_name': project.display_name,
            'body': html2plaintext(message.body or '', include_references=False).strip(),
            'created_at': iso(message.date),
            'is_read': bool(notification.is_read),
        }
    task = message.liwan_task_id
    return {
        'id': notification.id,
        'kind': message.liwan_notification_kind,
        'task_id': task.id,
        'task_name': task.display_name,
        'body': html2plaintext(message.body or '', include_references=False).strip(),
        'created_at': iso(message.date),
        'is_read': bool(notification.is_read),
    }
