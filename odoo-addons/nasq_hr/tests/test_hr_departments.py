# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqHrCase

DEPT_KEYS = {'id', 'name', 'parent_id', 'manager', 'child_ids'}


@tagged('post_install', '-at_install', 'nasq')
class TestHrDepartments(NasqHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_dept_admin', password='hr_dept_admin_pass_123',
            name='Dept Admin', groups='nasq_core.group_customer_admin',
        )
        cls.dept_a = cls.env['hr.department'].create({'name': 'Engineering'})
        cls.dept_b = cls.env['hr.department'].create({'name': 'Finance'})
        cls.hr_emp = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1)
        if not cls.hr_emp:
            cls.hr_emp = cls.env['hr.employee'].create({
                'name': cls.employee.name, 'user_id': cls.employee.id,
            })
        cls.dept_a.write({'manager_id': cls.hr_emp.id})
        cls.dept_child = cls.env['hr.department'].create({
            'name': 'QA', 'parent_id': cls.dept_a.id,
        })

    def test_employee_can_list_and_get(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/departments')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn('items', body)
        self.assertGreaterEqual(body['total'], 3)
        ids = {d['id'] for d in body['items']}
        self.assertIn(self.dept_a.id, ids)
        item = next(d for d in body['items'] if d['id'] == self.dept_a.id)
        self.assertEqual(set(item), DEPT_KEYS)
        self.assertEqual(item['name'], 'Engineering')
        self.assertIsNone(item['parent_id'])
        self.assertEqual(item['manager'], {'id': self.hr_emp.id, 'name': self.hr_emp.name})
        self.assertIn(self.dept_child.id, item['child_ids'])
        detail = self.api('GET', f'/api/v1/hr/departments/{self.dept_child.id}').json()
        self.assertEqual(detail['parent_id'], self.dept_a.id)
        self.assertEqual(set(detail), DEPT_KEYS)

    def test_employee_write_is_403(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/hr/departments', {'name': 'Legal'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')
        res = self.api('PATCH', f'/api/v1/hr/departments/{self.dept_a.id}', {'name': 'Eng 2'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

    def test_admin_create_and_patch(self):
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/departments', {
            'name': 'Legal', 'parent_id': self.dept_a.id, 'manager_id': self.hr_emp.id,
        })
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), DEPT_KEYS)
        self.assertEqual(body['name'], 'Legal')
        self.assertEqual(body['parent_id'], self.dept_a.id)
        self.assertEqual(body['manager']['id'], self.hr_emp.id)
        res = self.api('PATCH', f'/api/v1/hr/departments/{body["id"]}', {'name': 'Legal Affairs'})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['name'], 'Legal Affairs')

    def test_get_unknown_is_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/departments/999999')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')

    def test_create_empty_name_is_422(self):
        self.authenticate('hr_dept_admin', 'hr_dept_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/departments', {'name': '   '})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'name')
