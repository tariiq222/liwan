# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from odoo import fields
from odoo.tests import tagged

from .common import WebVueAppointmentsCase
from odoo.addons.webvue_appointments.models.resource_booking import (
    ATTENDANCE_TRANSITIONS,
)

BOOKINGS = '/api/v1/appointments/bookings'
UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentAttendance(WebVueAppointmentsCase):

    def _login(self, name='booker'):
        self.authenticate('appointments_%s' % name, 'appointments_%s_pass_123' % name)

    def _settings(self, **values):
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, **values})
        self.env.flush_all()

    def _error(self, result, status, code, field=None):
        body = result.json()
        self.assertEqual((result.status_code, body.get('code')), (status, code), result.text)
        if field:
            self.assertEqual(body.get('field'), field, result.text)

    def _booking_at(self, start, *, confirm=True, attendance=False, booking_type=None):
        """A booking of the type (default: the main company's) at ``start`` (naive UTC) on a fresh resource; confirmed unless ``confirm`` is false."""
        booking_type = booking_type or self.booking_type
        combination = self._create_combination(booking_type.company_id, 'Attendance room')
        booking = self._create_booking(booking_type, combination, self.employee.partner_id)
        if start + timedelta(hours=booking_type.duration) > fields.Datetime.now():
            self._always_open(booking_type, combination)  # a booking not yet over must fit the calendar
        # Pinned: auto-assignment would drop a combination that is not available at a past time.
        booking.write({
            'start': start, 'combination_id': combination.id, 'combination_auto_assign': False, 'webvue_attendance': attendance,
        })
        if confirm:
            booking.action_confirm()
        self.env.flush_all()
        self.assertEqual(booking.state, 'confirmed' if confirm else 'scheduled')
        return booking

    def _record(self, booking, outcome):
        return self.api('POST', '%s/%d/attendance' % (BOOKINGS, booking.id), json={'outcome': outcome})

    @staticmethod
    def _ago(**delta):
        return fields.Datetime.now() - timedelta(**delta)

    # --- transitions ---

    def test_every_allowed_transition_is_recorded_and_every_other_is_refused(self):
        self._login()
        outcomes = ('arrived', 'in_service', 'done', 'no_show')
        for current in (False, *outcomes):
            for outcome in outcomes:
                booking = self._booking_at(self._ago(hours=2), attendance=current)
                result = self._record(booking, outcome)
                if outcome in ATTENDANCE_TRANSITIONS.get(current, ()):
                    self.assertEqual(result.status_code, 200, (current, outcome, result.text))
                    self.assertEqual(result.json()['attendance'], outcome)
                    self.assertEqual(booking.webvue_attendance, outcome)
                else:
                    self._error(result, 422, 'invalid', 'outcome')
                    self.assertEqual(booking.webvue_attendance, current)

    def test_the_allowed_moves_are_the_documented_ones(self):
        self.assertEqual(ATTENDANCE_TRANSITIONS, {
            False: ('arrived', 'no_show'), 'arrived': ('in_service', 'done'), 'in_service': ('done',), 'no_show': ('arrived',),
        })

    def test_moving_a_booking_clears_its_outcome_unless_its_visit_has_begun(self):
        later = fields.Datetime.now().replace(second=0, microsecond=0) + timedelta(days=3)
        for outcome in ('arrived', 'no_show'):
            booking = self._booking_at(self._ago(hours=2), attendance=outcome)
            self._always_open(booking.type_id, booking.combination_id)
            booking.write({'start': later})
            self.assertFalse(booking.webvue_attendance, outcome)
        self._login('manager')  # a manager may move a booking past its change deadline: only the outcome refuses
        for outcome in ('in_service', 'done'):
            booking = self._booking_at(self._ago(hours=2), attendance=outcome)
            self._always_open(booking.type_id, booking.combination_id)
            moved = self.api('POST', '%s/%d/schedule' % (BOOKINGS, booking.id), json={'start': later.strftime(UTC_FORMAT)})
            self._error(moved, 422, 'invalid')
            self.assertIn('visit has begun or ended', moved.json()['message'], moved.text)
            self.assertEqual(booking.webvue_attendance, outcome)

    def test_arrival_confirms_a_scheduled_booking_but_no_show_does_not(self):
        self._login()
        late = self._booking_at(self._ago(hours=1), confirm=False)
        self.assertEqual(self._record(late, 'no_show').json()['state'], 'scheduled')
        arrived = self._record(late, 'arrived')
        self.assertEqual((arrived.status_code, arrived.json()['state'], arrived.json()['attendance']), (200, 'confirmed', 'arrived'), arrived.text)

    def test_no_show_waits_for_the_start(self):
        self._login()
        future = self._booking_at(fields.Datetime.now() + timedelta(hours=3))
        self._error(self._record(future, 'no_show'), 422, 'invalid', 'outcome')
        self.assertEqual(self._record(future, 'arrived').status_code, 200)

    def test_only_a_scheduled_or_confirmed_booking_records_attendance(self):
        self._login()
        pending = self._create_booking(self.booking_type, self._create_combination(self.env.company, 'Pending room'))
        self.env.flush_all()
        self._error(self._record(pending, 'arrived'), 422, 'invalid')
        canceled = self._booking_at(self._ago(hours=2))
        canceled.action_cancel()
        self.env.flush_all()
        self._error(self._record(canceled, 'arrived'), 422, 'invalid')

    def test_a_bad_body_is_a_422(self):
        self._login()
        booking = self._booking_at(self._ago(hours=2))
        path = '%s/%d/attendance' % (BOOKINGS, booking.id)
        for body, field in (({}, 'outcome'), ({'outcome': 'late'}, 'outcome'), ({'outcome': ['arrived']}, 'outcome'),
                            ({'outcome': 'arrived', 'x': 1}, 'x')):
            self._error(self.api('POST', path, json=body), 422, 'invalid', field)

    def test_tracking_off_refuses_attendance(self):
        self._settings(attendance_tracking=False)
        self._login()
        booking = self._booking_at(self._ago(hours=2))
        self._error(self._record(booking, 'arrived'), 422, 'invalid')
        self.assertFalse(booking.webvue_attendance)

    def test_capabilities_and_company_isolation(self):
        booking = self._booking_at(self._ago(hours=2))
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self._record(booking, 'arrived').status_code, 403)
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        self.assertEqual(self._record(booking, 'arrived').status_code, 403)
        _other, _type, _combination, foreign = self._foreign_company_records()
        self.env.flush_all()
        self._login('manager')
        self._error(self._record(foreign, 'arrived'), 404, 'not_found')
        self._assert_forbidden_in_the_current_company([('POST', '%s/%d/attendance' % (BOOKINGS, booking.id), {'outcome': 'arrived'})])

    def test_the_detail_shows_the_recorded_outcome_to_a_reader(self):
        booking = self._booking_at(self._ago(hours=2), attendance='done')
        self.authenticate('api_emp', 'api_emp_pass_123')
        detail = self.api('GET', '%s/%d' % (BOOKINGS, booking.id)).json()
        self.assertEqual((detail['attendance'], detail['walk_in']), ('done', False))

    # --- walk-in ---

    def _walk_in_body(self, **extra):
        return {'type_id': self.booking_type.id, 'requester': {'name': 'Walk In', 'phone': '+966500000010'}, 'walk_in': True, **extra}

    def _open_all_day(self):
        self._always_open(self.booking_type, self.combination)
        self.env.flush_all()

    def test_a_walk_in_is_scheduled_now_confirmed_and_arrived(self):
        self._settings(walk_in_allowed=True, requester_confirmation=True)
        self._open_all_day()
        self._login()
        before = datetime.now(UTC).replace(second=0, microsecond=0)
        result = self.api('POST', BOOKINGS, json=self._walk_in_body())
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual((body['state'], body['attendance'], body['walk_in']), ('confirmed', 'arrived', True))
        start = datetime.strptime(body['start'], UTC_FORMAT).replace(tzinfo=UTC)
        self.assertGreaterEqual(start, before)
        self.assertLessEqual(start, datetime.now(UTC))
        self.assertEqual(start.second, 0)
        self.assertEqual(body['combination_id'], self.combination.id)

    def test_a_walk_in_without_tracking_records_no_attendance(self):
        self._settings(walk_in_allowed=True, attendance_tracking=False)
        self._open_all_day()
        self._login()
        body = self.api('POST', BOOKINGS, json=self._walk_in_body()).json()
        self.assertEqual((body['state'], body['attendance'], body['walk_in']), ('confirmed', None, True))

    def test_a_walk_in_is_refused_unless_the_company_allows_it(self):
        self._open_all_day()
        self._login()
        self._error(self.api('POST', BOOKINGS, json=self._walk_in_body()), 422, 'invalid', 'walk_in')
        self._settings(walk_in_allowed=True)
        self._error(self.api('POST', BOOKINGS, json=self._walk_in_body(start='2030-01-01T09:00:00Z')), 422, 'invalid', 'start')
        self._error(self.api('POST', BOOKINGS, json=self._walk_in_body(walk_in='yes')), 422, 'invalid', 'walk_in')
        plain = self.api('POST', BOOKINGS, json={**self._walk_in_body(), 'walk_in': False})
        self.assertEqual((plain.status_code, plain.json()['state']), (200, 'pending'), plain.text)

    def test_a_walk_in_on_a_busy_resource_is_a_409(self):
        self._settings(walk_in_allowed=True)
        self._open_all_day()
        self._login()
        pinned = self._walk_in_body(combination_id=self.combination.id)
        self.assertEqual(self.api('POST', BOOKINGS, json=pinned).status_code, 200)
        self._error(self.api('POST', BOOKINGS, json=pinned), 409, 'conflict')

    def test_a_walk_in_needs_a_combination_and_the_write_capability(self):
        self._settings(walk_in_allowed=True)
        self._login()
        bare = self.env['resource.booking.type'].create({'name': 'No resources', 'duration': 0.5})
        self.env.flush_all()
        self._error(self.api('POST', BOOKINGS, json=self._walk_in_body(type_id=bare.id)), 422, 'invalid', 'type_id')
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', BOOKINGS, json=self._walk_in_body()).status_code, 403)

    # --- no-show cron ---

    def test_the_cron_marks_only_late_unrecorded_bookings(self):
        late_confirmed = self._booking_at(self._ago(hours=2))
        late_scheduled = self._booking_at(self._ago(hours=2), confirm=False)
        within_grace = self._booking_at(self._ago(minutes=10))
        arrived = self._booking_at(self._ago(hours=2), attendance='arrived')
        upcoming = self._booking_at(fields.Datetime.now() + timedelta(hours=2))
        canceled = self._booking_at(self._ago(hours=3))
        canceled.action_cancel()
        pending = self._create_booking(self.booking_type, self._create_combination(self.env.company, 'Cron pending room'))
        self.env.flush_all()
        Booking = self.env['resource.booking']
        Booking._webvue_mark_no_shows()
        self.assertEqual(late_confirmed.webvue_attendance, 'no_show')
        self.assertEqual(late_scheduled.webvue_attendance, 'no_show')
        self.assertEqual(late_scheduled.state, 'scheduled')
        for untouched, expected in ((within_grace, False), (arrived, 'arrived'), (upcoming, False), (canceled, False), (pending, False)):
            self.assertEqual(untouched.webvue_attendance, expected, untouched.id)
        Booking._webvue_mark_no_shows()
        self.assertEqual((late_confirmed.webvue_attendance, arrived.webvue_attendance), ('no_show', 'arrived'))

    def test_the_grace_minutes_come_from_the_settings(self):
        self._settings(no_show_grace_minutes=5)
        booking = self._booking_at(self._ago(minutes=10))
        self.env['resource.booking']._webvue_mark_no_shows()
        self.assertEqual(booking.webvue_attendance, 'no_show')

    def test_the_cron_respects_each_companys_settings(self):
        other, other_type, _combination, _booking = self._foreign_company_records()
        other_booking = self._booking_at(self._ago(hours=2), booking_type=other_type)
        default_company = self._booking_at(self._ago(hours=2))
        for values in ({'attendance_tracking': False}, {'auto_no_show': False}):
            settings = self.env['webvue.appointment.settings'].create({'company_id': other.id, **values})
            self.env['resource.booking']._webvue_mark_no_shows()
            self.assertFalse(other_booking.webvue_attendance, values)
            settings.unlink()
        self.assertEqual(default_company.webvue_attendance, 'no_show')
        self.env['resource.booking']._webvue_mark_no_shows()
        self.assertEqual(other_booking.webvue_attendance, 'no_show')

    def test_the_cron_works_in_batches(self):
        bookings = [self._booking_at(self._ago(hours=2)) for _ in range(3)]
        with patch('odoo.addons.webvue_appointments.models.resource_booking.NO_SHOW_BATCH', 2):
            self.env['resource.booking']._webvue_mark_no_shows()
            self.assertEqual(sum(bool(booking.webvue_attendance) for booking in bookings), 2)
            self.env['resource.booking']._webvue_mark_no_shows()
        self.assertTrue(all(booking.webvue_attendance == 'no_show' for booking in bookings))

    def test_the_cron_record_runs_as_the_root_user_without_elevation(self):
        cron = self.env.ref('webvue_appointments.ir_cron_webvue_appointment_no_shows')
        self.assertEqual((cron.user_id, cron.state, cron.code), (self.env.ref('base.user_root'), 'code', 'model._webvue_mark_no_shows()'))
