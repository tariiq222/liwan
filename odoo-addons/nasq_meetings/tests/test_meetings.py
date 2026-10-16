# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from unittest.mock import patch

from odoo import fields
from odoo.exceptions import UserError
from odoo.tests import new_test_user, tagged

from .common import NasqMeetingsCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingsApi(NasqMeetingsCase):

    def _grant_meeting_create(self):
        self.employee.group_ids |= (
            self.env.ref('nasq_meetings.group_cap_meetings_read')
            | self.env.ref('nasq_meetings.group_cap_meetings_create')
        )
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات للاختبار', 'key': 'meeting_http_create_tests',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })

    def test_patch_explicitly_clears_start_and_end(self):
        self._grant_meeting_create()
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Clear schedule', 'state': 'draft', 'organizer_id': self.employee.id,
            'meeting_date': '2026-09-08',
            'start_datetime': '2026-09-08 09:00:00',
            'end_datetime': '2026-09-08 10:00:00',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {
            'start_datetime': None, 'end_datetime': None,
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIsNone(body['start_datetime'])
        self.assertIsNone(body['end_datetime'])
        meeting.invalidate_recordset()
        self.assertFalse(meeting.start_datetime)
        self.assertFalse(meeting.end_datetime)

    def test_meeting_attachment_upload_uses_the_shared_validator(self):
        self._grant_meeting_create()
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Attachment meeting', 'organizer_id': self.employee.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        url = f'/api/v1/meetings/{meeting.id}/attachments'
        created = self.api('POST', url, {
            'name': 'notes.txt', 'mimetype': 'text/plain',
            'data': base64.b64encode(b'meeting notes').decode(),
        })
        self.assertEqual(created.status_code, 201, created.text)
        item = created.json()
        self.assertEqual(set(item), {'id', 'name', 'mimetype', 'url'})
        self.assertEqual((item['name'], item['mimetype']), ('notes.txt', 'text/plain'))
        self.assertEqual(self.api('GET', url).json(), {'items': [item], 'total': 1})
        rejected = self.api('POST', url, {'name': 'x.gif', 'data': base64.b64encode(b'GIF89a' + bytes(10)).decode()})
        self.assertEqual(rejected.status_code, 422)
        self.assertEqual(rejected.json()['field'], 'data')

    def test_patch_title_only_normalizes_existing_odoo_datetimes(self):
        self._grant_meeting_create()
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Existing schedule', 'state': 'draft', 'organizer_id': self.employee.id,
            'meeting_date': '2026-09-08',
            'start_datetime': '2026-09-08 09:00:00',
            'end_datetime': '2026-09-08 10:00:00',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'name': 'Renamed schedule'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['name'], 'Renamed schedule')
        self.assertEqual(response.json()['start_datetime'], '2026-09-08T09:00:00Z')

    def test_patch_clear_clocks_allows_an_explicit_new_calendar_day(self):
        self._grant_meeting_create()
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Move date', 'state': 'draft', 'organizer_id': self.employee.id,
            'meeting_date': '2026-09-08',
            'start_datetime': '2026-09-08 09:00:00',
            'end_datetime': '2026-09-08 10:00:00',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {
            'meeting_date': '2026-09-10', 'start_datetime': None, 'end_datetime': None,
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['meeting_date'], '2026-09-10')
        self.assertIsNone(body['start_datetime'])
        self.assertIsNone(body['end_datetime'])

    def test_create_derives_user_calendar_day_and_rejects_conflicting_day(self):
        self._grant_meeting_create()
        self.employee.tz = 'Asia/Riyadh'
        self.authenticate('api_emp', 'api_emp_pass_123')
        created = self.api('POST', '/api/v1/meetings', {
            'name': 'Timezone day',
            'start_datetime': '2026-09-08T23:30:00+03:00',
            'end_datetime': '2026-09-09T00:30:00+03:00',
        })
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()['meeting_date'], '2026-09-08')
        conflicting = self.api('POST', '/api/v1/meetings', {
            'name': 'Conflicting day', 'meeting_date': '2026-09-09',
            'start_datetime': '2026-09-08T23:30:00+03:00',
            'end_datetime': '2026-09-09T00:30:00+03:00',
        })
        self.assertEqual(conflicting.status_code, 422, conflicting.text)
        self.assertEqual(conflicting.json()['field'], 'meeting_date')

    def test_create_rejects_invalid_range_and_patch_rejects_invalid_url(self):
        self._grant_meeting_create()
        self.authenticate('api_emp', 'api_emp_pass_123')
        invalid_range = self.api('POST', '/api/v1/meetings', {
            'name': 'Bad range', 'start_datetime': '2026-09-08T10:00:00Z',
            'end_datetime': '2026-09-08T10:00:00Z',
        })
        self.assertEqual(invalid_range.status_code, 422, invalid_range.text)
        self.assertEqual(invalid_range.json()['field'], 'end_datetime')
        meeting = self.env['cyan.meeting.minute'].with_user(self.employee).create({
            'name': 'URL validation', 'meeting_date': '2026-09-08',
        })
        invalid_url = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {
            'meeting_url': 'not a url',
        })
        self.assertEqual(invalid_url.status_code, 422, invalid_url.text)
        self.assertEqual(invalid_url.json()['field'], 'meeting_url')

    def test_patch_cannot_attach_meeting_to_unmanaged_series(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'تعديل اجتماعاتي', 'key': 'meeting_patch_create_only',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Patch target', 'recurrence': 'none', 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)],
        })
        meeting = self.env['cyan.meeting.minute'].with_user(self.employee).create({
            'name': 'Own standalone', 'organizer_id': self.employee.id,
            'meeting_date': fields.Date.today(),
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'series_id': series.id})
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'forbidden')

    def test_create_from_series_honors_explicit_null_and_empty_defaults(self):
        self.employee.group_ids |= (
            self.env.ref('nasq_meetings.group_cap_meetings_read')
            | self.env.ref('nasq_meetings.group_cap_meetings_create')
        )
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إنشاء اجتماع افتراضي', 'key': 'meeting_create_defaults',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.employee.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Defaults', 'recurrence': 'none', 'organizer_id': self.employee.id,
            'secretary_id': self.manager.id, 'location': 'Inherited room',
            'meeting_url': 'https://example.test/inherited',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', '/api/v1/meetings', {
            'name': 'Clear inherited values', 'series_id': series.id,
            'secretary_id': None, 'location': '', 'meeting_url': '',
        })
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertIsNone(body['secretary'])
        self.assertEqual(body['location'], '')
        self.assertEqual(body['meeting_url'], '')

    def test_minutes_pdf_requires_access_and_returns_pdf_response(self):
        self.employee.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read')
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'PDF minutes', 'organizer_id': self.employee.id,
            'meeting_date': fields.Date.today(),
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        report_model = self.env['ir.actions.report']
        with patch.object(type(report_model), '_render_qweb_pdf', return_value=(b'%PDF-test', 'pdf')):
            response = self.url_open(f'/api/v1/meetings/{meeting.id}/minutes.pdf', method='GET')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['Content-Type'], 'application/pdf')
        self.assertIn('attachment;', response.headers['Content-Disposition'])
        self.assertEqual(response.content, b'%PDF-test')
        hidden = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Hidden PDF', 'organizer_id': self.manager.id,
            'meeting_date': fields.Date.today(),
        })
        denied = self.url_open(f'/api/v1/meetings/{hidden.id}/minutes.pdf', method='GET')
        self.assertEqual(denied.status_code, 403)
        self.assertNotEqual(denied.headers.get('Content-Type'), 'application/pdf')

    def test_http_patch_and_cancel_scopes_apply_and_follow_lifecycle(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إدارة دورة الاجتماع', 'key': 'meeting_scope_lifecycle',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.manage']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.manager.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'HTTP lifecycle', 'recurrence': 'none', 'organizer_id': self.manager.id,
        })
        first = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-08 09:00:00'),
            fields.Datetime.to_datetime('2026-09-08 10:00:00'), 'First',
        )
        second = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-15 09:00:00'),
            fields.Datetime.to_datetime('2026-09-15 10:00:00'), 'Second',
        )
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        patched = self.api('PATCH', f'/api/v1/meetings/{first.id}', {
            'start_datetime': '2026-09-08T11:00:00.000Z',
            'end_datetime': '2026-09-08T12:00:00.000Z', 'scope': 'this_and_following',
        })
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual(patched.json()['start_datetime'], '2026-09-08T11:00:00Z')
        cleared = self.api('PATCH', f'/api/v1/meetings/{first.id}', {
            'start_datetime': None, 'end_datetime': None, 'scope': 'this_and_following',
        })
        self.assertEqual(cleared.status_code, 200, cleared.text)
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertFalse(first.start_datetime)
        self.assertFalse(first.end_datetime)
        self.assertFalse(second.start_datetime)
        self.assertFalse(second.end_datetime)
        cancelled = self.api('POST', f'/api/v1/meetings/{first.id}/cancel', {
            'scope': 'this_and_following',
        })
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertEqual((first.state, second.state), ('cancelled', 'cancelled'))
        self.assertEqual(self.api('POST', f'/api/v1/meetings/{first.id}/cancel', {}).status_code, 200)

    def test_http_scope_preserves_shift_when_end_is_cleared(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'تعديل الموعد مع المسح', 'key': 'meeting_scope_mixed_clear',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.manage']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.manager.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Mixed schedule', 'recurrence': 'none', 'organizer_id': self.manager.id,
        })
        first = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-08 09:00:00'),
            fields.Datetime.to_datetime('2026-09-08 10:00:00'), 'First',
        )
        second = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-15 09:00:00'),
            fields.Datetime.to_datetime('2026-09-15 10:00:00'), 'Second',
        )
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{first.id}', {
            'start_datetime': '2026-09-08T11:00:00.000Z',
            'end_datetime': None, 'scope': 'this_and_following',
        })
        self.assertEqual(response.status_code, 200, response.text)
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertEqual((first.start_datetime, second.start_datetime), (
            fields.Datetime.to_datetime('2026-09-08 11:00:00'),
            fields.Datetime.to_datetime('2026-09-15 11:00:00'),
        ))
        self.assertFalse(first.end_datetime)
        self.assertFalse(second.end_datetime)

    def test_http_scope_anchors_clocks_to_each_following_date_only_occurrence(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إضافة الوقت للاجتماعات المؤرخة', 'key': 'meeting_scope_date_only_clocks',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.manage']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.manager.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Date-only schedule', 'recurrence': 'none', 'organizer_id': self.manager.id,
        })
        first = self.env['cyan.meeting.minute'].create({
            'name': 'First date-only', 'state': 'draft', 'series_id': series.id, 'organizer_id': self.manager.id,
            'meeting_date': '2026-09-08',
        })
        second = self.env['cyan.meeting.minute'].create({
            'name': 'Second date-only', 'state': 'draft', 'series_id': series.id, 'organizer_id': self.manager.id,
            'meeting_date': '2026-09-15',
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{first.id}', {
            'start_datetime': '2026-09-08T09:00:00.000Z',
            'end_datetime': '2026-09-08T10:00:00.000Z', 'scope': 'this_and_following',
        })
        self.assertEqual(response.status_code, 200, response.text)
        first.invalidate_recordset()
        second.invalidate_recordset()
        self.assertEqual((first.start_datetime, first.end_datetime), (
            fields.Datetime.to_datetime('2026-09-08 09:00:00'),
            fields.Datetime.to_datetime('2026-09-08 10:00:00'),
        ))
        self.assertEqual((second.start_datetime, second.end_datetime), (
            fields.Datetime.to_datetime('2026-09-15 09:00:00'),
            fields.Datetime.to_datetime('2026-09-15 10:00:00'),
        ))

    def test_http_scope_keeps_timed_following_occurrence_when_source_is_date_only(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'تحديث اجتماع مؤرخ مختلط', 'key': 'meeting_scope_mixed_date_only',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.manage']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.manager.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        series = self.env['nasq.meeting.series'].create({
            'name': 'Mixed date-only schedule', 'recurrence': 'none', 'organizer_id': self.manager.id,
        })
        first = self.env['cyan.meeting.minute'].create({
            'name': 'First date-only', 'state': 'draft', 'series_id': series.id, 'organizer_id': self.manager.id,
            'meeting_date': '2026-09-08',
        })
        second = self.env['cyan.meeting.minute'].create({
            'name': 'Second timed', 'state': 'draft', 'series_id': series.id, 'organizer_id': self.manager.id,
            'meeting_date': '2026-09-15',
            'start_datetime': '2026-09-15 14:00:00', 'end_datetime': '2026-09-15 15:00:00',
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{first.id}', {
            'meeting_date': '2026-09-10',
            'start_datetime': '2026-09-10T09:00:00.000Z',
            'end_datetime': '2026-09-10T10:00:00.000Z', 'scope': 'this_and_following',
        })
        self.assertEqual(response.status_code, 200, response.text)
        second.invalidate_recordset()
        self.assertEqual((second.meeting_date, second.start_datetime, second.end_datetime), (
            fields.Date.to_date('2026-09-17'),
            fields.Datetime.to_datetime('2026-09-17 14:00:00'),
            fields.Datetime.to_datetime('2026-09-17 15:00:00'),
        ))

    def test_employee_lists_participant_meetings_only(self):
        user_group = self.env.ref('nasq_meetings.group_cap_meetings_read')
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

    def test_meeting_search_by_location_preserves_ordinary_visibility(self):
        user_group = self.env.ref('nasq_meetings.group_cap_meetings_read')
        self.employee.group_ids |= user_group
        self.manager.group_ids |= user_group
        visible = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Operations review', 'organizer_id': self.employee.id,
            'location': 'Secure Room', 'meeting_date': '2026-09-10',
        })
        hidden = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Board review', 'organizer_id': self.manager.id,
            'location': 'Secure Room', 'meeting_date': '2026-09-10',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/meetings?q=Secure%20Room').json()
        self.assertEqual(body['total'], 1)
        self.assertEqual([row['id'] for row in body['items']], [visible.id])
        self.assertNotIn(hidden.id, [row['id'] for row in body['items']])

    def test_meeting_date_range_rejects_reversed_bounds(self):
        self.employee.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read')
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/meetings?date_from=2026-09-11&date_to=2026-09-10')
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['field'], 'date_to')

    def test_manage_group_reads_company_meetings_and_outsider_cannot(self):
        # Nasq-dependent coverage recovered from the Cyan source conflict.
        office = new_test_user(
            self.env, login='nasq_office_mgr',
            groups='nasq_meetings.group_cap_meetings_manage',
            company_id=self.env.company.id, company_ids=self.env.company.ids,
        )
        self.env['nasq.access.assignment'].create({'user_id': office.id, 'role_id': self.env.ref('nasq_core.role_system_admin').id, 'company_id': self.env.company.id})
        self.employee.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read')
        self.manager.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read')
        meeting = self.env['cyan.meeting.minute'].create({
            'state': 'draft', 'name': 'Office meeting', 'organizer_id': self.manager.id,
        })
        self.assertIn(meeting, meeting.with_user(office).search([('id', '=', meeting.id)]))
        self.assertFalse(meeting.with_user(self.employee).search([('id', '=', meeting.id)]))
        self.assertIn(meeting, meeting.with_user(self.manager).search([('id', '=', meeting.id)]))

    def test_meetings_only_role_can_open_detail_without_task_access(self):
        role = self.env['nasq.access.role'].create({
            'name_ar': 'قراءة الاجتماعات فقط', 'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env.ref('nasq_meetings.permission_meetings_read').ids)],
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

    def _outsider(self):
        other = self.env['res.company'].create({'name': 'Outsider Co'})
        return new_test_user(
            self.env, login='api_outsider', password='api_outsider_pass_123', name='Omar',
            groups='nasq_core.group_employee', company_id=other.id, company_ids=[other.id],
        )

    def test_create_and_patch_reject_people_outside_the_current_company(self):
        self._grant_meeting_create()
        outsider = self._outsider()
        self.authenticate('api_emp', 'api_emp_pass_123')
        base = {'name': 'People check', 'meeting_date': '2026-09-08'}
        for field, body in [
            ('attendee_ids', {**base, 'attendee_ids': [self.manager.id, outsider.id]}),
            ('secretary_id', {**base, 'secretary_id': outsider.id}),
        ]:
            response = self.api('POST', '/api/v1/meetings', body)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['field'], field)
        created = self.api('POST', '/api/v1/meetings', {**base, 'attendee_ids': [self.manager.id]})
        self.assertEqual(created.status_code, 201, created.text)
        meeting_id = created.json()['id']
        for field, body in [
            ('attendee_ids', {'attendee_ids': [outsider.id]}),
            ('secretary_id', {'secretary_id': outsider.id}),
        ]:
            response = self.api('PATCH', f'/api/v1/meetings/{meeting_id}', body)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['field'], field)

    def _manager_meeting(self, **values):
        self.manager.group_ids |= (
            self.env.ref('nasq_meetings.group_cap_meetings_read')
            | self.env.ref('nasq_meetings.group_cap_meetings_manage')
        )
        role = self.env['nasq.access.role'].create({
            'name_ar': 'إدارة اكتمال الاجتماع', 'key': 'meeting_completion_manager',
            'type': 'custom', 'permission_ids': [(6, 0, self.env['nasq.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.manage']),
            ]).ids)],
        })
        self.env['nasq.access.assignment'].create({
            'user_id': self.manager.id, 'company_id': self.env.company.id, 'role_id': role.id,
        })
        vals = {'name': 'Completion guard', 'state': 'draft', 'organizer_id': self.manager.id, 'meeting_date': '2026-09-08', **values}
        return self.env['cyan.meeting.minute'].create(vals)

    def test_complete_requires_schedule_and_minutes(self):
        meeting = self._manager_meeting()
        meeting.with_user(self.manager).action_confirm()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('POST', f'/api/v1/meetings/{meeting.id}/complete', {})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['field'], 'start_datetime')
        meeting.with_user(self.manager).write({
            'start_datetime': '2026-09-08 07:00:00', 'end_datetime': '2026-09-08 08:00:00',
        })
        response = self.api('POST', f'/api/v1/meetings/{meeting.id}/complete', {})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()['field'], 'minutes')
        with self.assertRaises(UserError):
            meeting.with_user(self.manager).write({'state': 'done'})
        self.assertEqual(meeting.state, 'confirmed')
        meeting.with_user(self.manager).write({'minutes': '<p>Decisions</p>'})
        response = self.api('POST', f'/api/v1/meetings/{meeting.id}/complete', {})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['state'], 'done')

    def test_cancel_refuses_done_meeting_and_archives_the_calendar_event(self):
        meeting = self._manager_meeting(
            start_datetime='2026-09-08 07:00:00', end_datetime='2026-09-08 08:00:00',
            minutes='<p>Decisions</p>',
        )
        event = meeting.calendar_event_id
        self.assertTrue(event)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        cancelled = self.api('POST', f'/api/v1/meetings/{meeting.id}/cancel', {})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        self.assertFalse(event.active)
        reopened = self.api('POST', f'/api/v1/meetings/{meeting.id}/reopen', {})
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertTrue(event.active)
        self.assertEqual(self.api('POST', f'/api/v1/meetings/{meeting.id}/confirm', {}).status_code, 200)
        self.assertEqual(self.api('POST', f'/api/v1/meetings/{meeting.id}/complete', {}).status_code, 200)
        refused = self.api('POST', f'/api/v1/meetings/{meeting.id}/cancel', {})
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertEqual(refused.json()['code'], 'transition_forbidden')
        meeting.invalidate_recordset()
        self.assertEqual(meeting.state, 'done')
        self.assertTrue(event.active)

    def test_patch_with_a_stale_write_date_is_a_conflict(self):
        self._grant_meeting_create()
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Concurrent minutes', 'state': 'draft', 'organizer_id': self.employee.id,
            'meeting_date': '2026-09-08',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        detail = self.api('GET', f'/api/v1/meetings/{meeting.id}').json()
        self.assertEqual(detail['write_date'], fields.Datetime.to_string(meeting.write_date).replace(' ', 'T') + 'Z')
        stale = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {
            'minutes': '<p>stale</p>', 'write_date': '2000-01-01T00:00:00Z',
        })
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual((stale.json()['code'], stale.json()['field']), ('conflict', 'write_date'))
        meeting.invalidate_recordset()
        self.assertFalse(meeting.minutes)
        malformed = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'minutes': '<p>x</p>', 'write_date': 'yesterday'})
        self.assertEqual(malformed.status_code, 422, malformed.text)
        current = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {
            'minutes': '<p>fresh</p>', 'write_date': detail['write_date'],
        })
        self.assertEqual(current.status_code, 200, current.text)
        self.assertEqual(current.json()['minutes'], '<p>fresh</p>')
        self.assertIn('write_date', current.json())

    def test_patch_with_null_series_id_detaches_the_meeting(self):
        self._grant_meeting_create()
        series = self.env['nasq.meeting.series'].create({
            'name': 'Detach series', 'recurrence': 'none', 'organizer_id': self.employee.id,
        })
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Detached occurrence', 'state': 'draft', 'organizer_id': self.employee.id,
            'series_id': series.id, 'meeting_date': '2026-09-08',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'series_id': None})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['series_id'])
        self.assertIsNone(response.json()['series'])
        meeting.invalidate_recordset()
        self.assertFalse(meeting.series_id)
        self.assertEqual(self.api('PATCH', f'/api/v1/meetings/{meeting.id}', {'series_id': 0}).status_code, 422)

    def test_non_manager_transitions_and_attendee_edits_answer_403(self):
        self._grant_meeting_create()
        own = self.env['cyan.meeting.minute'].create({
            'name': 'Organizer without manage', 'state': 'draft', 'organizer_id': self.employee.id,
            'meeting_date': '2026-09-08',
        })
        self.manager.group_ids |= self.env.ref('nasq_meetings.group_cap_meetings_read')
        attended = self.env['cyan.meeting.minute'].create({
            'name': 'Attended only', 'state': 'draft', 'organizer_id': self.manager.id,
            'attendee_ids': [(6, 0, self.employee.ids)], 'meeting_date': '2026-09-08',
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        for action in ('complete', 'cancel', 'reopen'):
            response = self.api('POST', f'/api/v1/meetings/{own.id}/{action}', {})
            self.assertEqual(response.status_code, 403, (action, response.text))
            self.assertEqual(response.json()['code'], 'forbidden', action)
        own.invalidate_recordset()
        self.assertEqual(own.state, 'draft')
        edit = self.api('PATCH', f'/api/v1/meetings/{attended.id}', {'name': 'Hijacked'})
        self.assertEqual(edit.status_code, 403, edit.text)
        self.assertEqual(edit.json()['code'], 'forbidden')
        attended.invalidate_recordset()
        self.assertEqual(attended.name, 'Attended only')
        self.assertEqual(self.api('PATCH', f'/api/v1/meetings/{own.id}', {'name': 'Renamed by organizer'}).status_code, 200)
