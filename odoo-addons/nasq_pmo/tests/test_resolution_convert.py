# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.nasq_pmo.serializers.task import dump_task, dump_task_detail


@tagged('nasq')
class TestResolutionConvert(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        meeting_user = 'nasq_core.group_employee,cyan_meeting_minutes.group_meeting_user'
        cls.organizer = new_test_user(
            cls.env, login='cvt_org', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.secretary = new_test_user(
            cls.env, login='cvt_sec', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.attendee = new_test_user(
            cls.env, login='cvt_att', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.outsider = new_test_user(
            cls.env, login='cvt_out', groups='nasq_core.group_employee',
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.manager_cap = new_test_user(
            cls.env, login='cvt_mgr', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        Assignment = cls.env['nasq.access.assignment']
        task_only = cls.env['nasq.access.role'].create({
            'name_ar': 'مهام بلا اجتماعات',
            'company_id': cls.company.id,
            'permission_ids': [(6, 0, cls.env['nasq.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.write']),
            ]).ids)],
        })
        Assignment.create({
            'user_id': cls.outsider.id,
            'role_id': task_only.id,
            'company_id': cls.company.id,
        })
        manage_role = cls.env['nasq.access.role'].create({
            'name_ar': 'إدارة اجتماعات وتحويل',
            'company_id': cls.company.id,
            'permission_ids': [(6, 0, cls.env['nasq.access.permission'].search([
                ('key', 'in', [
                    'meetings.read', 'meetings.manage',
                    'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create',
                ]),
            ]).ids)],
        })
        Assignment.create({
            'user_id': cls.manager_cap.id,
            'role_id': manage_role.id,
            'company_id': cls.company.id,
        })
        cls.project = cls.env['project.project'].create({
            'name': 'Convert project', 'company_id': cls.company.id,
        })
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

    def test_editor_converts_name_deadline_assignee_without_minutes(self):
        meeting = self._create_meeting()
        other = self._create_resolution(meeting, name='Other rec')
        resolution = self._create_resolution(meeting)
        task = resolution.with_user(self.organizer).action_convert_to_task(self.project.id)
        self.assertEqual(task.name, 'Follow up vendor')
        self.assertEqual(fields.Date.to_date(task.date_deadline), resolution.deadline)
        self.assertEqual(task.user_ids, self.attendee)
        self.assertEqual(task.meeting_id, meeting.id)
        self.assertEqual(task.resolution_id, resolution.id)
        self.assertIsInstance(task.meeting_id, int)
        self.assertFalse(task.description)
        self.assertNotIn('Secret', task.name)
        self.assertNotEqual(task.resolution_id, other.id)
        payload = dump_task(task)
        detail = dump_task_detail(task)
        self.assertNotIn('minutes', payload)
        self.assertNotIn('agenda', payload)
        self.assertNotIn('minutes', detail)
        self.assertNotIn('agenda', detail)

    def test_attendee_cannot_convert(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        with self.assertRaises(AccessError):
            resolution.with_user(self.attendee).action_convert_to_task(self.project.id)

    def test_meetings_manage_can_convert(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        task = resolution.with_user(self.manager_cap).action_convert_to_task(self.project.id)
        self.assertEqual(task.resolution_id, resolution.id)

    def test_outsider_assignee_controls_task_only(self):
        meeting = self._create_meeting()
        other = self._create_resolution(meeting, name='Keep private')
        resolution = self._create_resolution(meeting)
        task = resolution.with_user(self.organizer).action_convert_to_task(self.project.id)
        task.write({'user_ids': [(6, 0, [self.outsider.id])]})
        service = self.env['nasq.access.service']
        self.assertFalse(service._nasq_has_capability(self.outsider, 'meetings.read'))
        env = task.with_user(self.outsider)
        self.assertEqual(env.name, resolution.name)
        env.write({'name': 'Outsider update'})
        self.assertEqual(task.name, 'Outsider update')
        with self.assertRaises(AccessError):
            meeting.with_user(self.outsider).check_access('read')
        with self.assertRaises(AccessError):
            other.with_user(self.outsider).check_access('read')
        with self.assertRaises(AccessError):
            resolution.with_user(self.outsider).check_access('read')

    def test_origin_fields_rejected_on_generic_create(self):
        with self.assertRaises(AccessError):
            self.env['project.task'].with_user(self.organizer).create({
                'name': 'Spoof', 'project_id': self.project.id, 'meeting_id': 1,
            })

    def test_other_company_project_rejected(self):
        company_b = self.env['res.company'].create({'name': 'Convert Co B'})
        project_b = self.env['project.project'].create({
            'name': 'Other co', 'company_id': company_b.id,
        })
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        with self.assertRaises(AccessError):
            resolution.with_user(self.organizer).action_convert_to_task(project_b.id)


    def test_repeat_conversion_does_not_create_second_task(self):
        resolution = self._create_resolution(self._create_meeting())
        task = resolution.with_user(self.organizer).action_convert_to_task(self.project.id)
        with self.assertRaises(UserError):
            resolution.with_user(self.organizer).action_convert_to_task(self.project.id)
        self.assertEqual(self.env['project.task'].search([('resolution_id', '=', resolution.id)]), task)

    def test_locked_meeting_does_not_offer_edit_or_allow_conversion(self):
        from odoo.addons.nasq_pmo.serializers.meeting import dump_meeting

        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        meeting.sudo().write({'state': 'done'})
        self.assertFalse(dump_meeting(meeting.with_user(self.manager_cap), detail=True)['can_edit'])
        with self.assertRaises(UserError):
            resolution.with_user(self.manager_cap).action_convert_to_task(self.project.id)


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
