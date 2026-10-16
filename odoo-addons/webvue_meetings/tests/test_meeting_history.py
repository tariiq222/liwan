# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import WebVueMeetingsCase
from odoo.addons.webvue_meetings.serializers.meeting import dump_meeting


@tagged('post_install', '-at_install', 'webvue')
class TestMeetingHistory(WebVueMeetingsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee.group_ids |= cls.env.ref('webvue_meetings.group_cap_meetings_read')
        cls.manager.group_ids |= cls.env.ref('webvue_meetings.group_cap_meetings_manage')
        permissions = cls.env['webvue.access.permission']
        assignments = cls.env['webvue.access.assignment']
        manager_role = cls.env['webvue.access.role'].create({
            'name_ar': 'مدير اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test manager',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', [
                    'meetings.read', 'meetings.manage',
                ]),
            ]).ids)],
        })
        editor_role = cls.env['webvue.access.role'].create({
            'name_ar': 'محرر اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test editor',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', [
                    'meetings.read', 'meetings.create',
                ]),
            ]).ids)],
        })
        assignments.create({
            'user_id': cls.manager.id, 'role_id': manager_role.id,
            'company_id': cls.env.company.id,
        })
        assignments.create({
            'user_id': cls.employee.id, 'role_id': editor_role.id,
            'company_id': cls.env.company.id,
        })
        cls.history_reader = new_test_user(
            cls.env, login='meeting_history_reader', password='meeting_history_reader_pass',
            name='History reader', groups='webvue_core.group_employee',
            company_id=cls.env.company.id, company_ids=[cls.env.company.id],
        )
        reader_role = cls.env['webvue.access.role'].create({
            'name_ar': 'قارئ اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test reader',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', ['meetings.read']),
            ]).ids)],
        })
        assignments.create({
            'user_id': cls.history_reader.id, 'role_id': reader_role.id,
            'company_id': cls.env.company.id,
        })

    def _meeting(self, **values):
        defaults = {
            'name': 'Weekly delivery review',
            'state': 'draft',
            'organizer_id': self.employee.id,
            'secretary_id': self.manager.id,
            'attendee_ids': [(6, 0, [self.employee.id, self.manager.id])],
            'meeting_date': '2026-09-08',
            'start_datetime': '2026-09-08 07:00:00',
            'end_datetime': '2026-09-08 08:00:00',
            'location': 'Room A',
            'agenda': '<p>Release agenda</p>',
            'minutes': '<p>Release minutes</p>',
        }
        defaults.update(values)
        return self.env['cyan.meeting.minute'].create(defaults)

    def _complete(self, meeting):
        meeting.with_user(self.manager).action_confirm()
        meeting.with_user(self.manager).action_done()

    def test_recompletion_replaces_prior_snapshot_with_current_history(self):
        meeting = self._meeting(minutes='<p>First completion</p>')
        self._complete(meeting)

        meeting.with_user(self.manager).action_reset_draft()
        meeting.with_user(self.employee).write({
            'name': 'Renamed delivery review',
            'minutes': '<p>Second completion</p>',
        })
        self._complete(meeting)

        self.assertEqual(meeting.minutes_snapshot['name'], 'Renamed delivery review')
        self.assertEqual(meeting.minutes_snapshot['minutes'], '<p>Second completion</p>')
        self.assertNotIn('First completion', json.dumps(meeting.minutes_snapshot))

    def test_completion_snapshot_uses_content_from_same_authorized_write(self):
        meeting = self._meeting(minutes='<p>Draft minutes</p>')
        meeting.with_user(self.manager).action_confirm()
        meeting.with_user(self.manager).write({
            'state': 'done',
            'minutes': '<p>Final minutes</p>',
        })
        self.assertEqual(meeting.minutes, '<p>Final minutes</p>')
        self.assertEqual(meeting.minutes_snapshot['minutes'], '<p>Final minutes</p>')

    def test_snapshot_fields_are_server_only_and_context_defaults_cannot_forge_history(self):
        meeting = self._meeting()
        forged = {
            'captured_at': '1900-01-01T00:00:00Z',
            'name': 'Forged history',
            'meeting_date': '1900-01-01',
            'start_datetime': None,
            'end_datetime': None,
            'location': '',
            'organizer': None,
            'secretary': None,
            'attendees': [],
            'agenda': '',
            'minutes': 'forged',
            'resolutions': [],
        }
        with self.assertRaises(AccessError):
            meeting.with_user(self.employee).write({'minutes_snapshot': forged})
        with self.assertRaises(AccessError):
            meeting.with_user(self.employee).write({'minutes_snapshot_data': forged})
        with self.assertRaises(AccessError):
            meeting.with_user(self.employee).write({'minutes_snapshot_at': fields.Datetime.now()})

        self._complete(meeting.with_context(default_minutes_snapshot=forged))
        self.assertNotEqual(meeting.minutes_snapshot, forged)
        self.assertEqual(meeting.minutes_snapshot['minutes'], '<p>Release minutes</p>')

        created = self.env['cyan.meeting.minute'].with_user(self.employee).with_context(
            default_minutes_snapshot=forged,
        ).create({
            'name': 'No forged default',
            'meeting_date': '2026-09-09',
        })
        self.assertFalse(created.minutes_snapshot)

    def test_same_write_captures_final_attendees_resolution_and_renamed_origin(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Same-write resolution',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
            'result': '<p>Before</p>',
        })
        meeting.with_user(self.manager).action_confirm()
        meeting.with_user(self.manager).write({
            'state': 'done',
            'name': 'Final delivery review',
            'meeting_date': '2026-09-09',
            'attendee_ids': [(3, self.manager.id), (4, self.history_reader.id)],
            'resolution_ids': [(1, resolution.id, {'result': '<p>After</p>'})],
        })

        snapshot = meeting.minutes_snapshot
        self.assertEqual(snapshot['name'], 'Final delivery review')
        self.assertEqual(snapshot['meeting_date'], '2026-09-09')
        self.assertEqual({person['id'] for person in snapshot['attendees']}, {self.employee.id, self.history_reader.id})
        self.assertEqual(snapshot['resolutions'][0]['result'], '<p>After</p>')

    def test_snapshot_keeps_previous_series_resolutions_with_origin_name(self):
        series = self.env['webvue.meeting.series'].create({
            'name': 'Weekly delivery series',
            'organizer_id': self.employee.id,
        })
        first = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-01 07:00:00'),
            fields.Datetime.to_datetime('2026-09-01 08:00:00'),
            'First delivery review',
        )
        self.env['cyan.meeting.resolution'].create({
            'meeting_id': first.id,
            'name': 'Carry this item',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-05',
        })
        second = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-08 07:00:00'),
            fields.Datetime.to_datetime('2026-09-08 08:00:00'),
            'Second delivery review',
        )
        second.write({'minutes': '<p>Second review minutes</p>'})
        self._complete(second)

        previous = next(item for item in second.minutes_snapshot['resolutions'] if item['name'] == 'Carry this item')
        self.assertEqual(previous['meeting_name'], 'First delivery review')

    def test_legacy_completed_meeting_has_null_snapshot_and_unavailable_report_label(self):
        meeting = self._meeting()
        self._complete(meeting)
        self.env.cr.execute(
            'UPDATE cyan_meeting_minute SET minutes_snapshot_data = NULL, minutes_snapshot_at = NULL WHERE id = %s',
            (meeting.id,),
        )
        meeting.invalidate_recordset()
        self.assertFalse(dump_meeting(meeting, detail=True)['minutes_snapshot'])

        report = self.env.ref('cyan_meeting_minutes.action_report_meeting_minutes')
        html, _type = report._render_qweb_html(
            'cyan_meeting_minutes.action_report_meeting_minutes', meeting.ids,
        )
        payload = html if isinstance(html, str) else html.decode()
        self.assertIn('Historical snapshot unavailable', payload)

    def test_unauthorized_user_cannot_receive_historical_snapshot(self):
        meeting = self._meeting(organizer_id=self.manager.id, secretary_id=False, attendee_ids=[])
        self._complete(meeting)
        self.employee.group_ids |= self.env.ref('webvue_meetings.group_cap_meetings_read')
        self.authenticate('api_emp', 'api_emp_pass_123')

        response = self.api('GET', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertNotIn('minutes_snapshot', response.text)

    def test_snapshot_hides_resolutions_of_occurrences_the_reader_cannot_open(self):
        series = self.env['webvue.meeting.series'].create({
            'name': 'Restricted series', 'organizer_id': self.manager.id,
        })
        first = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-01 07:00:00'),
            fields.Datetime.to_datetime('2026-09-01 08:00:00'),
            'Managers only',
        )
        self.env['cyan.meeting.resolution'].create({
            'meeting_id': first.id, 'name': 'Confidential item',
            'responsible_id': self.manager.id, 'deadline': '2026-09-05',
        })
        second = series.action_add_occurrence(
            fields.Datetime.to_datetime('2026-09-08 07:00:00'),
            fields.Datetime.to_datetime('2026-09-08 08:00:00'),
            'Open review',
        )
        second.write({'attendee_ids': [(4, self.history_reader.id)], 'minutes': '<p>Reviewed</p>'})
        self.env['cyan.meeting.resolution'].create({
            'meeting_id': second.id, 'name': 'Shared item',
            'responsible_id': self.history_reader.id, 'deadline': '2026-09-12',
        })
        self._complete(second)
        self.assertEqual(
            sorted(row['name'] for row in second.with_user(self.manager).minutes_snapshot['resolutions']),
            ['Confidential item', 'Shared item'],
        )

        self.authenticate('meeting_history_reader', 'meeting_history_reader_pass')
        detail = self.api('GET', f'/api/v1/meetings/{second.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual([row['name'] for row in detail.json()['minutes_snapshot']['resolutions']], ['Shared item'])
        versions = self.api('GET', f'/api/v1/meetings/{second.id}/versions')
        self.assertEqual(versions.status_code, 200, versions.text)
        self.assertEqual(versions.json()['total'], 1)
        self.assertEqual(
            [row['name'] for row in versions.json()['items'][0]['snapshot']['resolutions']], ['Shared item'],
        )
        self.assertNotIn('Confidential item', detail.text + versions.text)
