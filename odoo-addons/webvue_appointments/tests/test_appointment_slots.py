# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from odoo.tests import tagged

from .common import WebVueAppointmentsCase

UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentSlots(WebVueAppointmentsCase):

    def _slots(self, first, last, extra=''):
        today = datetime.now(UTC).date()
        path = '/api/v1/appointments/types/%d/slots?from=%s&to=%s%s' % (
            self.booking_type.id, today + timedelta(days=first), today + timedelta(days=last), extra,
        )
        return self.api('GET', path)

    def test_a_week_ahead_has_slots_in_the_whitelisted_shape(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        result = self._slots(2, 8)
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertGreater(body['total'], 0)
        self.assertEqual(body['total'], len(body['items']))
        earliest = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=self.booking_type.modifications_deadline)
        for item in body['items']:
            self.assertEqual(set(item), {'start', 'stop'})
            start, stop = (datetime.strptime(item[name], UTC_FORMAT) for name in ('start', 'stop'))
            self.assertEqual(stop - start, timedelta(minutes=30))
            self.assertGreaterEqual(start, earliest - timedelta(minutes=1))
        starts = [item['start'] for item in body['items']]
        self.assertEqual(starts, sorted(starts))

    def test_a_booked_slot_disappears(self):
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        slot = self._slots(2, 8).json()['items'][0]
        self.booking.write({
            'partner_ids': [(6, 0, self.employee.partner_id.ids)], 'start': datetime.strptime(slot['start'], UTC_FORMAT),
        })
        # The route runs in its own cursor, which only sees flushed rows.
        self.env.flush_all()
        starts = {item['start'] for item in self._slots(2, 8).json()['items']}
        self.assertNotIn(slot['start'], starts)
        self.assertTrue(starts)

    def test_a_combination_filter_must_belong_to_the_type(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        self.assertGreater(self._slots(2, 8, '&combination_id=%d' % self.combination.id).json()['total'], 0)
        unrelated = self._create_combination(self.env.company, 'Unrelated')
        result = self._slots(2, 8, '&combination_id=%d' % unrelated.id)
        self.assertEqual((result.status_code, result.json()['field']), (422, 'combination_id'))

    def test_min_notice_drops_earlier_slots(self):
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, 'min_notice_hours': 720})
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        cutoff = datetime.now(UTC).replace(tzinfo=None) + timedelta(hours=720)
        items = self._slots(0, 45).json()['items']
        self.assertTrue(items)
        for item in items:
            self.assertGreaterEqual(datetime.strptime(item['start'], UTC_FORMAT), cutoff)

    def test_staff_slots_ignore_the_modification_deadline_and_follow_the_min_notice(self):
        """The engine is replaced by a fixed answer, so the test does not depend on working days or the clock."""
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, 'min_notice_hours': 2})
        self.booking_type.modifications_deadline = 24
        now = datetime.now(UTC)
        soon, later = now + timedelta(hours=1), now + timedelta(hours=3)
        seen = []

        def engine(booking, start_dt, end_dt):
            seen.append(booking.type_id.modifications_deadline)
            return {later.date(): [soon, later]}

        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        with patch.object(self.env.registry['resource.booking'], '_get_available_slots', engine):
            items = self._slots(0, 3).json()['items']
        self.assertEqual(seen, [0], 'the engine searched with no deadline')
        self.assertEqual([item['start'] for item in items], [later.strftime(UTC_FORMAT)], 'only the minimum notice applies')
        self.assertEqual(self.booking_type.modifications_deadline, 24)

    def test_the_range_may_not_pass_the_horizon(self):
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, 'horizon_days': 5})
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        self.assertEqual(self._slots(0, 4).status_code, 200)
        result = self._slots(0, 10)
        self.assertEqual((result.status_code, result.json()['code'], result.json()['field']), (422, 'invalid', 'to'))

    def test_no_listed_slot_passes_the_exact_horizon(self):
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, 'horizon_days': 5})
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        latest = datetime.now(UTC).replace(tzinfo=None) + timedelta(days=5)
        items = self._slots(0, 5).json()['items']
        self.assertTrue(items)
        self.assertTrue(all(datetime.strptime(item['start'], UTC_FORMAT) <= latest for item in items))

    def test_bad_dates_are_422(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        base = '/api/v1/appointments/types/%d/slots' % self.booking_type.id
        for query, field in (
            ('', 'from'), ('?from=2026-13-01&to=2026-13-02', 'from'), ('?from=tomorrow&to=2026-01-02', 'from'),
            ('?from=2026-01-01', 'to'), ('?from=2026-01-05&to=2026-01-01', 'to'),
        ):
            result = self.api('GET', base + query)
            self.assertEqual((result.status_code, result.json()['field']), (422, field), query)

    def test_another_company_type_and_archived_type_have_no_slots(self):
        foreign = self._foreign_company_records()[1]
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        today = datetime.now(UTC).date()
        query = '?from=%s&to=%s' % (today, today)
        self.assertEqual(self.api('GET', '/api/v1/appointments/types/%d/slots%s' % (foreign.id, query)).status_code, 404)
        self.booking_type.active = False
        self.assertEqual(self.api('GET', '/api/v1/appointments/types/%d/slots%s' % (self.booking_type.id, query)).status_code, 422)

    def test_a_capability_held_in_another_company_is_refused(self):
        self._assert_forbidden_in_the_current_company([
            ('GET', '/api/v1/appointments/types/%d/slots?from=2026-01-01&to=2026-01-02' % self.booking_type.id, None),
        ])

    def test_slots_need_the_write_capability(self):
        # The read rule hides other people's bookings, so a read-only caller would see booked slots as free.
        for login, password in (
            ('api_emp', 'api_emp_pass_123'), ('appointments_outsider', 'appointments_outsider_pass_123'),
        ):
            self.authenticate(login, password)
            self.assertEqual(self._slots(2, 8).status_code, 403, login)
