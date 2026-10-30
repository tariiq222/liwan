# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanMeetingsCase


@tagged('post_install', '-at_install', 'liwan')
class TestResolutionSelfAssignment(LiwanMeetingsCase):
    """Owner decision of issue #162 (MTG-249): assigning a recommendation to its own creator sends no bell row."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        role = cls.env['liwan.access.role'].create({
            'name_ar': 'منسق اجتماعات الاختبار', 'type': 'custom',
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([
                ('key', 'in', ['meetings.read', 'meetings.create']),
            ]).ids)],
        })
        cls.env['liwan.access.assignment'].create({
            'user_id': cls.employee.id, 'company_id': cls.env.company.id, 'role_id': role.id,
        })
        cls.meeting = cls.env['liwan.meeting.minute'].create({
            'state': 'draft', 'name': 'Assignment meeting', 'organizer_id': cls.employee.id,
            'attendee_ids': [(6, 0, cls.manager.ids)], 'meeting_date': '2026-09-10',
        })

    def setUp(self):
        super().setUp()
        self.authenticate('api_emp', 'api_emp_pass_123')

    def _bell_rows(self, user, resolution_id):
        return self.env['mail.notification'].sudo().search([
            ('res_partner_id', '=', user.partner_id.id),
            ('mail_message_id.liwan_notification_kind', '=', 'meeting_resolution'),
            ('mail_message_id.liwan_notification_key', '=like', f'meeting-res:{resolution_id}:%'),
        ])

    def _create(self, responsible):
        response = self.api('POST', f'/api/v1/meetings/{self.meeting.id}/resolutions', {
            'name': 'Follow up', 'responsible_id': responsible.id, 'deadline': '2026-09-30',
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def test_assigning_a_recommendation_to_oneself_sends_no_bell_row(self):
        resolution_id = self._create(self.employee)
        self.assertFalse(self._bell_rows(self.employee, resolution_id))

    def test_assigning_another_person_still_sends_a_bell_row(self):
        resolution_id = self._create(self.manager)
        self.assertEqual(len(self._bell_rows(self.manager, resolution_id)), 1)
        self.assertFalse(self._bell_rows(self.employee, resolution_id))
