# Part of Odoo. See LICENSE file for full copyright and licensing details.
import datetime

from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import WebVueAppointmentsCase


def next_monday_nine(weeks=0):
    """A working-hours start (naive UTC) on a Monday at least a week ahead."""
    today = datetime.datetime.now()
    monday = today + datetime.timedelta(days=7 - today.weekday(), weeks=weeks)
    return monday.replace(hour=9, minute=0, second=0, microsecond=0)


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentService(WebVueAppointmentsCase):
    """``resource.booking`` guards the resources of a scheduled booking before the engine checks the slot."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.calendar = cls.env.ref('resource.resource_calendar_std')
        cls.env = cls.env(context={**cls.env.context, 'tz': cls.calendar.tz})
        cls.slot_type = cls._slot_type('Slot type')
        cls.room_a = cls._room('Guard room A')
        cls.room_b = cls._room('Guard room B')

    @classmethod
    def _slot_type(cls, name):
        return cls.env['resource.booking.type'].create({
            'name': name, 'duration': 1.0, 'resource_calendar_id': cls.calendar.id,
        })

    @classmethod
    def _room(cls, name):
        resource = cls.env['resource.resource'].create({
            'name': name, 'resource_type': 'material', 'calendar_id': cls.calendar.id,
        })
        return cls.env['resource.booking.combination'].create({
            'company_id': cls.env.company.id, 'resource_ids': [(6, 0, resource.ids)],
        })

    def _unscheduled(self, booking_type, *combinations):
        booking_type.combination_rel_ids = [(0, 0, {'combination_id': combination.id}) for combination in combinations]
        return self.env['resource.booking'].with_context(mail_auto_subscribe_no_notify=True).create({
            'type_id': booking_type.id, 'partner_ids': [(6, 0, self.employee.partner_id.ids)],
            'combination_auto_assign': False,
        })

    def _guard(self, combination):
        return self.env['webvue.appointment.resource.guard'].search([('resource_id', 'in', combination.resource_ids.ids)])

    def _schedule(self, booking, start, combination):
        booking.write({'start': start, 'combination_id': combination.id, 'combination_auto_assign': False})

    def test_an_unscheduled_booking_creates_no_guard(self):
        self._unscheduled(self.slot_type, self.room_a)
        self.assertFalse(self._guard(self.room_a))

    def test_scheduling_creates_the_guards_and_bumps_their_revision(self):
        booking = self._unscheduled(self.slot_type, self.room_a)
        self._schedule(booking, next_monday_nine(), self.room_a)
        self.assertEqual(booking.combination_id, self.room_a)
        self.assertTrue(booking.meeting_id)
        self.assertEqual(self._guard(self.room_a).revision, 1)
        other = self._unscheduled(self.slot_type, self.room_a)
        self._schedule(other, next_monday_nine(1), self.room_a)
        self.assertEqual(self._guard(self.room_a).revision, 2)

    def test_a_plain_write_of_the_start_is_guarded(self):
        booking = self._unscheduled(self.slot_type, self.room_a)
        booking.combination_id = self.room_a
        booking.write({'start': next_monday_nine(5)})
        self.assertEqual(self._guard(self.room_a).revision, 1)

    def test_creating_a_scheduled_booking_is_guarded(self):
        self.slot_type.combination_rel_ids = [(0, 0, {'combination_id': self.room_a.id})]
        created = self.env['resource.booking'].with_context(mail_auto_subscribe_no_notify=True).create({
            'type_id': self.slot_type.id, 'partner_ids': [(6, 0, self.employee.partner_id.ids)],
            'combination_id': self.room_a.id, 'combination_auto_assign': False, 'start': next_monday_nine(6),
        })
        self.assertTrue(created.meeting_id)
        self.assertEqual(self._guard(self.room_a).revision, 1)

    def test_a_write_of_another_field_takes_no_guard(self):
        booking = self._unscheduled(self.slot_type, self.room_a)
        self._schedule(booking, next_monday_nine(7), self.room_a)
        booking.write({'name': 'Renamed'})
        self.assertEqual(self._guard(self.room_a).revision, 1)

    def test_the_same_slot_of_one_combination_is_refused_in_one_transaction(self):
        first = self._unscheduled(self.slot_type, self.room_a)
        second = self._unscheduled(self.slot_type, self.room_a)
        self._schedule(first, next_monday_nine(), self.room_a)
        with self.assertRaises(ValidationError):
            self._schedule(second, next_monday_nine(), self.room_a)

    def test_the_same_slot_of_different_resources_both_succeed(self):
        booking_type = self._slot_type('Two rooms')
        first = self._unscheduled(booking_type, self.room_a, self.room_b)
        second = self._unscheduled(booking_type)
        self._schedule(first, next_monday_nine(2), self.room_a)
        self._schedule(second, next_monday_nine(2), self.room_b)
        self.assertEqual((first.combination_id, second.combination_id), (self.room_a, self.room_b))
        self.assertTrue(first.meeting_id and second.meeting_id)

    def test_auto_assign_guards_every_combination_of_the_type(self):
        booking_type = self._slot_type('Auto assign')
        booking = self._unscheduled(booking_type, self.room_a, self.room_b)
        booking.combination_auto_assign = True
        booking.write({'start': next_monday_nine(3)})
        self.assertTrue(booking.meeting_id)
        self.assertEqual(self._guard(self.room_a).revision, 1)
        self.assertEqual(self._guard(self.room_b).revision, 1)

    def test_a_booker_without_other_access_can_schedule(self):
        booking = self._unscheduled(self.slot_type, self.room_a)
        self._schedule(booking.with_user(self.booker), next_monday_nine(4), self.room_a)
        self.assertTrue(booking.meeting_id)
        self.assertEqual(self._guard(self.room_a).revision, 1)
