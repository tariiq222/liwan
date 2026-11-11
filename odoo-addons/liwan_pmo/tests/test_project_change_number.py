# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import LockError
from odoo.tests import tagged

from .common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestProjectChangeNumber(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.project.write({'user_id': cls.manager.id})
        cls.base = f'/api/v1/projects/{cls.project.id}/changes'

    def _raise(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        return self.api('POST', self.base, {'title': 'Add a reporting module'})

    def test_numbers_run_on_per_project(self):
        self.assertEqual([self._raise().json()['number'] for _ in range(3)], [1, 2, 3])

    def test_a_project_busy_with_another_request_answers_409(self):
        with patch.object(type(self.project), 'lock_for_update', side_effect=LockError('busy')):
            response = self._raise()
        self.assertEqual((response.status_code, response.json()['code']), (409, 'change_state'))
        self.assertEqual(self.env['liwan.project.change'].search_count([('project_id', '=', self.project.id)]), 0)

    def test_a_number_taken_meanwhile_answers_409_not_a_raw_constraint_error(self):
        first = self._raise().json()
        with patch.object(type(self.env['liwan.project.change']), '_liwan_next_number', return_value=first['number']):
            response = self._raise()
        self.assertEqual((response.status_code, response.json()['code']), (409, 'change_state'))
