# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingsApi(NasqPmoCase):

    def test_employee_lists_participant_meetings_only(self):
        user_group = self.env.ref('nasq_core.group_cap_meetings_read')
        self.employee.group_ids |= user_group
        self.manager.group_ids |= user_group
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Ops Review',
            'organizer_id': self.employee.id,
            'meeting_date': fields.Date.today(),
            'attendee_ids': [(6, 0, [self.employee.id])],
        })
        hidden = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Secret Board',
            'organizer_id': self.manager.id,
            'meeting_date': fields.Date.today(),
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/meetings').json()
        self.assertEqual(set(body), {'items', 'total'})
        ids = [row['id'] for row in body['items']]
        self.assertIn(meeting.id, ids)
        self.assertNotIn(hidden.id, ids)
        detail = self.api('GET', f'/api/v1/meetings/{meeting.id}').json()
        self.assertEqual(detail['name'], 'Ops Review')
        self.assertEqual(detail['organizer']['id'], self.employee.id)
        hidden_res = self.api('GET', f'/api/v1/meetings/{hidden.id}')
        self.assertEqual(hidden_res.status_code, 403)
        self.assertEqual(hidden_res.json()['code'], 'forbidden')

    def test_manage_group_reads_company_meetings_and_outsider_cannot(self):
        # Nasq-dependent coverage recovered from the Cyan source conflict.
        office = new_test_user(
            self.env, login='nasq_office_mgr',
            groups='nasq_core.group_cap_meetings_manage',
            company_id=self.env.company.id, company_ids=self.env.company.ids,
        )
        self.env['nasq.access.assignment'].create({'user_id': office.id, 'role_id': self.env.ref('nasq_core.role_system_admin').id, 'company_id': self.env.company.id})
        self.employee.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read')
        self.manager.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read')
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Office meeting', 'organizer_id': self.manager.id,
        })
        self.assertIn(meeting, meeting.with_user(office).search([('id', '=', meeting.id)]))
        self.assertFalse(meeting.with_user(self.employee).search([('id', '=', meeting.id)]))
        self.assertIn(meeting, meeting.with_user(self.manager).search([('id', '=', meeting.id)]))

    def test_meeting_notifications_visibility_read_states_and_recipient_ownership(self):
        self.employee.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read')
        self.manager.group_ids |= self.env.ref('nasq_core.group_cap_meetings_read')
        Meeting = self.env['cyan.meeting.minute']
        visible = Meeting.create({'state': 'draft', 'name': 'Invite visible', 'organizer_id': self.manager.id,
                                  'attendee_ids': [(6, 0, self.employee.ids)]})
        second = Meeting.create({'state': 'draft', 'name': 'Invite second', 'organizer_id': self.manager.id,
                                 'attendee_ids': [(6, 0, self.employee.ids)]})
        hidden = Meeting.create({'state': 'draft', 'name': 'Hidden', 'organizer_id': self.manager.id})
        hidden._nasq_notify_partners(self.employee.partner_id, 'meeting_invite', 'Hidden')
        company_b = self.env['res.company'].create({'name': 'Meeting company B'})
        self.employee.company_ids |= company_b
        self.manager.company_ids |= company_b
        foreign = Meeting.with_company(company_b).create({
            'state': 'draft', 'name': 'Foreign', 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)],
        })
        rows = self.env['mail.notification'].sudo().search([
            ('res_partner_id', '=', self.employee.partner_id.id),
            ('mail_message_id.model', '=', 'cyan.meeting.minute'),
        ])
        by_meeting = {row.mail_message_id.nasq_meeting_id: row for row in rows}
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/notifications').json()
        self.assertEqual({item['meeting_id'] for item in body['items']}, {visible.id, second.id})
        self.assertEqual((body['total'], body['unread_count']), (2, 2))
        row_id = by_meeting[visible.id].id
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).json(), {'updated': 1})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).json(), {'updated': 0})
        read = self.api('GET', '/api/v1/notifications?unread=false').json()
        self.assertEqual((read['total'], read['unread_count']), (1, 1))
        for meeting in (hidden, foreign):
            self.assertEqual(self.api('POST', f'/api/v1/notifications/{by_meeting[meeting.id].id}/read', {}).status_code, 404)
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 1})
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 0})
        for meeting in (hidden, foreign):
            by_meeting[meeting.id].invalidate_recordset(['is_read'])
            self.assertFalse(by_meeting[meeting.id].is_read)
        visible.write({'attendee_ids': [(6, 0, [])]})
        second.write({'active': False})
        self.assertEqual(self.api('GET', '/api/v1/notifications').json(), {'items': [], 'total': 0, 'unread_count': 0})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).status_code, 404)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row_id}/read', {}).status_code, 404)

    def test_meetings_only_role_can_open_detail_without_task_access(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'قراءة الاجتماعات فقط', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env.ref('nasq_core.permission_meetings_read').ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'role_id': role.id, 'company_id': self.env.company.id,
        })
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Meetings only', 'organizer_id': self.employee.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['id'], meeting.id)
        body = self.api('GET', '/api/v1/notifications').json()
        self.assertEqual(body['total'], 1)
        row = body['items'][0]
        self.assertEqual(row['meeting_id'], meeting.id)
        self.assertEqual(self.api('POST', f"/api/v1/notifications/{row['id']}/read", {}).json(), {'updated': 1})
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 0})

    def test_foreign_manager_grant_cannot_expose_b_meeting_or_notification(self):
        company_a = self.env.company
        company_b = self.env['res.company'].create({'name': 'HTTP meetings B'})
        self.employee.company_ids |= company_b
        self.manager.company_ids |= company_b
        for company, keys in [(company_a, ['meetings.read', 'meetings.manage']), (company_b, ['meetings.read'])]:
            role = self.env['nasq.access.role'].with_company(company).create({'name_ar': 'نطاق الاجتماعات', 'company_id': company.id,
                'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([('key', 'in', keys)]).ids)]})
            self.env['nasq.access.assignment'].create({'user_id': self.employee.id, 'role_id': role.id, 'company_id': company.id})
        self.employee.sudo().write({'company_id': company_b.id})
        meeting = self.env['cyan.meeting.minute'].with_company(company_b).create({
            'name': 'Confidential B', 'organizer_id': self.manager.id, 'state': 'draft'})
        meeting._nasq_notify_partners(self.employee.partner_id, 'meeting_invite', 'Private notice')
        row = self.env['mail.notification'].sudo().search([
            ('res_partner_id', '=', self.employee.partner_id.id), ('mail_message_id.nasq_meeting_id', '=', meeting.id)], limit=1)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/meetings').json(), {'items': [], 'total': 0})
        for endpoint in [f'/api/v1/meetings/{meeting.id}', f'/api/v1/meetings/{meeting.id}/attachments']:
            response = self.api('GET', endpoint)
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()['code'], 'forbidden')
        self.assertEqual(self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'name': 'Illicit'}).status_code, 403)
        self.assertEqual(self.api('GET', '/api/v1/notifications').json(), {'items': [], 'total': 0, 'unread_count': 0})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row.id}/read', {}).status_code, 404)
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 0})
