# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields
from odoo.tests import tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingsApi(NasqPmoCase):

    def test_employee_lists_participant_meetings_only(self):
        user_group = self.env.ref('nasq_core.group_cap_meetings_read')
        self.employee.groups_id |= user_group
        self.manager.groups_id |= user_group
        meeting = self.env['cyan.meeting.minute'].create({
            'name': 'Ops Review',
            'organizer_id': self.employee.id,
            'meeting_date': fields.Date.today(),
            'attendee_ids': [(6, 0, [self.employee.id])],
        })
        hidden = self.env['cyan.meeting.minute'].create({
            'name': 'Secret Board',
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
        self.assertEqual(hidden_res.status_code, 404)
