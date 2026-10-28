# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2 import IntegrityError

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged
from odoo.tools import mute_logger

from .common import WebVueAppointmentsCase


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentsOrmAccess(WebVueAppointmentsCase):
    """Each capability group maps to ORM access on the engine models (read, write, create, unlink)."""

    def _as(self, user, model):
        return self.env[model].with_user(user)

    def _can(self, user, operation, record):
        try:
            getattr(record.with_user(user), 'check_access')(operation)
        except AccessError:
            return False
        return True

    def test_view_reads_everything_and_changes_nothing(self):
        own = self._create_booking(
            self.env['resource.booking.type'].create({'name': 'Own'}),
            self._create_combination(self.env.company, 'Own room'), partner=self.employee.partner_id,
        )
        for record in (self.booking_type, self.combination, own):
            self.assertTrue(self._can(self.employee, 'read', record), record._name)
            for operation in ('write', 'create', 'unlink'):
                self.assertFalse(self._can(self.employee, operation, record), (record._name, operation))

    def test_view_sees_only_its_own_and_assigned_bookings(self):
        self.assertNotIn(self.booking, self._as(self.employee, 'resource.booking').search([]))
        own = self._create_booking(
            self.env['resource.booking.type'].create({'name': 'Own'}),
            self._create_combination(self.env.company, 'Own room'), partner=self.employee.partner_id,
        )
        assigned = self._create_booking(
            self.env['resource.booking.type'].create({'name': 'Assigned'}),
            self._create_combination(self.env.company, 'Assigned room', user=self.employee),
        )
        visible = self._as(self.employee, 'resource.booking').search([])
        self.assertEqual(visible, own | assigned)

    def test_book_reads_and_writes_bookings_for_others_but_never_deletes(self):
        booking = self.booking.with_user(self.booker)
        self.assertEqual(booking.type_id, self.booking_type)
        booking.write({'name': 'Rescheduled for someone else'})
        created = self._as(self.booker, 'resource.booking').create({
            'type_id': self.booking_type.id, 'combination_id': self.combination.id,
            'partner_ids': [(6, 0, self.employee.partner_id.ids)],
        })
        self.assertTrue(created)
        with self.assertRaises(AccessError):
            booking.unlink()
        self.assertTrue(self._can(self.booker, 'read', self.booking_type))
        self.assertTrue(self._can(self.booker, 'read', self.combination))
        for record in (self.booking_type, self.combination):
            for operation in ('write', 'create', 'unlink'):
                self.assertFalse(self._can(self.booker, operation, record), (record._name, operation))

    def test_manage_has_full_access_to_the_four_models(self):
        type_rel = self.booking_type.combination_rel_ids
        for record in (self.booking_type, self.combination, self.booking, type_rel):
            for operation in ('read', 'write', 'create', 'unlink'):
                self.assertTrue(self._can(self.manager, operation, record), (record._name, operation))
        new_type = self._as(self.manager, 'resource.booking.type').create({'name': 'Managed'})
        new_type.write({'name': 'Managed again'})
        new_type.unlink()

    def test_the_outsider_has_no_access(self):
        for record in (self.booking_type, self.combination, self.booking):
            for operation in ('read', 'write', 'create', 'unlink'):
                self.assertFalse(self._can(self.outsider, operation, record), (record._name, operation))

    def test_manage_keeps_the_engine_manager_group(self):
        self.assertTrue(self.manager.has_group('resource_booking.group_manager'))
        self.assertFalse(self.booker.has_group('resource_booking.group_manager'))

    def test_company_a_cannot_reach_company_b_records(self):
        _other, foreign_type, foreign_combination, foreign_booking = self._foreign_company_records()
        for user in (self.employee, self.booker, self.manager):
            for record in (foreign_type, foreign_combination, foreign_booking):
                self.assertFalse(
                    self.env[record._name].with_user(user).search([('id', '=', record.id)]),
                    (user.login, record._name),
                )
                self.assertFalse(self._can(user, 'read', record), (user.login, record._name))

    def test_a_company_less_type_is_refused(self):
        with mute_logger('odoo.sql_db'), self.assertRaises(IntegrityError), self.env.cr.savepoint():
            self.env['resource.booking.type'].create({'name': 'No company', 'company_id': False})

    def test_a_combination_of_another_company_cannot_serve_a_type(self):
        _other, _type, foreign_combination, _booking = self._foreign_company_records()
        with self.assertRaises(ValidationError):
            self.booking_type.write({'combination_rel_ids': [(0, 0, {'combination_id': foreign_combination.id})]})
