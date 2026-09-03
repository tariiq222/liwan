# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import HttpCase, new_test_user, tagged


@tagged('post_install', '-at_install', 'nasq')
class TestMeEndpoint(HttpCase):

    def test_anonymous_is_403(self):
        res = self.url_open('/api/v1/me')
        self.assertEqual(res.status_code, 403)

    def test_employee(self):
        new_test_user(self.env, login='emp', password='emp_password_123',
                      name='Sara', email='sara@example.com', tz='Asia/Riyadh',
                      groups='nasq_core.group_employee')
        self.authenticate('emp', 'emp_password_123')

        res = self.url_open('/api/v1/me')

        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body['login'], 'emp')
        self.assertEqual(body['name'], 'Sara')
        self.assertEqual(body['email'], 'sara@example.com')
        self.assertEqual(body['tz'], 'Asia/Riyadh')
        self.assertEqual(body['role'], 'employee')
        self.assertEqual(body['company']['id'], self.env.ref('base.main_company').id)
        self.assertEqual(set(body), {'id', 'name', 'login', 'email', 'lang', 'tz', 'role', 'company'})

    def test_customer_admin(self):
        new_test_user(self.env, login='cadmin', password='cadmin_password_123',
                      groups='nasq_core.group_customer_admin')
        self.authenticate('cadmin', 'cadmin_password_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'admin')

    def test_vendor(self):
        new_test_user(self.env, login='vendor', password='vendor_password_123',
                      groups='nasq_core.group_vendor_support')
        self.authenticate('vendor', 'vendor_password_123')
        self.assertEqual(self.url_open('/api/v1/me').json()['role'], 'vendor')
