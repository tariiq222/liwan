# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The meetings application's notification kinds in the liwan_notify registry.

Documented notification sudo: the candidate lookup reads only the current
partner's own inbox rows; whether the meeting is still readable is decided
by an ordinary search in the caller's environment.
"""
from odoo import api, models

from odoo.addons.liwan_meetings.serializers.meeting_notification import (
    dump_meeting_notification,
)

MEETING_KINDS = (
    'meeting_invite', 'meeting_series_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
)


def readable_active_meeting_ids(env):
    """Recipient-owned candidate ids, checked under the caller's meeting ACLs.

    Elevated notification reads do not grant access to the linked meeting.
    Explicit company scope also protects superusers with several companies.
    """
    Meeting = env['liwan.meeting.minute']
    if not env['liwan.access.service']._liwan_has_capability(env.user, 'meetings.read') or not Meeting.has_access('read'):
        return []
    rows = env['mail.notification'].search([
        ('res_partner_id', '=', env.user.partner_id.id),
        ('mail_message_id.liwan_notification', '=', True),
        ('mail_message_id.model', '=', 'liwan.meeting.minute'),
        ('notification_type', '=', 'inbox'),
    ])
    candidate_ids = rows.mapped('mail_message_id.liwan_meeting_id')
    if not candidate_ids:
        return []
    return Meeting.search([
        ('id', 'in', candidate_ids),
        ('company_id', '=', env.company.id),
        ('active', '=', True),
    ]).ids


class LiwanMeetingNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            *(
                {'kind': kind, 'owner': 'liwan_meetings', 'model': 'liwan.meeting.minute', 'feature_key': 'meetings.enabled'}
                for kind in MEETING_KINDS
            ),
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        meeting_ids = readable_active_meeting_ids(self.env)
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', 'in', list(MEETING_KINDS)),
                ('mail_message_id.model', '=', 'liwan.meeting.minute'),
                ('mail_message_id.res_id', 'in', meeting_ids),
                ('mail_message_id.liwan_meeting_id', 'in', meeting_ids),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        if row.mail_message_id.liwan_notification_kind in MEETING_KINDS:
            return dump_meeting_notification(row)
        return super()._liwan_notify_dump(row, extra)
