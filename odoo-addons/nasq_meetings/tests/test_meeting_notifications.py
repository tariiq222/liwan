# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqMeetingsCase

MEETING_KINDS = [
    'meeting_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
]


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingNotificationTypes(NasqMeetingsCase):

    def test_meetings_register_their_notification_kinds(self):
        registry = self.env['nasq.notify.registry']
        types = registry._nasq_notification_type_map()
        meetings = [kind for kind, item in types.items() if item['owner'] == 'nasq_meetings']
        self.assertEqual(meetings, MEETING_KINDS)
        self.assertEqual({types[kind]['feature_key'] for kind in meetings}, {'meetings.enabled'})
        self.assertEqual({types[kind]['model'] for kind in meetings}, {'cyan.meeting.minute'})
        self.assertIn('meetings.enabled', registry._nasq_notify_feature_keys())
        values = set(self.env['mail.message']._fields['nasq_notification_kind'].get_values(self.env))
        self.assertLessEqual(set(meetings), values)

    def test_meeting_delivery_keys_keep_their_pre_split_format(self):
        Message = self.env['mail.message'].sudo()
        other = new_test_user(self.env, login='meeting_key_nora', name='Nora', groups='nasq_core.group_employee')
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Key format meeting', 'organizer_id': self.manager.id,
        })
        partners = other.partner_id | self.employee.partner_id
        expected = sorted(f'meeting-invite:{meeting.id}:{partner.id}' for partner in partners)
        meeting._nasq_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        count = Message.search_count([('nasq_meeting_id', '=', meeting.id)])
        meeting._nasq_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        self.assertEqual(Message.search_count([('nasq_meeting_id', '=', meeting.id)]), count)
        self.assertEqual(sorted(Message.search([('nasq_notification_key', 'in', expected)]).mapped('nasq_notification_key')), expected)
        meeting._nasq_notify_partners(other.partner_id, 'meeting_changed', 'Moved')
        meeting._nasq_notify_partners(other.partner_id, 'meeting_changed', 'Moved')
        changed = Message.search([('nasq_meeting_id', '=', meeting.id), ('nasq_notification_kind', '=', 'meeting_changed')])
        self.assertEqual(len(changed), 2, 'meeting_changed has no idempotency key')
        self.assertEqual(set(changed.mapped('nasq_notification_key')), {False})
