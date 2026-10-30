# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import LiwanMeetingsCase

MEETING_KINDS = [
    'meeting_invite', 'meeting_series_invite', 'meeting_resolution', 'meeting_converted', 'meeting_changed',
    'meeting_cancelled', 'meeting_reminder', 'meeting_resolution_overdue',
]


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingNotificationTypes(LiwanMeetingsCase):

    def test_meetings_register_their_notification_kinds(self):
        registry = self.env['liwan.notify.registry']
        types = registry._liwan_notification_type_map()
        meetings = [kind for kind, item in types.items() if item['owner'] == 'liwan_meetings']
        self.assertEqual(meetings, MEETING_KINDS)
        self.assertEqual({types[kind]['feature_key'] for kind in meetings}, {'meetings.enabled'})
        self.assertEqual({types[kind]['model'] for kind in meetings}, {'liwan.meeting.minute'})
        self.assertIn('meetings.enabled', registry._liwan_notify_feature_keys())
        values = set(self.env['mail.message']._fields['liwan_notification_kind'].get_values(self.env))
        self.assertLessEqual(set(meetings), values)

    def test_meeting_delivery_keys_keep_their_pre_split_format(self):
        Message = self.env['mail.message'].sudo()
        other = new_test_user(self.env, login='meeting_key_nora', name='Nora', groups='liwan_core.group_employee')
        meeting = self.env['liwan.meeting.minute'].create({
            'state': 'draft', 'name': 'Key format meeting', 'organizer_id': self.manager.id,
        })
        partners = other.partner_id | self.employee.partner_id
        expected = sorted(f'meeting-invite:{meeting.id}:{partner.id}' for partner in partners)
        meeting._liwan_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        count = Message.search_count([('liwan_meeting_id', '=', meeting.id)])
        meeting._liwan_notify_partners(partners, 'meeting_invite', 'Key format', key=f'meeting-invite:{meeting.id}')
        self.assertEqual(Message.search_count([('liwan_meeting_id', '=', meeting.id)]), count)
        self.assertEqual(sorted(Message.search([('liwan_notification_key', 'in', expected)]).mapped('liwan_notification_key')), expected)
        meeting._liwan_notify_partners(other.partner_id, 'meeting_changed', 'Moved')
        meeting._liwan_notify_partners(other.partner_id, 'meeting_changed', 'Moved')
        changed = Message.search([('liwan_meeting_id', '=', meeting.id), ('liwan_notification_kind', '=', 'meeting_changed')])
        self.assertEqual(len(changed), 2, 'meeting_changed has no idempotency key')
        self.assertEqual(set(changed.mapped('liwan_notification_key')), {False})


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingBellVisibility(LiwanMeetingsCase):
    """The bell lists meeting rows without any project: only readable, active, current-company, own rows."""

    def test_meeting_rows_are_listed_only_for_a_recipient_who_can_read_the_meeting(self):
        self.employee.group_ids |= self.env.ref('liwan_meetings.group_cap_meetings_read')
        self.manager.group_ids |= self.env.ref('liwan_meetings.group_cap_meetings_read')
        Meeting = self.env['liwan.meeting.minute']
        visible = Meeting.create({'state': 'draft', 'name': 'Bell visible', 'organizer_id': self.manager.id,
                                  'attendee_ids': [(6, 0, self.employee.ids)]})
        inactive = Meeting.create({'state': 'draft', 'name': 'Bell inactive', 'organizer_id': self.manager.id,
                                   'attendee_ids': [(6, 0, self.employee.ids)]})
        company_b = self.env['res.company'].create({'name': 'Meeting bell company B'})
        self.employee.company_ids |= company_b
        self.manager.company_ids |= company_b
        foreign = Meeting.with_company(company_b).create({
            'state': 'draft', 'name': 'Bell foreign', 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)],
        })
        rows = self.env['mail.notification'].sudo().search([
            ('res_partner_id', '=', self.employee.partner_id.id),
            ('mail_message_id.model', '=', 'liwan.meeting.minute'),
        ])
        by_meeting = {row.mail_message_id.liwan_meeting_id: row for row in rows}
        self.assertEqual(set(by_meeting), {visible.id, inactive.id, foreign.id})
        inactive.write({'active': False})

        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/notifications').json()
        self.assertEqual([item['meeting_id'] for item in body['items']], [visible.id])
        self.assertEqual((body['total'], body['unread_count']), (1, 1))
        for meeting in (inactive, foreign):
            response = self.api('POST', f'/api/v1/notifications/{by_meeting[meeting.id].id}/read', {})
            self.assertEqual(response.status_code, 404, meeting.name)

        # another recipient's row is not the caller's to read
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('POST', f'/api/v1/notifications/{by_meeting[visible.id].id}/read', {})
        self.assertEqual(response.status_code, 404)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{by_meeting[visible.id].id}/read', {}).json(), {'updated': 1})
