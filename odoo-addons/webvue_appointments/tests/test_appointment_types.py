# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVueAppointmentsCase
from odoo.addons.webvue_api.controllers.common import DEFAULT_PAGE_LIMIT
from odoo.addons.webvue_api.tests.common import set_probe_feature


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentTypes(WebVueAppointmentsCase):

    def test_employee_reads_the_whitelisted_shape(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/appointments/types')
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        item = next((row for row in body['items'] if row['id'] == self.booking_type.id), None)
        self.assertEqual(item, {'id': self.booking_type.id, 'name': 'Consultation', 'duration_minutes': 30}, body)
        self.assertGreaterEqual(body['total'], 1)

    def test_another_company_type_is_not_listed(self):
        foreign = self._foreign_company_records()[1]
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        ids = {row['id'] for row in self.api('GET', '/api/v1/appointments/types').json()['items']}
        self.assertNotIn(foreign.id, ids)

    def test_invalid_limit_is_a_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/appointments/types?limit=-1')
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_a_zero_limit_returns_the_default_page_not_everything(self):
        self.env['resource.booking.type'].create([{'name': 'Bulk %d' % index} for index in range(DEFAULT_PAGE_LIMIT)])
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/appointments/types?limit=0').json()
        self.assertEqual(len(body['items']), DEFAULT_PAGE_LIMIT)
        self.assertGreater(body['total'], DEFAULT_PAGE_LIMIT)

    def test_a_user_without_the_view_capability_gets_403_forbidden(self):
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        result = self.api('GET', '/api/v1/appointments/types')
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_the_view_route_answers_200_for_view_and_403_for_the_outsider(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/appointments/types').status_code, 200)
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/appointments/types').status_code, 403)

    def test_a_closed_feature_refuses_the_route(self):
        set_probe_feature(self, key='appointments.enabled', enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', '/api/v1/appointments/types')
        self.assertEqual(result.status_code, 403)
