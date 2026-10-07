# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_pmo.serializers.meeting import dump_meeting


@tagged('nasq')
class TestMeetingLifecycle(TransactionCase):
    """Calendar membership and recommendation actions of a meeting, without projects."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        meeting_user = 'nasq_core.group_employee,cyan_meeting_minutes.group_meeting_user'
        cls.organizer = new_test_user(
            cls.env, login='life_org', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.secretary = new_test_user(
            cls.env, login='life_sec', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.attendee = new_test_user(
            cls.env, login='life_att', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.manager_cap = new_test_user(
            cls.env, login='life_mgr', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        Assignment = cls.env['nasq.access.assignment']
        Permission = cls.env['nasq.access.permission']
        manage_role = cls.env['nasq.access.role'].create({
            'name_ar': 'إدارة الاجتماعات',
            'company_id': cls.company.id,
            'permission_ids': [(6, 0, Permission.search([
                ('key', 'in', ['meetings.read', 'meetings.manage']),
            ]).ids)],
        })
        Assignment.create({'user_id': cls.manager_cap.id, 'role_id': manage_role.id, 'company_id': cls.company.id})
        create_role = cls.env['nasq.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات', 'company_id': cls.company.id,
            'permission_ids': [(6, 0, Permission.search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        Assignment.create({'user_id': cls.organizer.id, 'role_id': create_role.id, 'company_id': cls.company.id})
        cls.Meeting = cls.env['cyan.meeting.minute']
        cls.Resolution = cls.env['cyan.meeting.resolution']

    def _create_meeting(self, **extra):
        vals = {
            'name': 'Ops Review',
            'organizer_id': self.organizer.id,
            'secretary_id': self.secretary.id,
            'attendee_ids': [(6, 0, [self.attendee.id])],
            'meeting_date': fields.Date.today(),
            'start_datetime': fields.Datetime.now(),
            'end_datetime': fields.Datetime.now(),
            'agenda': '<p>Secret agenda</p>',
            'minutes': '<p>Secret minutes</p>',
        }
        vals.update(extra)
        return self.Meeting.with_user(self.organizer).create(vals)

    def _create_resolution(self, meeting, **extra):
        vals = {
            'meeting_id': meeting.id,
            'name': 'Follow up vendor',
            'responsible_id': self.attendee.id,
            'deadline': fields.Date.today(),
            'description': '<p>Do not copy me</p>',
        }
        vals.update(extra)
        return self.Resolution.with_user(self.organizer).create(vals)

    def _resolution_row(self, resolution, user):
        detail = dump_meeting(resolution.meeting_id.with_user(user), detail=True)
        return next(row for row in detail['resolutions'] if row['id'] == resolution.id)

    def test_allowed_actions_follow_actual_resolution_permissions(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        organizer_row = self._resolution_row(resolution, self.organizer)
        assignee_row = self._resolution_row(resolution, self.attendee)
        self.assertEqual(organizer_row['allowed_actions'], ['start', 'complete', 'cancel', 'edit_result'])
        self.assertEqual(assignee_row['allowed_actions'], ['start', 'complete', 'edit_result'])
        self.assertTrue(assignee_row['can_update_execution'])
        self.assertFalse(assignee_row['can_edit_decision'])

    def test_done_resolution_has_no_notes_action_and_manager_can_reopen_done_meeting(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        resolution.with_user(self.manager_cap).action_done()
        meeting.sudo().write({'state': 'done'})
        done_row = self._resolution_row(resolution, self.manager_cap)
        self.assertEqual(done_row['execution_state'], 'done')
        self.assertNotIn('edit_result', done_row['allowed_actions'])
        self.assertEqual(done_row['allowed_actions'], ['reopen'])
        resolution.with_user(self.manager_cap).action_reopen()
        self.assertEqual(resolution.state, 'open')

    def test_done_meeting_does_not_advertise_decision_edit_for_open_resolution(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        meeting.sudo().write({'state': 'done'})
        row = self._resolution_row(resolution, self.manager_cap)
        self.assertFalse(row['can_edit_decision'])

    def test_edit_meeting_schedule_updates_existing_calendar_event(self):
        meeting = self._create_meeting()
        event = meeting.calendar_event_id
        self.assertTrue(event)
        meeting.write({'name': 'Updated meeting', 'start_datetime': '2026-09-08 10:00:00',
                       'end_datetime': '2026-09-08 11:00:00', 'location': 'New room'})
        self.assertEqual(meeting.calendar_event_id, event)
        self.assertEqual(event.name, 'Updated meeting')
        self.assertEqual(event.start, meeting.start_datetime)
        self.assertEqual(event.stop, meeting.end_datetime)
        self.assertEqual(event.location, 'New room')

    def test_calendar_import_does_not_create_an_extra_event(self):
        Event = self.env['calendar.event'].with_user(self.organizer)
        event = Event.create({'name': 'Import calendar', 'start': '2026-09-08 10:00:00',
                              'stop': '2026-09-08 11:00:00', 'user_id': self.organizer.id})
        before = Event.search_count([])
        action = event.action_open_meeting_minutes()
        meeting = self.Meeting.browse(action['res_id'])
        self.assertEqual(meeting.calendar_event_id, event)
        self.assertEqual(Event.search_count([]), before)

    def test_membership_stays_removed_after_rename_and_reschedule(self):
        meeting = self._create_meeting()
        meeting.write({'attendee_ids': [(6, 0, [])]})
        meeting.write({'name': 'Renamed', 'start_datetime': '2026-09-09 10:00:00', 'end_datetime': '2026-09-09 11:00:00'})
        self.assertNotIn(self.attendee, meeting.attendee_ids)
        self.assertNotIn(self.attendee.partner_id, meeting.calendar_event_id.partner_ids)
        self.assertNotIn(self.attendee.partner_id, meeting.message_partner_ids)
        self.assertEqual(meeting.secretary_id, self.secretary)
        with self.assertRaises(AccessError):
            meeting.with_user(self.attendee).read(['name'])

    def test_simultaneous_membership_metadata_and_add_preserve_secretary(self):
        meeting = self._create_meeting()
        meeting.write({'name': 'Removed together', 'attendee_ids': [(6, 0, [])]})
        self.assertFalse(meeting.attendee_ids)
        meeting.write({'name': 'Added together', 'attendee_ids': [(4, self.attendee.id)]})
        self.assertEqual(meeting.attendee_ids, self.attendee)
        self.assertEqual(meeting.secretary_id, self.secretary)
        self.assertEqual(meeting.calendar_event_id.partner_ids, meeting._cyan_participant_users().mapped('partner_id'))

    def test_calendar_origin_membership_keeps_secretary_and_no_stale_attendee(self):
        meeting = self._create_meeting()
        meeting.calendar_event_id.write({'name': 'From calendar', 'partner_ids': [(6, 0, (self.organizer | self.secretary).mapped('partner_id').ids)]})
        self.assertFalse(meeting.attendee_ids)
        self.assertEqual(meeting.secretary_id, self.secretary)
        self.assertEqual(meeting.name, 'From calendar')

    def test_forged_sync_context_does_not_skip_calendar_membership_sync(self):
        meeting = self._create_meeting()
        meeting.with_context(nasq_calendar_import=True, nasq_calendar_outbound=True).write({'attendee_ids': [(6, 0, [])], 'name': 'Forged flags'})
        self.assertNotIn(self.attendee.partner_id, meeting.calendar_event_id.partner_ids)
        self.assertFalse(meeting.attendee_ids)

    def test_linked_membership_sync_survives_missing_schedule(self):
        for missing in ('start_datetime', 'end_datetime'):
            with self.subTest(missing=missing):
                meeting = self._create_meeting()
                event = meeting.calendar_event_id
                schedule = (event.start, event.stop)
                meeting.write({missing: False})
                meeting.write({'attendee_ids': [(6, 0, [])], 'name': 'Incomplete schedule'})
                self.assertFalse(meeting[missing])
                self.assertNotIn(self.attendee, meeting.attendee_ids)
                self.assertNotIn(self.attendee.partner_id, event.partner_ids)
                self.assertNotIn(self.attendee.partner_id, meeting.message_partner_ids)
                self.assertEqual((event.start, event.stop), schedule)
                self.assertEqual(event.name, 'Incomplete schedule')
                self.assertEqual(meeting.secretary_id, self.secretary)
                with self.assertRaises(AccessError):
                    meeting.with_user(self.attendee).read(['name'])

    def test_clear_schedule_and_remove_membership_in_one_write(self):
        meeting = self._create_meeting()
        event = meeting.calendar_event_id
        schedule = (event.start, event.stop)
        meeting.write({'start_datetime': False, 'end_datetime': False,
                       'attendee_ids': [(6, 0, [])], 'secretary_id': False})
        self.assertEqual(event.partner_ids, self.organizer.partner_id)
        self.assertFalse(meeting.attendee_ids)
        self.assertFalse(meeting.secretary_id)
        self.assertEqual((event.start, event.stop), schedule)
