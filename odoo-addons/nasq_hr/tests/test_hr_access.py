# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged
from odoo.tests.common import HOST, Opener
from odoo.http import root

from .common import NasqHrCase


@tagged('post_install', '-at_install', 'nasq')
class TestHrAccess(NasqHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_access_admin', password='hr_access_admin_pass_123',
            name='Access Admin', groups='nasq_core.group_customer_admin',
        )
        cls.department = cls.env['hr.department'].create({'name': 'Access Department'})

    def _employee(self, name='Access Employee', email='access.employee@example.com'):
        return self.env['hr.employee'].create({
            'name': name,
            'work_email': email,
            'department_id': self.department.id,
        })

    def _use_session(self, sid):
        self.opener = Opener(self)
        self.opener.cookies.set('session_id', sid, domain=HOST)

    def test_grant_patch_regrant_and_revoke(self):
        employee = self._employee()
        self.authenticate('hr_access_admin', 'hr_access_admin_pass_123')
        result = self.api('POST', f'/api/v1/hr/employees/{employee.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['access']['role'], 'employee')
        result = self.api('PATCH', f'/api/v1/hr/employees/{employee.id}/access', {'role': 'admin'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['access']['role'], 'admin')
        result = self.api('DELETE', f'/api/v1/hr/employees/{employee.id}/access')
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()['access']['active'])
        result = self.api('POST', f'/api/v1/hr/employees/{employee.id}/access', {
            'password': 'access pass 2', 'role': 'employee',
        })
        self.assertEqual(result.status_code, 200)
        self.assertTrue(result.json()['access']['active'])

    def test_business_errors_are_structured(self):
        self.authenticate('hr_access_admin', 'hr_access_admin_pass_123')
        missing_email = self._employee(email=False)
        result = self.api('POST', f'/api/v1/hr/employees/{missing_email.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        self.assertEqual((result.status_code, result.json()['code']), (422, 'email_required'))
        weak = self._employee(name='Weak Access')
        result = self.api('POST', f'/api/v1/hr/employees/{weak.id}/access', {
            'password': ' short ', 'role': 'employee',
        })
        self.assertEqual((result.status_code, result.json()['code']), (422, 'weak_password'))
        result = self.api('POST', f'/api/v1/hr/employees/{weak.id}/access', {
            'password': 'access pass', 'role': 'vendor',
        })
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid_role'))

        archived = self._employee(name='Archived Access')
        self.env['hr.employee'].browse(archived.id).write({'active': False})
        result = self.api('POST', f'/api/v1/hr/employees/{archived.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        self.assertEqual((result.status_code, result.json()['code']), (422, 'employee_archived'))

        first = self._employee(name='Duplicate Access', email='duplicate.access@example.com')
        self.api('POST', f'/api/v1/hr/employees/{first.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        duplicate = self._employee(name='Duplicate Two', email=' DUPLICATE.ACCESS@example.com ')
        result = self.api('POST', f'/api/v1/hr/employees/{duplicate.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        self.assertEqual((result.status_code, result.json()['code']), (422, 'login_taken'))

    def test_vendor_and_plain_employee_are_forbidden(self):
        vendor = new_test_user(
            self.env, login='hr_access_vendor', password='hr_access_vendor_pass',
            groups='nasq_core.group_vendor_support',
        )
        vendor_employee = self._employee(name='Vendor Access')
        vendor_employee.write({'user_id': vendor.id})
        self.authenticate('hr_access_admin', 'hr_access_admin_pass_123')
        result = self.api('POST', f'/api/v1/hr/employees/{vendor_employee.id}/archive', {})
        self.assertEqual((result.status_code, result.json()['code']), (403, 'vendor_protected'))
        result = self.api('POST', f'/api/v1/hr/employees/{vendor_employee.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        self.assertEqual((result.status_code, result.json()['code']), (403, 'vendor_protected'))
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('POST', f'/api/v1/hr/employees/{vendor_employee.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_self_guards_and_other_sessions_after_reset_and_revoke(self):
        own_employee = self.env['hr.employee'].create({
            'name': 'Access Admin Employee', 'user_id': self.admin.id,
        })
        self.authenticate('hr_access_admin', 'hr_access_admin_pass_123')
        result = self.api('POST', f'/api/v1/hr/employees/{own_employee.id}/access', {
            'password': 'access pass', 'role': 'employee',
        })
        self.assertEqual((result.status_code, result.json()['code']), (422, 'self_role'))
        result = self.api('DELETE', f'/api/v1/hr/employees/{own_employee.id}/access')
        self.assertEqual((result.status_code, result.json()['code']), (422, 'self_deactivate'))

        target = self._employee(name='Session Target', email='session.target@example.com')
        result = self.api('POST', f'/api/v1/hr/employees/{target.id}/access', {
            'password': 'target pass', 'role': 'employee',
        })
        self.assertEqual(result.status_code, 200)
        target_session = self.authenticate('session.target@example.com', 'target pass')
        target_cookie = target_session.sid
        root.session_store.save(target_session)
        untouched_session = self.authenticate('api_emp', 'api_emp_pass_123')
        untouched_cookie = untouched_session.sid
        root.session_store.save(target_session)
        root.session_store.save(untouched_session)
        self.authenticate('hr_access_admin', 'hr_access_admin_pass_123')
        root.session_store.save(target_session)
        root.session_store.save(untouched_session)
        result = self.api('PATCH', f'/api/v1/hr/employees/{target.id}/access', {
            'password': 'target pass 2',
        })
        self.assertEqual(result.status_code, 200)
        self._use_session(target_cookie)
        target_after_reset = self.url_open('/api/v1/me')
        self.assertEqual(target_after_reset.status_code, 403)
        self._use_session(untouched_cookie)
        untouched_after_reset = self.url_open('/api/v1/me')
        self.assertEqual(untouched_after_reset.status_code, 200)

        self.authenticate('hr_access_admin', 'hr_access_admin_pass_123')
        result = self.api('PATCH', f'/api/v1/hr/employees/{target.id}/access', {
            'password': 'target pass 3',
        })
        self.assertEqual(result.status_code, 200)
        target_session = self.authenticate('session.target@example.com', 'target pass 3')
        target_cookie = target_session.sid
        root.session_store.save(target_session)
        self.authenticate('hr_access_admin', 'hr_access_admin_pass_123')
        root.session_store.save(target_session)
        result = self.api('DELETE', f'/api/v1/hr/employees/{target.id}/access')
        self.assertEqual(result.status_code, 200)
        self._use_session(target_cookie)
        target_after_revoke = self.url_open('/api/v1/me')
        self.assertEqual(target_after_revoke.status_code, 403)
