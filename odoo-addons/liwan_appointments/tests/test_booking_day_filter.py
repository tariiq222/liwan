# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanAppointmentsCase

BOOKINGS = '/api/v1/appointments/bookings'


@tagged('post_install', '-at_install', 'liwan')
class TestBookingDayFilter(LiwanAppointmentsCase):
    """The list's from/to days are calendar days of the booking type's timezone, as the slots are."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._always_open(cls.booking_type, cls.combination)
        cls.booking_type.resource_calendar_id.tz = 'Asia/Riyadh'
        cls.combination.resource_ids.calendar_id = cls.booking_type.resource_calendar_id
        # 01:00 on 10 March 2031 in Riyadh (UTC+3) is 22:00 UTC on 9 March.
        cls.night_booking = cls.env['resource.booking'].with_context(mail_auto_subscribe_no_notify=True).create({
            'type_id': cls.booking_type.id,
            'combination_id': cls.combination.id,
            'partner_ids': [(6, 0, cls.manager.partner_id.ids)],
            'start': '2031-03-09 22:00:00',
        })

    def _ids(self, query):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        response = self.api('GET', f'{BOOKINGS}?{query}&limit=200')
        self.assertEqual(response.status_code, 200, response.text)
        return {item['id'] for item in response.json()['items']}

    def test_a_riyadh_night_booking_belongs_to_its_riyadh_day(self):
        self.assertEqual(self.night_booking.start.isoformat(), '2031-03-09T22:00:00')
        self.assertIn(self.night_booking.id, self._ids('from=2031-03-10&to=2031-03-10'))
        self.assertNotIn(self.night_booking.id, self._ids('from=2031-03-09&to=2031-03-09'))

    def test_the_open_ended_bounds_use_the_same_day(self):
        self.assertIn(self.night_booking.id, self._ids('from=2031-03-10'))
        self.assertNotIn(self.night_booking.id, self._ids('from=2031-03-11'))
        self.assertIn(self.night_booking.id, self._ids('to=2031-03-10'))
        self.assertNotIn(self.night_booking.id, self._ids('to=2031-03-09'))
