# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVueAppointmentsCase
from odoo.addons.webvue_api.controllers.common import DEFAULT_PAGE_LIMIT
from odoo.addons.webvue_api.tests.common import set_probe_feature

TYPES = '/api/v1/appointments/types'


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentTypes(WebVueAppointmentsCase):

    def _manager(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')

    def test_employee_reads_the_whitelisted_shape(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', TYPES)
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        item = next((row for row in body['items'] if row['id'] == self.booking_type.id), None)
        self.assertEqual(item, {
            'id': self.booking_type.id, 'name': 'Consultation', 'duration_minutes': 30, 'slot_minutes': 30,
            'modifications_deadline_hours': 24, 'location': None, 'videocall_location': None,
            'resource_calendar_id': self.booking_type.resource_calendar_id.id,
            'combination_ids': [self.combination.id], 'active': True,
        }, body)
        self.assertGreaterEqual(body['total'], 1)
        detail = self.api('GET', '%s/%d' % (TYPES, self.booking_type.id))
        self.assertEqual(detail.json(), item)

    def test_another_company_type_is_not_listed_and_not_found(self):
        foreign = self._foreign_company_records()[1]
        self._manager()
        ids = {row['id'] for row in self.api('GET', TYPES).json()['items']}
        self.assertNotIn(foreign.id, ids)
        for method in ('GET', 'PATCH'):
            result = self.api(method, '%s/%d' % (TYPES, foreign.id), json={} if method == 'PATCH' else None)
            self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'), method)
        result = self.api('POST', '%s/%d/archive' % (TYPES, foreign.id))
        self.assertEqual(result.status_code, 404)

    def test_invalid_limit_is_a_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', TYPES + '?limit=-1')
        self.assertEqual((result.status_code, result.json()['code']), (422, 'invalid'))

    def test_a_zero_limit_returns_the_default_page_not_everything(self):
        self.env['resource.booking.type'].create([{'name': 'Bulk %d' % index} for index in range(DEFAULT_PAGE_LIMIT)])
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', TYPES + '?limit=0').json()
        self.assertEqual(len(body['items']), DEFAULT_PAGE_LIMIT)
        self.assertGreater(body['total'], DEFAULT_PAGE_LIMIT)

    def test_a_user_without_the_view_capability_gets_403_forbidden(self):
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        result = self.api('GET', TYPES)
        self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'))

    def test_a_closed_feature_refuses_the_route(self):
        set_probe_feature(self, key='appointments.enabled', enabled=False)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', TYPES).status_code, 403)

    def test_a_capability_held_in_another_company_is_refused_on_every_type_route(self):
        path = '%s/%d' % (TYPES, self.booking_type.id)
        self._assert_forbidden_in_the_current_company([
            ('GET', TYPES, None), ('GET', path, None), ('POST', TYPES, {'name': 'X'}),
            ('PATCH', path, {'name': 'Y'}), ('POST', path + '/archive', None), ('POST', path + '/unarchive', None),
        ])

    def test_manage_creates_a_type_in_the_current_company_with_minutes_and_combinations(self):
        self._manager()
        result = self.api('POST', TYPES, json={
            'name': 'Long visit', 'duration_minutes': 45, 'slot_minutes': 15, 'modifications_deadline_hours': 6,
            'location': 'Clinic', 'videocall_location': 'https://meet.example.com/x',
            'combination_ids': [self.combination.id],
        })
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        created = self.env['resource.booking.type'].browse(body['id'])
        self.assertEqual((created.company_id, created.duration, created.slot_duration, created.modifications_deadline),
                         (self.env.company, 0.75, 0.25, 6))
        self.assertEqual((body['duration_minutes'], body['slot_minutes'], body['location'], body['combination_ids']),
                         (45, 15, 'Clinic', [self.combination.id]))
        self.assertEqual(body['resource_calendar_id'], self.env.company.resource_calendar_id.id)

    def test_a_new_type_takes_its_slot_and_deadline_from_the_settings(self):
        self.env['webvue.appointment.settings'].create({
            'company_id': self.env.company.id, 'default_slot_minutes': 20, 'modification_deadline_hours': 5,
        })
        self._manager()
        body = self.api('POST', TYPES, json={'name': 'Defaults'}).json()
        self.assertEqual((body['duration_minutes'], body['slot_minutes'], body['modifications_deadline_hours']), (30, 20, 5))

    def test_patch_updates_fields_and_replaces_the_combination_set_in_order(self):
        second = self._create_combination(self.env.company, 'Room B')
        third = self._create_combination(self.env.company, 'Room C')
        self._manager()
        path = '%s/%d' % (TYPES, self.booking_type.id)
        body = self.api('PATCH', path, json={'name': 'Renamed', 'duration_minutes': 60, 'combination_ids': [third.id, self.combination.id, second.id]}).json()
        self.assertEqual((body['name'], body['duration_minutes'], body['combination_ids']),
                         ('Renamed', 60, [third.id, self.combination.id, second.id]))
        body = self.api('PATCH', path, json={'combination_ids': [second.id]}).json()
        self.assertEqual(body['combination_ids'], [second.id])
        self.assertEqual(self.api('PATCH', path, json={'location': None}).json()['location'], None)
        # A booking of a dropped combination is untouched by the relation change.
        self.assertTrue(self.booking.exists())

    def test_archive_and_unarchive_toggle_the_type_and_the_active_filter(self):
        self._manager()
        path = '%s/%d' % (TYPES, self.booking_type.id)
        self.assertFalse(self.api('POST', path + '/archive').json()['active'])
        listed = {row['id'] for row in self.api('GET', TYPES).json()['items']}
        archived = {row['id'] for row in self.api('GET', TYPES + '?active=false').json()['items']}
        self.assertNotIn(self.booking_type.id, listed)
        self.assertIn(self.booking_type.id, archived)
        self.assertEqual(self.api('GET', path).json()['active'], False)
        self.assertTrue(self.api('POST', path + '/unarchive').json()['active'])
        self.assertEqual(self.api('GET', TYPES + '?active=maybe').status_code, 422)

    def test_invalid_bodies_are_422_with_the_field(self):
        self._manager()
        path = '%s/%d' % (TYPES, self.booking_type.id)
        foreign_combination = self._foreign_company_records()[2]
        for method, url, body, field in (
            ('POST', TYPES, {}, 'name'),
            ('POST', TYPES, {'name': '  '}, 'name'),
            ('POST', TYPES, {'name': 'X', 'duration_minutes': 0}, 'duration_minutes'),
            ('POST', TYPES, {'name': 'X', 'duration_minutes': 1.5}, 'duration_minutes'),
            ('POST', TYPES, {'name': 'X', 'slot_minutes': 4}, 'slot_minutes'),
            ('POST', TYPES, {'name': 'X', 'modifications_deadline_hours': 721}, 'modifications_deadline_hours'),
            ('POST', TYPES, {'name': 'X', 'active': False}, 'active'),
            ('POST', TYPES, {'name': 'X', 'company_id': 1}, 'company_id'),
            ('PATCH', path, {'combination_ids': [foreign_combination.id]}, 'combination_ids'),
            ('PATCH', path, {'combination_ids': [self.combination.id, self.combination.id]}, 'combination_ids'),
            ('PATCH', path, {'combination_ids': 'x'}, 'combination_ids'),
            ('PATCH', path, {'resource_calendar_id': 999999999}, 'resource_calendar_id'),
        ):
            result = self.api(method, url, json=body)
            self.assertEqual((result.status_code, result.json().get('field')), (422, field), (body, result.text))

    def test_the_calendar_must_belong_to_the_current_company(self):
        other = self._foreign_company_records()[0]
        foreign_calendar = self.env['resource.calendar'].create({'name': 'Foreign calendar', 'company_id': other.id})
        own_calendar = self.env['resource.calendar'].create({'name': 'Own calendar', 'company_id': self.env.company.id})
        self._manager()
        path = '%s/%d' % (TYPES, self.booking_type.id)
        self.assertEqual(self.api('PATCH', path, json={'resource_calendar_id': foreign_calendar.id}).status_code, 422)
        self.assertEqual(self.api('PATCH', path, json={'resource_calendar_id': own_calendar.id}).json()['resource_calendar_id'], own_calendar.id)

    def test_view_and_book_cannot_change_types(self):
        path = '%s/%d' % (TYPES, self.booking_type.id)
        for login, password in (('api_emp', 'api_emp_pass_123'), ('appointments_booker', 'appointments_booker')):
            self.authenticate(login, password)
            for method, url, body in (('POST', TYPES, {'name': 'X'}), ('PATCH', path, {'name': 'Y'}), ('POST', path + '/archive', None)):
                result = self.api(method, url, json=body)
                self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'), (login, method))
