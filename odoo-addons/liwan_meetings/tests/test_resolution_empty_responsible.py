# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanMeetingsCase


@tagged('post_install', '-at_install', 'liwan')
class TestResolutionEmptyResponsible(LiwanMeetingsCase):
    """Owner decision of issue #162 (MTG-258): an empty responsible_id is refused with a 422 on that field."""

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

    def _create(self, responsible):
        response = self.api('POST', f'/api/v1/meetings/{self.meeting.id}/resolutions', {
            'name': 'Follow up', 'responsible_id': responsible.id, 'deadline': '2026-09-30',
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()['id']

    def test_an_empty_responsible_is_refused_on_patch(self):
        resolution_id = self._create(self.manager)
        path = f'/api/v1/meetings/{self.meeting.id}/resolutions/{resolution_id}'
        for empty in (None, 0, ''):
            response = self.api('PATCH', path, {'responsible_id': empty})
            self.assertEqual(response.status_code, 422, (empty, response.text))
            self.assertEqual(response.json()['code'], 'invalid')
            self.assertEqual(response.json()['field'], 'responsible_id')
        self.assertEqual(self.env['liwan.meeting.resolution'].browse(resolution_id).responsible_id, self.manager)
        reassigned = self.api('PATCH', path, {'responsible_id': self.employee.id})
        self.assertEqual(reassigned.status_code, 200, reassigned.text)
        self.assertEqual(reassigned.json()['responsible']['id'], self.employee.id)
