# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.exceptions import AccessError, UserError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.webvue_meetings.serializers.meeting import dump_meeting
from odoo.addons.webvue_pmo.serializers.task import dump_task, dump_task_detail


@tagged('webvue')
class TestResolutionConvert(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        meeting_user = 'webvue_core.group_employee,webvue_meetings.group_cap_meetings_read'
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
            cls.env, login='cvt_out', groups='webvue_core.group_employee',
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        cls.manager_cap = new_test_user(
            cls.env, login='cvt_mgr', groups=meeting_user,
            company_id=cls.company.id, company_ids=[cls.company.id],
        )
        Assignment = cls.env['webvue.access.assignment']
        task_only = cls.env['webvue.access.role'].create({
            'name_ar': 'مهام بلا اجتماعات',
            'company_id': cls.company.id,
            'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
                ('key', 'in', ['pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.write']),
            ]).ids)],
        })
        Assignment.create({
            'user_id': cls.outsider.id,
            'role_id': task_only.id,
            'company_id': cls.company.id,
        })
        manage_role = cls.env['webvue.access.role'].create({
            'name_ar': 'إدارة اجتماعات وتحويل',
            'company_id': cls.company.id,
            'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
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
        create_role = cls.env['webvue.access.role'].create({
            'name_ar': 'إنشاء الاجتماعات', 'company_id': cls.company.id,
            'permission_ids': [(6, 0, cls.env['webvue.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create', 'pmo.projects.read', 'pmo.tasks.read', 'pmo.tasks.create']),
            ]).ids)],
        })
        Assignment.create({'user_id': cls.organizer.id, 'role_id': create_role.id, 'company_id': cls.company.id})
        cls.Meeting = cls.env['webvue.meeting.minute']
        cls.Resolution = cls.env['webvue.meeting.resolution']

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

    def test_editor_converts_name_deadline_assignee_without_minutes(self):
        meeting = self._create_meeting()
        other = self._create_resolution(meeting, name='Other rec')
        resolution = self._create_resolution(meeting, priority='1')
        task = resolution.with_user(self.organizer).action_convert_to_task(self.project.id)
        self.assertEqual(task.name, 'Follow up vendor')
        self.assertEqual(task.priority, resolution.priority)
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
        # Fixture setup: the converting organizer has create, not general task-write.
        task.sudo().write({'user_ids': [(6, 0, [self.outsider.id])]})
        service = self.env['webvue.access.service']
        self.assertFalse(service._webvue_has_capability(self.outsider, 'meetings.read'))
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
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        meeting.sudo().write({'state': 'done'})
        self.assertFalse(dump_meeting(meeting.with_user(self.manager_cap), detail=True)['can_edit'])
        with self.assertRaises(UserError):
            resolution.with_user(self.manager_cap).action_convert_to_task(self.project.id)

    def test_readable_done_task_projects_execution_and_meeting_count(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        task = resolution.with_user(self.organizer).action_convert_to_task(self.project.id)
        task.sudo().write({'state': '1_done'})
        row = self._resolution_row(resolution, self.organizer)
        self.assertEqual(row['state'], 'open')
        self.assertEqual(row['execution_state'], 'done')
        self.assertTrue(row['task_linked'])
        self.assertEqual(row['task_id'], task.id)
        self.assertEqual(row['allowed_actions'], [])
        self.assertEqual(dump_meeting(meeting.with_user(self.organizer))['open_resolution_count'], 0)

    def test_archived_task_is_linked_but_frozen_without_state_disclosure(self):
        meeting = self._create_meeting()
        resolution = self._create_resolution(meeting)
        task = resolution.with_user(self.organizer).action_convert_to_task(self.project.id)
        task.sudo().write({'state': '1_done', 'active': False})
        row = self._resolution_row(resolution, self.organizer)
        self.assertTrue(row['task_linked'])
        self.assertIsNone(row['task_id'])
        self.assertEqual(row['execution_state'], 'open')
        self.assertEqual(row['allowed_actions'], [])
