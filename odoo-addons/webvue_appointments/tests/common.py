# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueAppointmentsCase(WebVueApiCase):
    """The shared webvue_api fixture plus an Appointments manager user and one booking type."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(
            cls.env, login='appointments_manager', password='appointments_manager_pass_123',
            name='Appointments Manager', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref('webvue_appointments.role_appointments_manager').id,
            'company_id': cls.env.company.id,
        }])
        cls.outsider = new_test_user(
            cls.env, login='appointments_outsider', password='appointments_outsider_pass_123',
            name='No Appointments access', groups='base.group_user',
        )
        cls.booking_type = cls.env['resource.booking.type'].create({'name': 'Consultation', 'duration': 0.5})
