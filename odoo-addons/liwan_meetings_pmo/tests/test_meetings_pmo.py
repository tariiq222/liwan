# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from odoo.addons.liwan_meetings.models.meeting_access_service import (
    MEETINGS_PERMISSIONS,
)
from odoo.addons.liwan_pmo.tests.common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingsApiProjects(LiwanPmoCase):
    """Meeting list filters by project and the bell mixing meetings and tasks (the meetings/PMO bridge)."""

    def test_meeting_project_and_date_filters_are_combined_with_correct_total(self):
        self.employee.group_ids |= self.env.ref('liwan_meetings.group_cap_meetings_read')
        target = self.env['liwan.meeting.minute'].create({
            'state': 'draft', 'name': 'Target project meeting', 'organizer_id': self.employee.id,
            'project_id': self.project.id, 'meeting_date': '2026-09-10',
        })
        self.env['liwan.meeting.minute'].create({
            'state': 'draft', 'name': 'Same project later', 'organizer_id': self.employee.id,
            'project_id': self.project.id, 'meeting_date': '2026-09-11',
        })
        self.env['liwan.meeting.minute'].create({
            'state': 'draft', 'name': 'Same date other project', 'organizer_id': self.employee.id,
            'meeting_date': '2026-09-10',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api(
            'GET',
            f'/api/v1/meetings?project_id={self.project.id}&date_from=2026-09-10&date_to=2026-09-10',
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['total'], 1)
        self.assertEqual([row['id'] for row in body['items']], [target.id])

    def test_meeting_notifications_visibility_read_states_and_recipient_ownership(self):
        self.employee.group_ids |= self.env.ref('liwan_meetings.group_cap_meetings_read')
        self.manager.group_ids |= self.env.ref('liwan_meetings.group_cap_meetings_read')
        Meeting = self.env['liwan.meeting.minute']
        visible = Meeting.create({'state': 'draft', 'name': 'Invite visible', 'organizer_id': self.manager.id,
                                  'attendee_ids': [(6, 0, self.employee.ids)]})
        second = Meeting.create({'state': 'draft', 'name': 'Invite second', 'organizer_id': self.manager.id,
                                 'attendee_ids': [(6, 0, self.employee.ids)]})
        hidden = Meeting.create({'state': 'draft', 'name': 'Hidden', 'organizer_id': self.manager.id})
        hidden._liwan_notify_partners(self.employee.partner_id, 'meeting_invite', 'Hidden')
        company_b = self.env['res.company'].create({'name': 'Meeting company B'})
        self.employee.company_ids |= company_b
        self.manager.company_ids |= company_b
        foreign = Meeting.with_company(company_b).create({
            'state': 'draft', 'name': 'Foreign', 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)],
        })
        rows = self.env['mail.notification'].sudo().search([
            ('res_partner_id', '=', self.employee.partner_id.id),
            ('mail_message_id.model', '=', 'liwan.meeting.minute'),
        ])
        by_meeting = {row.mail_message_id.liwan_meeting_id: row for row in rows}
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/notifications').json()
        meeting_items = [item for item in body['items'] if item.get('meeting_id')]
        assignment_items = [item for item in body['items'] if item.get('task_id')]
        self.assertEqual({item['meeting_id'] for item in meeting_items}, {visible.id, second.id})
        # The shared fixture project is now current-company, so the employee's
        # two assigned fixture tasks also notify. Meetings stay exactly two.
        self.assertEqual(len(assignment_items), 2)
        self.assertEqual((body['total'], body['unread_count']), (4, 4))
        row_id = by_meeting[visible.id].id
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).json(), {'updated': 1})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).json(), {'updated': 0})
        read = self.api('GET', '/api/v1/notifications?unread=false').json()
        self.assertEqual((read['total'], read['unread_count']), (1, 3))
        self.assertEqual([item['meeting_id'] for item in read['items']], [visible.id])
        for meeting in (hidden, foreign):
            self.assertEqual(self.api('POST', f'/api/v1/notifications/{by_meeting[meeting.id].id}/read', {}).status_code, 404)
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 3})
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 0})
        for meeting in (hidden, foreign):
            by_meeting[meeting.id].invalidate_recordset(['is_read'])
            self.assertFalse(by_meeting[meeting.id].is_read)
        visible.write({'attendee_ids': [(6, 0, [])]})
        second.write({'active': False})
        remaining = self.api('GET', '/api/v1/notifications').json()
        self.assertEqual((remaining['total'], remaining['unread_count']), (2, 0))
        self.assertFalse([item for item in remaining['items'] if item.get('meeting_id')])
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).status_code, 404)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).status_code, 404)

    def test_the_pmo_manager_role_holds_no_meeting_permission_after_the_repair(self):
        role = self.env.ref('liwan_pmo.role_pmo_manager')
        self.assertTrue(self.env['liwan.access.service']._liwan_repair_builtin_role_grants())
        self.assertFalse(set(role.permission_ids.mapped('key')) & MEETINGS_PERMISSIONS)
