# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqApiCase


@tagged('post_install', '-at_install', 'nasq')
class TestPersonalStagesAndLookups(NasqApiCase):

    def test_personal_stages_created_on_first_call(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        stages = self.api('GET', '/api/v1/me/personal-stages').json()
        self.assertEqual(len(stages), 7)
        self.assertEqual([s['sequence'] for s in stages], sorted(s['sequence'] for s in stages))
        self.assertEqual(set(stages[0]), {'id', 'name', 'sequence', 'fold'})
        self.assertEqual(self.api('GET', '/api/v1/me/personal-stages').json(), stages, 'idempotent')

    def test_projects_minimal(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/projects?minimal=1').json()
        self.assertIn({'id': self.project.id, 'name': 'Erada Portal'}, items)
        self.assertEqual(self.api('GET', '/api/v1/projects').status_code, 400)

    def test_people_minimal(self):
        self.env['hr.employee'].create({'name': 'Sara E', 'user_id': self.employee.id})
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/people?q=sara').json()
        self.assertEqual(items, [{'id': self.employee.id, 'name': 'Sara', 'user_id': self.employee.id}])
