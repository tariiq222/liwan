# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import new_test_user, tagged

from .common import NasqMeetingsCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingWorkspace(NasqMeetingsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee.group_ids |= (
            cls.env.ref('nasq_meetings.group_cap_meetings_read')
            | cls.env.ref('nasq_meetings.group_cap_meetings_create')
        )
        permissions = cls.env['nasq.access.permission'].search([
            ('key', 'in', ['meetings.read', 'meetings.create']),
        ])
        role = cls.env['nasq.access.role'].create({
            'key': 'meeting_workspace_editor',
            'name_ar': 'محرر مساحة الاجتماعات',
            'name_en': 'Meeting workspace editor',
            'type': 'custom',
            'permission_ids': [(6, 0, permissions.ids)],
        })
        cls.env['nasq.access.assignment'].create({
            'user_id': cls.employee.id,
            'role_id': role.id,
            'company_id': cls.env.company.id,
        })
        cls.outsider = new_test_user(
            cls.env, login='meeting_workspace_outsider', password='meeting_workspace_outsider_pass',
            name='Workspace outsider', groups='nasq_core.group_employee',
            company_id=cls.env.company.id, company_ids=[cls.env.company.id],
        )
        cls.outsider.group_ids |= cls.env.ref('nasq_meetings.group_cap_meetings_read')
        cls.env['nasq.access.assignment'].create({
            'user_id': cls.outsider.id,
            'role_id': role.id,
            'company_id': cls.env.company.id,
        })

    def _authenticate_employee(self):
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _meeting(self, **values):
        vals = {
            'name': 'Workspace review',
            'state': 'draft',
            'organizer_id': self.employee.id,
            'meeting_date': '2026-09-09',
        }
        vals.update(values)
        return self.env['cyan.meeting.minute'].create(vals)

    def test_resolution_accepts_execution_period_without_deadline(self):
        meeting = self._meeting()
        resolution = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id,
            'name': 'Continuous follow up',
            'responsible_id': self.employee.id,
            'execution_period': 'مستمر',
        })
        self.assertFalse(resolution.deadline)
        same_title = self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Continuous follow up',
            'responsible_id': self.employee.id, 'deadline': '2026-09-30',
        })
        meeting._nasq_set_minutes_form({
            'opening': '', 'closing': '', 'chairperson': '',
            'approver_name': '', 'approver_title': '',
            'topics': [{
                'key': 'same-title', 'title': 'Same title', 'discussion': '',
                'project_id': None, 'resolution_ids': [resolution.id, same_title.id],
            }],
        })
        with self.assertRaises(ValidationError):
            self.env['cyan.meeting.resolution'].create({
                'meeting_id': meeting.id,
                'name': 'Missing schedule',
                'responsible_id': self.employee.id,
            })

    def test_minutes_form_and_activity_records_are_protected(self):
        meeting = self._meeting()
        form = {
            'opening': '', 'closing': '', 'chairperson': '',
            'approver_name': '', 'approver_title': '', 'topics': [],
        }
        with self.assertRaises(AccessError):
            meeting.write({'minutes_form_data': form})
        meeting._nasq_set_minutes_form(form)
        meeting._nasq_event('minutes_saved', 'Minutes saved')
        event = self.env['nasq.meeting.event'].search([('meeting_id', '=', meeting.id)], limit=1)
        with self.assertRaises(AccessError):
            event.write({'summary': 'tampered'})
        with self.assertRaises(AccessError):
            event.unlink()

    def test_completion_versions_are_numbered_and_immutable(self):
        meeting = self._meeting(state='confirmed')
        meeting.write({'state': 'done'})
        meeting.write({'state': 'draft'})
        meeting.write({'state': 'confirmed'})
        meeting.write({'state': 'done'})
        versions = self.env['nasq.meeting.minutes.version'].search(
            [('meeting_id', '=', meeting.id)], order='number',
        )
        self.assertEqual(versions.mapped('number'), [1, 2])
        with self.assertRaises(AccessError):
            versions[0].write({'snapshot': {}})
        with self.assertRaises(AccessError):
            versions[0].unlink()

    def test_http_round_trip_and_period_only_resolution(self):
        self._authenticate_employee()
        form = {
            'opening': 'Opening', 'closing': 'Closing', 'chairperson': 'Sara',
            'approver_name': 'Sara', 'approver_title': 'PMO', 'topics': [],
        }
        response = self.api('POST', '/api/v1/meetings', {
            'name': 'Workspace HTTP meeting', 'meeting_date': '2026-09-09', 'minutes_form': form,
        })
        self.assertEqual(response.status_code, 201, response.text)
        meeting_id = response.json()['id']
        self.assertEqual(response.json()['minutes_form'], form)
        period = self.api('POST', f'/api/v1/meetings/{meeting_id}/resolutions', {
            'name': 'Ongoing recommendation', 'responsible_id': self.employee.id,
            'execution_period': 'تحت الدراسة',
        })
        self.assertEqual(period.status_code, 201, period.text)
        self.assertIsNone(period.json()['deadline'])
        self.assertEqual(period.json()['execution_period'], 'تحت الدراسة')
        missing = self.api('POST', f'/api/v1/meetings/{meeting_id}/resolutions', {
            'name': 'Missing schedule', 'responsible_id': self.employee.id,
        })
        self.assertEqual(missing.status_code, 422, missing.text)
        events = self.api('GET', f'/api/v1/meetings/{meeting_id}/events')
        self.assertEqual(events.status_code, 200, events.text)
        self.assertGreaterEqual(events.json()['total'], 2)

    def test_non_participant_cannot_read_workspace_records(self):
        meeting = self._meeting()
        self.authenticate('meeting_workspace_outsider', 'meeting_workspace_outsider_pass')
        response = self.api('GET', f'/api/v1/meetings/{meeting.id}/events')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertFalse(self.env['nasq.meeting.event'].with_user(self.outsider).search([('meeting_id', '=', meeting.id)]))
        meeting.write({'state': 'confirmed'})
        meeting.write({'state': 'done'})
        self.assertFalse(self.env['nasq.meeting.minutes.version'].with_user(self.outsider).search([('meeting_id', '=', meeting.id)]))

    def test_versions_preserve_each_finalized_form(self):
        meeting = self._meeting()
        first = {
            'opening': 'First', 'closing': '', 'chairperson': '',
            'approver_name': '', 'approver_title': '', 'topics': [],
        }
        second = dict(first, opening='Second')
        meeting._nasq_set_minutes_form(first)
        meeting.write({'state': 'confirmed'})
        meeting.write({'state': 'done'})
        meeting.write({'state': 'draft'})
        meeting._nasq_set_minutes_form(second)
        meeting.write({'state': 'confirmed'})
        meeting.write({'state': 'done'})
        self._authenticate_employee()
        response = self.api('GET', f'/api/v1/meetings/{meeting.id}/versions')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['total'], 2)
        self.assertEqual(
            [item['snapshot']['minutes_form']['opening'] for item in response.json()['items']],
            ['Second', 'First'],
        )

    def test_series_resolution_filters_projected_state_before_pagination(self):
        series = self.env['nasq.meeting.series'].create({
            'name': 'Workspace filter series', 'organizer_id': self.employee.id,
        })
        meeting = self._meeting(series_id=series.id, name='Series occurrence')
        self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Overdue recommendation',
            'responsible_id': self.employee.id, 'deadline': '2020-01-01',
        })
        self.env['cyan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Period recommendation',
            'responsible_id': self.employee.id, 'execution_period': 'مستمر',
        })
        self._authenticate_employee()
        active = self.api('GET', f'/api/v1/meeting-series/{series.id}/resolutions?state=active&limit=1')
        overdue = self.api('GET', f'/api/v1/meeting-series/{series.id}/resolutions?state=overdue')
        self.assertEqual(active.status_code, 200, active.text)
        self.assertEqual(active.json()['total'], 2)
        self.assertEqual(len(active.json()['items']), 1)
        self.assertEqual(overdue.status_code, 200, overdue.text)
        self.assertEqual(overdue.json()['total'], 1)
