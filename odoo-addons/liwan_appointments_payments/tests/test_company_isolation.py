# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the paid-booking GET routes."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)
from odoo.addons.liwan_appointments.tests.test_company_isolation import (
    AppointmentsIsolationFixture,
)

EXPECTED_GET_RECORD_ROUTES = 2


@tagged('post_install', '-at_install', 'liwan')
class TestPaidBookingCompanyIsolation(AppointmentsIsolationFixture, CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_appointments_isolation()

    def test_record_matrix(self):
        self.assert_record_matrix({
            'type': '/api/v1/appointments/types/{}/payment',
            'booking': '/api/v1/appointments/bookings/{}/payment',
        })

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_appointments_payments', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/appointments/types/<int:type_id>/payment',
    '/api/v1/appointments/bookings/<int:booking_id>/payment',
), source='liwan_appointments_payments/tests/test_company_isolation.py')
