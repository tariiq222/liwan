# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The tasks application's notification kind in the nasq_notify registry.

No sudo here (spec section 7): the readable ids come from an ordinary task search in the
caller's environment, and nasq_notify has already restricted the rows to the caller's inbox.
A row shows only while its task is still a readable personal task assigned to the caller.
"""
from odoo import api, models

from odoo.addons.nasq_api.serializers.common import iso

KIND = 'tasks.assigned'


def readable_assigned_tasks(env):
    """Subquery of the readable, active personal tasks of this company assigned to the caller.

    Returned as a ``Query`` so the bell poll never builds an id list; ``None`` when the
    caller may not read tasks.
    """
    Task = env['project.task']
    if not env['nasq.access.service']._nasq_has_capability(env.user, 'tasks.tasks.read') or not Task.has_access('read'):
        return None
    return Task._search([
        ('nasq_personal', '=', True),
        ('active', '=', True),
        ('company_id', '=', env.company.id),
        ('user_ids', 'in', [env.uid]),
    ])


class NasqTasksNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            {'kind': KIND, 'owner': 'nasq_tasks', 'model': 'project.task', 'feature_key': 'tasks.enabled'},
        )

    @api.model
    def _nasq_notify_visible_domain(self):
        tasks = readable_assigned_tasks(self.env)
        task_ids = tasks if tasks is not None else []
        return [
            *super()._nasq_notify_visible_domain(),
            [
                ('mail_message_id.nasq_notification_kind', '=', KIND),
                ('mail_message_id.model', '=', 'project.task'),
                ('mail_message_id.res_id', 'in', task_ids),
                ('mail_message_id.nasq_tasks_task_id', 'in', task_ids),
            ],
        ]

    @api.model
    def _nasq_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.nasq_notification_kind == KIND:
            return {
                'id': row.id,
                'kind': KIND,
                'task_id': message.nasq_tasks_task_id,
                'title': message.nasq_tasks_task_name or '',
                'task_name': message.nasq_tasks_task_name or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
        return super()._nasq_notify_dump(row, extra)
