# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanAppointmentsCase

RESOURCES = '/api/v1/appointments/resources'


@tagged('post_install', '-at_install', 'liwan')
class TestAppointmentResources(LiwanAppointmentsCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee_resource = cls.env['resource.resource'].create({
            'name': 'Dr Employee', 'resource_type': 'user', 'user_id': cls.employee.id,
        })
        cls.room = cls.env['resource.resource'].create({'name': 'Meeting room', 'resource_type': 'material'})

    def _manager(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')

    def test_view_lists_resources_filtered_by_type_and_name_in_the_current_company(self):
        foreign = self.env['resource.resource'].create({
            'name': 'Foreign room', 'resource_type': 'material', 'company_id': self._foreign_company_records()[0].id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', RESOURCES).json()
        ids = {row['id'] for row in body['items']}
        self.assertLessEqual({self.employee_resource.id, self.room.id}, ids)
        self.assertNotIn(foreign.id, ids)
        shape = next(row for row in body['items'] if row['id'] == self.room.id)
        self.assertEqual(shape, {
            'id': self.room.id, 'name': 'Meeting room', 'type': 'material',
            'calendar_id': self.room.calendar_id.id, 'active': True,
        })
        materials = {row['id'] for row in self.api('GET', RESOURCES + '?type=material').json()['items']}
        self.assertIn(self.room.id, materials)
        self.assertNotIn(self.employee_resource.id, materials)
        found = self.api('GET', RESOURCES + '?type=user&q=employee').json()
        self.assertEqual([row['id'] for row in found['items']], [self.employee_resource.id])
        self.assertEqual(self.api('GET', RESOURCES + '?type=robot').status_code, 422)

    def test_manage_creates_and_updates_a_material_resource(self):
        self._manager()
        body = self.api('POST', RESOURCES, json={'name': 'Scanner'}).json()
        resource = self.env['resource.resource'].browse(body['id'])
        self.assertEqual((body['type'], resource.resource_type, resource.company_id), ('material', 'material', self.env.company))
        calendar = self.env['resource.calendar'].create({'name': 'Device hours', 'company_id': self.env.company.id})
        path = '%s/%d' % (RESOURCES, resource.id)
        body = self.api('PATCH', path, json={'name': 'Scanner 2', 'calendar_id': calendar.id}).json()
        self.assertEqual((body['name'], body['calendar_id']), ('Scanner 2', calendar.id))

    def test_employee_resources_are_refused_on_every_write_route(self):
        self._manager()
        path = '%s/%d' % (RESOURCES, self.employee_resource.id)
        for method, url, body in (
            ('PATCH', path, {'name': 'Hijacked'}), ('POST', path + '/archive', None), ('POST', path + '/unarchive', None),
        ):
            result = self.api(method, url, json=body)
            self.assertEqual((result.status_code, result.json()['code']), (403, 'forbidden'), url)
        self.assertEqual((self.employee_resource.name, self.employee_resource.active), ('Dr Employee', True))
        with self.assertRaises(AccessError):
            self.room.with_user(self.manager).unlink()

    def test_manage_archives_and_restores_a_material_resource(self):
        self._manager()
        path = '%s/%d' % (RESOURCES, self.room.id)
        self.assertFalse(self.api('POST', path + '/archive').json()['active'])
        self.assertNotIn(self.room.id, {row['id'] for row in self.api('GET', RESOURCES).json()['items']})
        self.assertIn(self.room.id, {row['id'] for row in self.api('GET', RESOURCES + '?active=false').json()['items']})
        self.assertTrue(self.api('POST', path + '/unarchive').json()['active'])

    def test_a_resource_of_an_active_combination_cannot_be_archived(self):
        combination = self.env['resource.booking.combination'].create({
            'company_id': self.env.company.id, 'resource_ids': [(6, 0, self.room.ids)],
        })
        self.env.flush_all()
        self._manager()
        result = self.api('POST', '%s/%d/archive' % (RESOURCES, self.room.id))
        self.assertEqual((result.status_code, result.json()['code'], result.json()['field']), (422, 'invalid', 'resource_id'))
        self.assertIn(combination.name, result.json()['message'])
        self.assertTrue(self.room.active)
        # An archived combination no longer uses the resource.
        combination.active = False
        self.env.flush_all()
        self.assertEqual(self.api('POST', '%s/%d/archive' % (RESOURCES, self.room.id)).status_code, 200)

    def test_another_company_resource_is_not_found(self):
        foreign = self.env['resource.resource'].create({
            'name': 'Foreign room', 'resource_type': 'material', 'company_id': self._foreign_company_records()[0].id,
        })
        self._manager()
        result = self.api('PATCH', '%s/%d' % (RESOURCES, foreign.id), json={'name': 'X'})
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))

    def test_invalid_bodies_are_422_with_the_field(self):
        self._manager()
        other = self._foreign_company_records()[0]
        foreign_calendar = self.env['resource.calendar'].create({'name': 'Foreign calendar', 'company_id': other.id})
        for body, field in (
            ({}, 'name'), ({'name': ''}, 'name'), ({'name': 'X', 'resource_type': 'user'}, 'resource_type'),
            ({'name': 'X', 'user_id': 1}, 'user_id'), ({'name': 'X', 'calendar_id': foreign_calendar.id}, 'calendar_id'),
            ({'name': 'X', 'calendar_id': 'a'}, 'calendar_id'),
        ):
            result = self.api('POST', RESOURCES, json=body)
            self.assertEqual((result.status_code, result.json().get('field')), (422, field), (body, result.text))

    def test_view_cannot_change_resources(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        path = '%s/%d' % (RESOURCES, self.room.id)
        for method, url, body in (
            ('POST', RESOURCES, {'name': 'X'}), ('PATCH', path, {'name': 'Y'}), ('POST', path + '/archive', None),
        ):
            self.assertEqual(self.api(method, url, json=body).status_code, 403, method)

    def test_a_capability_held_in_another_company_is_refused_on_every_resource_route(self):
        path = '%s/%d' % (RESOURCES, self.room.id)
        self._assert_forbidden_in_the_current_company([
            ('GET', RESOURCES, None), ('POST', RESOURCES, {'name': 'X'}), ('PATCH', path, {'name': 'Y'}),
            ('POST', path + '/archive', None), ('POST', path + '/unarchive', None),
        ])
