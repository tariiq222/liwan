# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the Appointments GET record routes."""
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
    exempt_isolation_route,
)

# Types, combinations and bookings plus the type slots route and the guest pair.
EXPECTED_GET_RECORD_ROUTES = 6


class AppointmentsIsolationFixture:
    """Roles and one type, combination and booking per company of the isolation matrix.

    Not a test case: webvue_appointments_payments reuses it for its own routes.
    """

    @classmethod
    def setup_appointments_isolation(cls):
        cls.by_tag = {'p': cls.company_p, 'p1': cls.company_p1, 'p2': cls.company_p2, 'c': cls.company_c}
        Assignment = cls.env['webvue.access.assignment'].sudo()
        manager = cls.env.ref('webvue_appointments.role_appointments_manager')
        for company in cls.by_tag.values():
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': manager.id, 'company_id': company.id})
        cls.recs = {}
        for tag, company in cls.by_tag.items():
            booking_type = cls.env['resource.booking.type'].create({
                'name': f'Type {tag}', 'duration': 0.5, 'company_id': company.id,
            })
            resource = cls.env['resource.resource'].create({
                'name': f'Room {tag}', 'company_id': company.id, 'calendar_id': company.resource_calendar_id.id,
            })
            combination = cls.env['resource.booking.combination'].create({
                'company_id': company.id, 'resource_ids': [(6, 0, resource.ids)],
            })
            booking_type.combination_rel_ids = [(0, 0, {'combination_id': combination.id})]
            booking = cls.env['resource.booking'].with_context(mail_auto_subscribe_no_notify=True).create({
                'type_id': booking_type.id, 'combination_id': combination.id,
                'partner_ids': [(6, 0, cls.iso_user.partner_id.ids)],
            })
            cls.recs[tag] = {'type': booking_type, 'combination': combination, 'booking': booking}

    def assert_record_matrix(self, templates):
        """`templates` maps a record kind to its path template; the owner reads it, any other company gets 404."""
        for current, company in self.by_tag.items():
            self.env_in(company)
            for kind, template in templates.items():
                self.assertVisible(template.format(self.recs[current][kind].id))
            for tag, rec in self.recs.items():
                if tag == current:
                    continue
                for kind, template in templates.items():
                    with self.subTest(current=current, hidden=tag, route=template):
                        self.assertHiddenEveryWay('GET', template.format(rec[kind].id), rec[kind].id)


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentsCompanyIsolation(AppointmentsIsolationFixture, CompanyIsolationCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.setup_appointments_isolation()

    def test_record_matrix(self):
        self.assert_record_matrix({
            'booking': '/api/v1/appointments/bookings/{}',
            'combination': '/api/v1/appointments/combinations/{}',
            'type': '/api/v1/appointments/types/{}',
        })

    def test_slots_route_is_company_scoped(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            # The engine's slot search reads working-time records of the stock fixtures, which a branch
            # session cannot always open; the isolation question is only that the own type is not hidden.
            own = self.api('GET', f'/api/v1/appointments/types/{self.recs[current]["type"].id}/slots')
            self.assertNotEqual(own.status_code, 404, own.text[:200])
            for tag, rec in self.recs.items():
                if tag != current:
                    self.assertHiddenEveryWay('GET', f'/api/v1/appointments/types/{rec["type"].id}/slots', rec['type'].id)

    def test_lists_never_show_another_company(self):
        for current, company in self.by_tag.items():
            self.env_in(company)
            for path, kind in (
                ('/api/v1/appointments/bookings', 'booking'), ('/api/v1/appointments/types', 'type'),
                ('/api/v1/appointments/combinations', 'combination'),
            ):
                ids = {item['id'] for item in self.assertVisible(path).json()['items']}
                self.assertIn(self.recs[current][kind].id, ids, path)
                for tag, rec in self.recs.items():
                    if tag != current:
                        self.assertNotIn(rec[kind].id, ids, f'{path}: {tag} leaked into {current}')

    def test_missing_capability_in_the_same_company_stays_forbidden(self):
        """The employee role reads bookings but lacks the write capability the slots route needs."""
        user = new_test_user(
            self.env, login='iso_appt_nocap', password='iso_appt_nocap_pass_123', name='No appointments',
            groups='webvue_core.group_employee', company_id=self.company_p.id,
        )
        user.company_ids = [(6, 0, [self.company_p.id])]
        self.env['webvue.access.assignment'].sudo().create({
            'user_id': user.id, 'role_id': self.env.ref('webvue_core.role_employee').id,
            'company_id': self.company_p.id,
        })
        self.authenticate('iso_appt_nocap', 'iso_appt_nocap_pass_123')
        response = self.api('GET', f'/api/v1/appointments/types/{self.recs["p"]["type"].id}/slots')
        self.assertEqual((response.status_code, response.json().get('code')), (403, 'forbidden'))

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'webvue_appointments', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes((
    '/api/v1/appointments/bookings/<int:booking_id>',
    '/api/v1/appointments/combinations/<int:combination_id>',
    '/api/v1/appointments/types/<int:type_id>',
    '/api/v1/appointments/types/<int:type_id>/slots',
), source='webvue_appointments/tests/test_company_isolation.py')
for _pattern in (
    '/api/v1/public/appointments/bookings/<int:booking_id>',
    '/api/v1/public/appointments/bookings/<int:booking_id>/slots',
):
    exempt_isolation_route(_pattern, 'public route: the booking access token authorizes one booking, no session company applies')
