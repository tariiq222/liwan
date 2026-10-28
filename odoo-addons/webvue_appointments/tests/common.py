# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueAppointmentsCase(WebVueApiCase):
    """The shared webvue_api fixture plus one user per Appointments capability and a booking."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        service = cls.env['webvue.access.service']
        company = cls.env.company
        # The built-in employee role grants appointments.bookings.read and the sync adds its group.
        service._webvue_replace_assignments(cls.employee, [{
            'role_id': cls.env.ref('webvue_core.role_employee').id, 'company_id': company.id,
        }])
        cls.manager = new_test_user(
            cls.env, login='appointments_manager', password='appointments_manager_pass_123',
            name='Appointments Manager', groups='webvue_core.group_employee',
        )
        # Staff hold the employee role as well: the engine's slot search reads hr.employee records.
        service._webvue_replace_assignments(cls.manager, [{
            'role_id': cls.env.ref(xmlid).id, 'company_id': company.id,
        } for xmlid in ('webvue_core.role_employee', 'webvue_appointments.role_appointments_manager')])
        cls.booker = new_test_user(
            cls.env, login='appointments_booker', name='Appointments Booker',
            groups='webvue_core.group_employee,webvue_appointments.group_cap_appointments_bookings_write',
        )
        cls.outsider = new_test_user(
            cls.env, login='appointments_outsider', password='appointments_outsider_pass_123',
            name='No Appointments access', groups='base.group_user',
        )
        cls.booking_type = cls.env['resource.booking.type'].create({'name': 'Consultation', 'duration': 0.5})
        cls.combination = cls._create_combination(company, 'Room A')
        cls.booking = cls._create_booking(cls.booking_type, cls.combination)

    @classmethod
    def _create_combination(cls, company, name, user=None):
        resource = cls.env['resource.resource'].create({'name': name, 'user_id': user.id if user else False})
        return cls.env['resource.booking.combination'].create({
            'company_id': company.id, 'resource_ids': [(6, 0, resource.ids)],
        })

    @classmethod
    def _create_booking(cls, booking_type, combination, partner=None):
        booking_type.combination_rel_ids = [(0, 0, {'combination_id': combination.id})]
        return cls.env['resource.booking'].with_context(mail_auto_subscribe_no_notify=True).create({
            'type_id': booking_type.id,
            'combination_id': combination.id,
            'partner_ids': [(6, 0, (partner or cls.env.user.partner_id).ids)],
        })

    @classmethod
    def _foreign_company_records(cls):
        """A second company with its own type, combination and booking."""
        other = cls.env['res.company'].create({'name': 'Other appointments company'})
        booking_type = cls.env['resource.booking.type'].create({'name': 'Foreign', 'company_id': other.id})
        combination = cls._create_combination(other, 'Foreign room')
        return other, booking_type, combination, cls._create_booking(booking_type, combination)

    @classmethod
    def _create_cross_company_user(cls):
        """A manager of the main company only whose current company is another one: holds no capability there."""
        other = cls.env['res.company'].create({'name': 'Appointments current company'})
        user = new_test_user(
            cls.env, login='appointments_cross', password='appointments_cross_pass_123',
            name='Manager of another company', groups='webvue_core.group_employee',
            company_ids=[(6, 0, [cls.env.company.id, other.id])],
        )
        # Assignments are replaced in the user's current company; the user then switches to the other one.
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': cls.env.ref('webvue_appointments.role_appointments_manager').id,
            'company_id': cls.env.company.id,
        }])
        user.company_id = other
        return user

    def _assert_forbidden_in_the_current_company(self, requests):
        """Every ``(method, path, body)`` is refused with 403 for a user who holds the capability only in another company."""
        self._create_cross_company_user()
        self.authenticate('appointments_cross', 'appointments_cross_pass_123')
        for method, path, body in requests:
            result = self.api(method, path, json=body)
            self.assertEqual((result.status_code, result.json().get('code')), (403, 'forbidden'), (method, path))
