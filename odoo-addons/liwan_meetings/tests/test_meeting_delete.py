# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanMeetingsCase


@tagged('post_install', '-at_install', 'liwan')
class TestMeetingDelete(LiwanMeetingsCase):
    """Owner decision of issue #162 (MTG-182): only a draft is deleted; a confirmed meeting is cancelled and kept."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        Permission = cls.env['liwan.access.permission']
        manager_role = cls.env['liwan.access.role'].create({
            'name_ar': 'مدير اجتماعات الاختبار', 'type': 'custom',
            'permission_ids': [(6, 0, Permission.search([('key', 'in', ['meetings.read', 'meetings.manage'])]).ids)],
        })
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.manager.id, 'company_id': cls.env.company.id, 'role_id': manager_role.id,
        })
        organizer_role = cls.env['liwan.access.role'].create({
            'name_ar': 'منسق اجتماعات الاختبار', 'type': 'custom',
            'permission_ids': [(6, 0, Permission.search([('key', 'in', ['meetings.read', 'meetings.create'])]).ids)],
        })
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.employee.id, 'company_id': cls.env.company.id, 'role_id': organizer_role.id,
        })

    def _meeting(self, **extra):
        return self.env['liwan.meeting.minute'].create({
            'state': 'draft', 'name': 'Delete me', 'organizer_id': self.employee.id,
            'meeting_date': '2026-09-10', **extra,
        })

    def test_a_manager_deletes_a_draft_with_its_recommendations_and_event(self):
        meeting = self._meeting(start_datetime='2026-09-10 09:00:00', end_datetime='2026-09-10 10:00:00')
        self.assertTrue(meeting.calendar_event_id)
        event = meeting.calendar_event_id
        resolution = self.env['liwan.meeting.resolution'].create({
            'meeting_id': meeting.id, 'name': 'Gone too', 'responsible_id': self.employee.id, 'deadline': '2026-09-30',
        })
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('DELETE', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(response.status_code, 204, response.text)
        self.assertFalse(meeting.exists())
        self.assertFalse(resolution.exists())
        self.assertFalse(event.exists())
        self.assertEqual(self.api('GET', f'/api/v1/meetings/{meeting.id}').status_code, 404)

    def test_a_confirmed_meeting_is_refused_and_kept(self):
        meeting = self._meeting()
        meeting.action_confirm()
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('DELETE', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['code'], 'conflict')
        self.assertIn('draft', response.json()['message'])
        self.assertEqual(meeting.state, 'confirmed')
        cancelled = self.api('POST', f'/api/v1/meetings/{meeting.id}/cancel', {})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        refused = self.api('DELETE', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(refused.status_code, 409, refused.text)
        self.assertEqual(meeting.state, 'cancelled')

    def test_the_organizer_without_the_manage_capability_cannot_delete(self):
        meeting = self._meeting()
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('DELETE', f'/api/v1/meetings/{meeting.id}')
        self.assertEqual(response.status_code, 403, response.text)
        self.assertTrue(meeting.exists())
