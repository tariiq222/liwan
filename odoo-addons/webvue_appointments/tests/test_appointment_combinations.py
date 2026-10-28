# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import WebVueAppointmentsCase

COMBINATIONS = '/api/v1/appointments/combinations'


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentCombinations(WebVueAppointmentsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.room = cls.env['resource.resource'].create({'name': 'Room 1', 'resource_type': 'material'})
        cls.device = cls.env['resource.resource'].create({'name': 'Device 1', 'resource_type': 'material'})

    def _manager(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')

    def test_view_reads_the_whitelisted_shape_of_its_company(self):
        foreign = self._foreign_company_records()[2]
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', COMBINATIONS).json()
        ids = {row['id'] for row in body['items']}
        self.assertIn(self.combination.id, ids)
        self.assertNotIn(foreign.id, ids)
        detail = self.api('GET', '%s/%d' % (COMBINATIONS, self.combination.id)).json()
        self.assertEqual(detail, {
            'id': self.combination.id, 'name': 'Room A', 'resource_ids': self.combination.resource_ids.ids,
            'forced_calendar_id': None, 'active': True,
        })
        self.assertEqual(self.api('GET', '%s/%d' % (COMBINATIONS, foreign.id)).status_code, 404)

    def test_manage_creates_updates_and_archives(self):
        calendar = self.env['resource.calendar'].create({'name': 'Forced', 'company_id': self.env.company.id})
        self._manager()
        body = self.api('POST', COMBINATIONS, json={'resource_ids': [self.room.id, self.device.id], 'forced_calendar_id': calendar.id}).json()
        created = self.env['resource.booking.combination'].browse(body['id'])
        self.assertEqual((created.company_id, set(created.resource_ids.ids), created.forced_calendar_id),
                         (self.env.company, {self.room.id, self.device.id}, calendar))
        path = '%s/%d' % (COMBINATIONS, created.id)
        body = self.api('PATCH', path, json={'resource_ids': [self.room.id], 'forced_calendar_id': None}).json()
        self.assertEqual((body['resource_ids'], body['forced_calendar_id']), ([self.room.id], None))
        self.assertFalse(self.api('POST', path + '/archive').json()['active'])
        self.assertIn(created.id, {row['id'] for row in self.api('GET', COMBINATIONS + '?active=false').json()['items']})
        self.assertTrue(self.api('POST', path + '/unarchive').json()['active'])

    def test_a_combination_a_type_still_offers_cannot_be_archived(self):
        combination = self.env['resource.booking.combination'].create({
            'company_id': self.env.company.id, 'resource_ids': [(6, 0, self.room.ids)],
        })
        booking_type = self.env['resource.booking.type'].create({
            'name': 'Linked type', 'combination_rel_ids': [(0, 0, {'combination_id': combination.id})],
        })
        self.env.flush_all()
        self._manager()
        path = '%s/%d/archive' % (COMBINATIONS, combination.id)
        result = self.api('POST', path)
        self.assertEqual((result.status_code, result.json()['code'], result.json()['field']), (422, 'invalid', 'combination_id'))
        self.assertIn('Linked type', result.json()['message'])
        self.assertTrue(combination.active)
        # Removing it from the type first lets the combination go.
        type_path = '/api/v1/appointments/types/%d' % booking_type.id
        self.assertEqual(self.api('PATCH', type_path, json={'combination_ids': []}).status_code, 200)
        self.assertEqual(self.api('POST', path).status_code, 200)

    def test_a_combination_lists_its_archived_resources(self):
        combination = self.env['resource.booking.combination'].create({
            'company_id': self.env.company.id, 'resource_ids': [(6, 0, self.room.ids)],
        })
        self.room.active = False
        self.env.flush_all()
        self._manager()
        self.assertEqual(self.api('GET', '%s/%d' % (COMBINATIONS, combination.id)).json()['resource_ids'], self.room.ids)

    def test_invalid_bodies_are_422_and_foreign_ids_are_not_accepted(self):
        other = self._foreign_company_records()[0]
        foreign_resource = self.env['resource.resource'].create({'name': 'Foreign', 'company_id': other.id})
        foreign_calendar = self.env['resource.calendar'].create({'name': 'Foreign calendar', 'company_id': other.id})
        self._manager()
        for body, field in (
            ({}, 'resource_ids'), ({'resource_ids': []}, 'resource_ids'), ({'resource_ids': 'x'}, 'resource_ids'),
            ({'resource_ids': [foreign_resource.id]}, 'resource_ids'),
            ({'resource_ids': [self.room.id], 'forced_calendar_id': foreign_calendar.id}, 'forced_calendar_id'),
            ({'resource_ids': [self.room.id], 'company_id': 1}, 'company_id'),
        ):
            result = self.api('POST', COMBINATIONS, json=body)
            self.assertEqual((result.status_code, result.json().get('field')), (422, field), (body, result.text))

    def test_another_company_combination_is_not_found_for_manage(self):
        foreign = self._foreign_company_records()[2]
        self._manager()
        result = self.api('PATCH', '%s/%d' % (COMBINATIONS, foreign.id), json={'resource_ids': [self.room.id]})
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))

    def test_view_cannot_change_combinations(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        path = '%s/%d' % (COMBINATIONS, self.combination.id)
        for method, url, body in (('POST', COMBINATIONS, {'resource_ids': [self.room.id]}), ('PATCH', path, {}), ('POST', path + '/archive', None)):
            self.assertEqual(self.api(method, url, json=body).status_code, 403, method)

    def test_a_capability_held_in_another_company_is_refused_on_every_combination_route(self):
        path = '%s/%d' % (COMBINATIONS, self.combination.id)
        self._assert_forbidden_in_the_current_company([
            ('GET', COMBINATIONS, None), ('GET', path, None), ('POST', COMBINATIONS, {'resource_ids': [self.room.id]}),
            ('PATCH', path, {}), ('POST', path + '/archive', None), ('POST', path + '/unarchive', None),
        ])
