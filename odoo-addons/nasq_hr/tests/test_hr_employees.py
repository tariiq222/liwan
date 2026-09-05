# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import NasqHrCase

EMP_KEYS = {'id', 'name', 'job_title', 'department', 'work_email', 'work_phone', 'user_id'}


@tagged('post_install', '-at_install', 'nasq')
class TestHrEmployees(NasqHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.dept_a = cls.env['hr.department'].create({'name': 'Engineering'})
        cls.dept_b = cls.env['hr.department'].create({'name': 'Finance'})
        cls.hr_emp = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1)
        if not cls.hr_emp:
            cls.hr_emp = cls.env['hr.employee'].create({
                'name': cls.employee.name,
                'user_id': cls.employee.id,
            })
        cls.hr_emp.write({
            'job_title': 'Engineer',
            'department_id': cls.dept_a.id,
            'work_email': 'sara@example.com',
            'work_phone': '+966500000000',
        })
        cls.hr_other = cls.env['hr.employee'].create({
            'name': 'Noura Finance',
            'job_title': 'Accountant',
            'department_id': cls.dept_b.id,
            'work_email': 'noura@example.com',
        })

    def test_employee_id_is_not_user_id(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/hr/employees/{self.hr_emp.id}')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(set(body), EMP_KEYS)
        self.assertEqual(body['id'], self.hr_emp.id)
        self.assertEqual(body['user_id'], self.employee.id)
        self.assertNotEqual(body['id'], body['user_id'])
        self.assertEqual(body['name'], self.hr_emp.name)
        self.assertEqual(body['job_title'], 'Engineer')
        self.assertEqual(body['department'], {'id': self.dept_a.id, 'name': 'Engineering'})
        self.assertEqual(body['work_email'], 'sara@example.com')
        self.assertEqual(body['work_phone'], '+966500000000')

    def test_list_by_department_id(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/hr/employees?department_id={self.dept_b.id}').json()
        ids = [e['id'] for e in body['items']]
        self.assertIn(self.hr_other.id, ids)
        self.assertNotIn(self.hr_emp.id, ids)
        self.assertEqual(set(body['items'][0]), EMP_KEYS)

    def test_search_by_name(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        found = self.api('GET', '/api/v1/hr/employees?q=noura').json()
        self.assertGreaterEqual(found['total'], 1)
        self.assertTrue(any(e['id'] == self.hr_other.id for e in found['items']))
        missed = self.api('GET', '/api/v1/hr/employees?q=zzz-no-such').json()
        self.assertEqual(missed['total'], 0)

    def test_people_picker_still_returns_user_ids(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        items = self.api('GET', '/api/v1/people?q=sara').json()
        self.assertTrue(items)
        self.assertEqual(items[0]['id'], self.employee.id)
        self.assertEqual(items[0]['user_id'], self.employee.id)
        self.assertNotEqual(items[0]['id'], self.hr_emp.id)

    def test_get_unknown_is_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/employees/999999')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')

    def test_bad_pagination_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/employees?limit=abc')
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'limit')
