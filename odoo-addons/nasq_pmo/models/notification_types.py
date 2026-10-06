# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""nasq_pmo's notification kinds in the nasq_notify registry.

Tasks and the overdue digest belong to the project pillar. The meeting kinds
stay here until nasq_meetings exists (phase 2b-2). Keep the meeting class
second: the bell's feature gate checks keys in registration order, and with
both off it reports the last one (meetings.enabled), as it did before.
"""
from odoo import api, models

TASK_KINDS = ('assignment', 'comment', 'mention', 'deadline')
DIGEST_KIND = 'overdue_digest'
MEETING_KINDS = (
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)


class NasqPmoTaskNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'project.task', 'feature_key': 'pmo.enabled'}
                for kind in TASK_KINDS
            ),
            {'kind': DIGEST_KIND, 'owner': 'nasq_pmo', 'model': 'res.company', 'feature_key': 'pmo.enabled', 'live': True},
        )


class NasqPmoMeetingNotificationTypes(models.AbstractModel):
    _inherit = 'nasq.notify.registry'

    @api.model
    def _nasq_notification_types(self):
        return (
            *super()._nasq_notification_types(),
            *(
                {'kind': kind, 'owner': 'nasq_pmo', 'model': 'cyan.meeting.minute', 'feature_key': 'meetings.enabled'}
                for kind in MEETING_KINDS
            ),
        )
