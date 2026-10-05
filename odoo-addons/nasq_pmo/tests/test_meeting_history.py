# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase
from odoo.addons.nasq_pmo.serializers.meeting import dump_meeting


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingHistory(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee.group_ids |= (
            cls.env.ref('nasq_pmo.group_cap_meetings_read')
            | cls.env.ref('nasq_pmo.group_cap_pmo_tasks_read')
        )
        cls.manager.group_ids |= (
            cls.env.ref('nasq_pmo.group_cap_meetings_manage')
            | cls.env.ref('nasq_pmo.group_cap_pmo_tasks_read')
        )
        permissions = cls.env['nasq.access.permission']
        assignments = cls.env['nasq.access.assignment']
        manager_role = cls.env['nasq.access.role'].create({
            'name_ar': 'مدير اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test manager',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', [
                    'meetings.read', 'meetings.manage',
                    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create',
                ]),
            ]).ids)],
        })
        editor_role = cls.env['nasq.access.role'].create({
            'name_ar': 'محرر اختبار سجل الاجتماعات',
            'name_en': 'Meeting history test editor',
            'company_id': cls.env.company.id,
            'permission_ids': [(6, 0, permissions.search([
                ('key', 'in', [
                    'meetings.read', 'meetings.create',
                    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create',
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
            name='History reader', groups='nasq_core.group_employee',
            company_id=cls.env.company.id, company_ids=[cls.env.company.id],
        )
        reader_role = cls.env['nasq.access.role'].create({
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
        cls.history_project = cls.env['project.project'].create({
            'name': 'Meeting history project',
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

    def test_completion_freezes_snapshot_while_live_resolution_changes(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Publish release notes',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
            'result': '<p>Queued</p>',
        })
        linked_resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Track deployment task',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
        })
        task = linked_resolution.action_convert_to_task(self.history_project.id)
        self._complete(meeting)

        snapshot = meeting.minutes_snapshot
        self.assertIsInstance(snapshot, dict)
        self.assertEqual(snapshot['name'], 'Weekly delivery review')
        self.assertEqual(snapshot['meeting_date'], '2026-09-08')
        self.assertEqual(snapshot['location'], 'Room A')
        self.assertEqual(snapshot['agenda'], '<p>Release agenda</p>')
        self.assertEqual(snapshot['minutes'], '<p>Release minutes</p>')
        self.assertEqual(snapshot['resolutions'][0]['name'], 'Publish release notes')
        self.assertEqual(snapshot['resolutions'][0]['result'], '<p>Queued</p>')
        self.assertIn('captured_at', snapshot)
        report = self.env.ref('cyan_meeting_minutes.action_report_meeting_minutes')
        historical_html, _type = report._render_qweb_html(
            'cyan_meeting_minutes.action_report_meeting_minutes', meeting.ids,
        )
        historical_payload = historical_html if isinstance(historical_html, str) else historical_html.decode()
        self.assertIn('Release minutes', historical_payload)
        self.assertIn('Queued', historical_payload)

        task.write({'state': '1_done'})
        meeting.invalidate_recordset()
        live = dump_meeting(meeting, detail=True)
        linked_live = next(row for row in live['resolutions'] if row['id'] == linked_resolution.id)
        self.assertEqual(linked_live['execution_state'], 'done')
        meeting.invalidate_recordset(['minutes_snapshot'])
        linked_historical = next(
            row for row in meeting.minutes_snapshot['resolutions']
            if row['id'] == linked_resolution.id
        )
        self.assertEqual(linked_historical['state'], 'in_progress')
        current_html, _type = report._render_qweb_html(
            'cyan_meeting_minutes.action_report_meeting_minutes', meeting.ids,
        )
        current_payload = current_html if isinstance(current_html, str) else current_html.decode()
        self.assertIn('Release minutes', current_payload)
        self.assertIn('Queued', current_payload)

        meeting.with_user(self.manager).action_reset_draft()
        meeting.with_user(self.employee).write({'minutes': '<p>Live correction</p>'})
        resolution.with_user(self.employee).write({'result': '<p>Completed later</p>'})

        self.assertEqual(meeting.minutes, '<p>Live correction</p>')
        self.assertEqual(meeting.minutes_snapshot_data['minutes'], '<p>Release minutes</p>')
        self.assertEqual(meeting.minutes_snapshot_data['resolutions'][0]['result'], '<p>Queued</p>')
        self.assertIsNone(dump_meeting(meeting, detail=True)['minutes_snapshot'])

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

    def test_later_task_cannot_change_an_earlier_snapshot(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Earlier captured resolution',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
        })
        resolution.action_convert_to_task(self.history_project.id)
        self._complete(meeting)
        meeting.invalidate_recordset(['minutes_snapshot'])
        before = next(
            row for row in meeting.minutes_snapshot['resolutions']
            if row['id'] == resolution.id
        )

        later_meeting = self._meeting(
            name='Later meeting',
            meeting_date='2026-09-09',
            start_datetime='2026-09-09 07:00:00',
            end_datetime='2026-09-09 08:00:00',
        )
        later_resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': later_meeting.id,
            'name': 'Later task',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-13',
        })
        later_task = later_resolution.action_convert_to_task(self.history_project.id)
        later_task.write({'state': '1_done'})

        meeting.invalidate_recordset(['minutes_snapshot'])
        after = next(
            row for row in meeting.minutes_snapshot['resolutions']
            if row['id'] == resolution.id
        )
        self.assertEqual(after['state'], before['state'])

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

    def test_snapshot_has_no_task_ids_or_action_permissions(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Converted task',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
        })
        resolution.action_convert_to_task(self.history_project.id)
        self._complete(meeting)

        serialized = json.dumps(meeting.minutes_snapshot)
        self.assertNotIn('task_id', serialized)
        self.assertNotIn('allowed_actions', serialized)
        self.assertNotIn('can_update_execution', serialized)
        self.assertNotIn('action', serialized.lower())

    def test_snapshot_does_not_copy_status_from_task_outside_current_read_scope(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Private task status',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
        })
        other_company = self.env['res.company'].create({'name': 'Hidden task company'})
        private_project = self.env['project.project'].create({
            'name': 'Private task project', 'company_id': other_company.id,
        })
        self.env['project.task'].create({
            'name': 'Hidden done task', 'project_id': private_project.id,
            'company_id': other_company.id, 'resolution_id': resolution.id,
            'state': '1_done',
        })
        self._complete(meeting)

        row = next(item for item in meeting.minutes_snapshot['resolutions'] if item['id'] == resolution.id)
        self.assertEqual(row['state'], 'open')

    def test_private_backing_is_hidden_and_projection_rechecks_current_reader_for_api_and_pdf(self):
        meeting = self._meeting(attendee_ids=[(6, 0, [self.employee.id, self.history_reader.id])])
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Reader-safe task',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
        })
        task = resolution.action_convert_to_task(self.history_project.id)
        task.write({'state': '1_done'})
        self._complete(meeting)

        with self.assertRaises(AccessError):
            meeting.with_user(self.history_reader).read(['minutes_snapshot_data'])
        public = meeting.with_user(self.history_reader).read(['minutes_snapshot'])[0]['minutes_snapshot']
        row = next(item for item in public['resolutions'] if item['id'] == resolution.id)
        self.assertEqual(row['state'], 'open')
        self.assertNotIn('task_id', json.dumps(public))

        report = self.env.ref('cyan_meeting_minutes.action_report_meeting_minutes')
        html, _type = report.with_user(self.history_reader)._render_qweb_html(
            'cyan_meeting_minutes.action_report_meeting_minutes', meeting.ids,
        )
        payload = html if isinstance(html, str) else html.decode()
        self.assertIn('Open', payload)
        self.assertNotIn('Done', payload)

    def test_archived_task_does_not_project_into_history(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Archived task',
            'responsible_id': self.employee.id,
            'deadline': '2026-09-12',
        })
        task = resolution.action_convert_to_task(self.history_project.id)
        task.write({'state': '1_done', 'active': False})
        self._complete(meeting)

        row = next(item for item in meeting.with_user(self.manager).minutes_snapshot['resolutions'] if item['id'] == resolution.id)
        self.assertEqual(row['state'], 'open')
        raw = dump_meeting(meeting.with_context(active_test=False), detail=True)
        raw_row = next(item for item in raw['resolutions'] if item['id'] == resolution.id)
        self.assertEqual(raw_row['execution_state'], 'open')
        self.assertIsNone(raw_row['task_id'])

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
        series = self.env['nasq.meeting.series'].create({
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
        self.employee.group_ids |= self.env.ref('nasq_pmo.group_cap_meetings_read')
        self.authenticate('api_emp', 'api_emp_pass_123')

        response = self.api('GET', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertNotIn('minutes_snapshot', response.text)

    def test_converted_task_projection_uses_integer_resolution_id(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Task projection',
            'responsible_id': self.employee.id,
            'deadline': fields.Date.today(),
        })
        task = resolution.action_convert_to_task(self.history_project.id)
        row = dump_meeting(meeting, detail=True)
        projected = next(item for item in row['resolutions'] if item['id'] == resolution.id)
        self.assertTrue(projected['task_linked'])
        self.assertEqual(projected['task_id'], task.id)
