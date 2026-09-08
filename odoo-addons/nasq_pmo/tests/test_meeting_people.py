# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestMeetingPeopleApi(NasqPmoCase):

    def test_meetings_only_picker_searches_internal_current_company_users(self):
        for index in range(55):
            new_test_user(
                self.env, login=f'meeting_picker_{index}', name=f'Picker {index:02d}',
                groups='nasq_core.group_employee', company_id=self.env.company.id,
                company_ids=[self.env.company.id],
            )
        company_b = self.env['res.company'].create({'name': 'Picker company B'})
        new_test_user(
            self.env, login='meeting_picker_foreign', name='Picker foreign',
            groups='nasq_core.group_employee', company_id=company_b.id, company_ids=[company_b.id],
        )
        inactive = new_test_user(
            self.env, login='meeting_picker_inactive', name='Picker inactive',
            groups='nasq_core.group_employee', company_id=self.env.company.id,
            company_ids=[self.env.company.id],
        )
        inactive.active = False
        new_test_user(
            self.env, login='meeting_picker_portal', name='Picker portal',
            groups='base.group_portal', company_id=self.env.company.id,
            company_ids=[self.env.company.id],
        )
        self.authenticate('api_emp', 'api_emp_pass_123')
        targeted = self.api('GET', '/api/v1/people?q=Picker%2054&limit=50')
        self.assertEqual(targeted.status_code, 200, targeted.text)
        self.assertEqual([row['name'] for row in targeted.json()], ['Picker 54'])
        response = self.api('GET', '/api/v1/people?q=Picker&limit=50')
        self.assertEqual(response.status_code, 200, response.text)
        rows = response.json()
        self.assertEqual(len(rows), 50)
        self.assertEqual({row['id'] for row in rows}, {row['user_id'] for row in rows})
        self.assertNotIn(inactive.id, {row['id'] for row in rows})
        self.assertNotIn('Picker foreign', {row['name'] for row in rows})
        self.assertNotIn('Picker portal', {row['name'] for row in rows})
        zero_limit = self.api('GET', '/api/v1/people?q=Picker&limit=0')
        self.assertEqual(zero_limit.status_code, 200, zero_limit.text)
        self.assertEqual(len(zero_limit.json()), 1)
