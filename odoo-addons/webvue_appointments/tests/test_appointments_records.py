# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import WebVueAppointmentsCase
from odoo.addons.webvue_api.tests.common import set_probe_feature


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentsRecords(WebVueAppointmentsCase):

    def test_employee_reads_the_whitelisted_shape(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/appointments/records')
        self.assertEqual(result.status_code, 200)
        body = result.json()
        item = next(row for row in body['items'] if row['id'] == self.record.id)
        self.assertEqual(set(item), {'id', 'name'})
        self.assertGreaterEqual(body['total'], 1)

    def test_manager_reads_records(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        result = self.api('GET', '/api/v1/appointments/records')
        self.assertEqual(result.status_code, 200)

    def test_invalid_limit_is_a_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/appointments/records?limit=-1')
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_a_user_without_the_read_capability_gets_403_forbidden(self):
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        result = self.api('GET', '/api/v1/appointments/records')
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_the_manage_capability_writes_and_the_employee_role_does_not(self):
        Record = self.env['webvue.appointments.record']
        created = Record.with_user(self.manager).create({'name': 'Managed'})
        created.with_user(self.manager).write({'name': 'Managed again'})
        self.assertEqual(created.name, 'Managed again')
        with self.assertRaises(AccessError):
            Record.with_user(self.employee).create({'name': 'Not allowed'})

    def test_a_closed_feature_refuses_the_route(self):
        set_probe_feature(self, key='appointments.enabled', enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/appointments/records')
        self.assertEqual(result.status_code, 403)
