# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqHrCase

EMP_KEYS = {
    'id', 'name', 'job_title', 'department', 'work_email', 'work_phone', 'user_id',
    'manager', 'active', 'access',
}


@tagged('post_install', '-at_install', 'nasq')
class TestHrEmployees(NasqHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_emp_admin', password='hr_emp_admin_pass_123',
            name='Employee Admin', groups='nasq_core.group_customer_admin',
        )
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

    def test_employee_ids_are_hr_ids_not_user_ids(self):
        # The HR directory keys rows by hr.employee id and carries the linked
        # res.users id separately; the PMO assignee picker (/api/v1/people, owned
        # by nasq_pmo) keys by user id. Assert the distinction from this pillar's
        # own payload: nasq_hr never calls another pillar's route.
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/hr/employees?q=sara').json()
        self.assertTrue(body['items'])
        row = next(e for e in body['items'] if e['id'] == self.hr_emp.id)
        self.assertEqual(row['user_id'], self.employee.id)
        self.assertNotEqual(row['id'], self.employee.id)

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

    def test_admin_can_create_patch_and_archive_employee(self):
        self.authenticate('hr_emp_admin', 'hr_emp_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/employees', {
            'name': 'New HR Employee', 'work_email': 'new.hr@example.com',
            'job_title': 'Analyst', 'department_id': self.dept_a.id,
        })
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), EMP_KEYS)
        self.assertTrue(body['active'])
        self.assertIsNone(body['access'])
        employee_id = body['id']
        res = self.api('PATCH', f'/api/v1/hr/employees/{employee_id}', {
            'job_title': 'Senior Analyst', 'work_email': 'renamed@example.com',
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['job_title'], 'Senior Analyst')
        res = self.api('POST', f'/api/v1/hr/employees/{employee_id}/archive', {})
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()['active'])
        res = self.api('POST', f'/api/v1/hr/employees/{employee_id}/unarchive', {})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['active'])

    def test_archived_list_is_admin_only_and_cross_company_employee_is_hidden(self):
        archived = self.env['hr.employee'].create({'name': 'Archived API Employee', 'active': False})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/employees?archived=1')
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

        self.authenticate('hr_emp_admin', 'hr_emp_admin_pass_123')
        res = self.api('GET', '/api/v1/hr/employees?archived=true')
        self.assertEqual(res.status_code, 200)
        self.assertIn(archived.id, [item['id'] for item in res.json()['items']])

        other_company = self.env['res.company'].create({'name': 'HR API Other Company'})
        foreign = self.env['hr.employee'].create({'name': 'Foreign API Employee', 'company_id': other_company.id})
        res = self.api('GET', f'/api/v1/hr/employees/{foreign.id}')
        self.assertIn(res.status_code, (403, 404))

    def test_employee_write_checks_authorization_before_relation_lookup(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        cases = (
            ('POST', '/api/v1/hr/employees', {'name': 'Should Not Be Created', 'parent_id': 999999}),
            ('PATCH', '/api/v1/hr/employees/999999', {'name': 'Forbidden'}),
            ('POST', '/api/v1/hr/employees/999999/archive', {}),
            ('POST', '/api/v1/hr/employees/999999/unarchive', {}),
            ('POST', '/api/v1/hr/employees/999999/access', {'password': 'valid pass', 'role': 'employee'}),
            ('PATCH', '/api/v1/hr/employees/999999/access', {'role': 'employee'}),
            ('DELETE', '/api/v1/hr/employees/999999/access', None),
        )
        for method, path, body in cases:
            res = self.api(method, path, body)
            self.assertEqual(res.status_code, 403, (method, path, res.text))
            self.assertEqual(res.json()['code'], 'forbidden')

    def test_admin_relation_and_email_errors_are_field_specific(self):
        self.authenticate('hr_emp_admin', 'hr_emp_admin_pass_123')
        cases = [
            ({'name': 'Missing relation', 'department_id': 999999}, 'department_id'),
            ({'name': 'Boolean relation', 'parent_id': True}, 'parent_id'),
            ({'name': 'Float relation', 'parent_id': 1.9}, 'parent_id'),
            ({'name': 'Zero relation', 'department_id': 0}, 'department_id'),
            ({'name': 'Invalid email', 'work_email': 'not-an-email'}, 'work_email'),
            ({'name': 'Numeric email', 'work_email': 0}, 'work_email'),
            ({'name': 'Numeric title', 'job_title': 0}, 'job_title'),
        ]
        for payload, field in cases:
            res = self.api('POST', '/api/v1/hr/employees', payload)
            self.assertEqual(res.status_code, 422, (payload, res.text))
            self.assertEqual((res.json()['code'], res.json()['field']), ('invalid', field))

        other_company = self.env['res.company'].create({'name': 'Foreign Relation Company'})
        foreign_department = self.env['hr.department'].create({
            'name': 'Foreign Relation Department', 'company_id': other_company.id,
        })
        res = self.api('POST', '/api/v1/hr/employees', {
            'name': 'Foreign relation', 'department_id': foreign_department.id,
        })
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual((res.json()['code'], res.json()['field']), ('invalid', 'department_id'))

    def test_archived_employee_is_not_readable_by_known_id_for_nonadmin(self):
        archived = self.env['hr.employee'].create({'name': 'Hidden Archived Employee', 'active': False})
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/hr/employees/{archived.id}')
        self.assertEqual((res.status_code, res.json()['code']), (404, 'not_found'))

    def test_employee_cannot_be_their_own_manager(self):
        self.authenticate('hr_emp_admin', 'hr_emp_admin_pass_123')
        res = self.api('PATCH', f'/api/v1/hr/employees/{self.hr_other.id}', {
            'parent_id': self.hr_other.id,
        })
        self.assertEqual(res.status_code, 422, res.text)
        self.assertEqual((res.json()['code'], res.json()['field']), ('invalid', 'parent_id'))

    def test_work_email_patch_does_not_rename_login(self):
        employee = self.env['hr.employee'].create({
            'name': 'Login Stability', 'work_email': 'fixed.login@example.com',
        })
        self.authenticate('hr_emp_admin', 'hr_emp_admin_pass_123')
        res = self.api('POST', f'/api/v1/hr/employees/{employee.id}/access', {
            'password': 'valid pass', 'role': 'employee',
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['access']['login'], 'fixed.login@example.com')
        res = self.api('PATCH', f'/api/v1/hr/employees/{employee.id}', {
            'work_email': 'changed.login@example.com',
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['access']['login'], 'fixed.login@example.com')
