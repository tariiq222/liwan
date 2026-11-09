# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
import re
from datetime import UTC, date, datetime, timedelta

from odoo.tests import tagged

from .common import LiwanAppointmentsCase
from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_appointments.models.guest_limit import GUEST_READ_LIMIT

PUBLIC = '/api/v1/public/appointments/bookings'
UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'
GUEST_KEYS = {
    'id', 'state', 'type_name', 'duration_minutes', 'location', 'start', 'stop', 'is_modifiable', 'first_bookable_date', 'last_bookable_date',
    'awaits_confirmation', 'company_name', 'cancel_reason_required', 'cancel_reasons', 'requester',
}
REQUESTER_KEYS = {'name', 'phone', 'email'}
NATIONAL_ID = '1098765432'
INTERNAL_NOTE = 'Internal note for staff only'


@tagged('post_install', '-at_install', 'liwan')
class TestAppointmentGuest(LiwanAppointmentsCase):
    """The invited requester: no session, one access token per booking, the same 404 for every refusal."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.requester = cls.env['res.partner'].create({
            'name': 'Sara Guest', 'phone': '+966500000009', 'email': 'sara.guest@example.com',
        })
        cls.invited = cls._invited(cls.booking_type)

    @classmethod
    def _invited(cls, booking_type, **values):
        booking = cls.env['resource.booking'].with_context(mail_auto_subscribe_no_notify=True).create({
            'type_id': booking_type.id,
            'partner_ids': [(6, 0, cls.requester.ids)],
            'liwan_requester_national_id': NATIONAL_ID,
            'description': '<p>%s</p>' % INTERNAL_NOTE,
            **values,
        })
        booking._portal_ensure_token()
        return booking

    def _settings(self, **values):
        self.env['liwan.appointment.settings'].create({'company_id': self.env.company.id, **values})
        self.env.flush_all()

    def _call(self, method, booking, suffix='', token=None, **body):
        """A public call that must not set a cookie; ``token`` defaults to the booking's own."""
        token = booking.access_token if token is None else token
        path = '%s/%d%s' % (PUBLIC, booking.id, suffix)
        if method == 'GET':
            query = '&'.join(['access_token=%s' % token, *('%s=%s' % item for item in body.items())])
            response = self.api('GET', '%s?%s' % (path, query))
        else:
            response = self.api('POST', path, json={'access_token': token, **body})
        self.assertNotIn('set-cookie', {key.lower() for key in response.headers}, (method, path))
        return response

    def _window(self, first=2, last=9):
        today = datetime.now(UTC).date()
        return {'from': today + timedelta(days=first), 'to': today + timedelta(days=last)}

    def _slots(self, booking, count=1, **window):
        response = self._call('GET', booking, '/slots', **(window or self._window()))
        self.assertEqual(response.status_code, 200, response.text)
        items = response.json()['items']
        self.assertGreaterEqual(len(items), count)
        return [item['start'] for item in items[:count]]

    def _schedule(self, booking, start=None):
        return self._call('POST', booking, '/schedule', start=start or self._slots(booking)[0])

    def _error(self, response, status, code, field=None):
        body = response.json()
        self.assertEqual((response.status_code, body.get('code')), (status, code), response.text)
        if field:
            self.assertEqual(body.get('field'), field, response.text)

    # --- view ---

    def test_the_requester_sees_exactly_the_whitelist(self):
        response = self._call('GET', self.invited)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), GUEST_KEYS)
        self.assertEqual(set(body['requester']), REQUESTER_KEYS)
        self.assertEqual(
            (body['id'], body['state'], body['type_name'], body['duration_minutes'], body['start'], body['stop']),
            (self.invited.id, 'pending', 'Consultation', 30, None, None),
        )
        self.assertEqual(body['company_name'], self.env.company.name)
        self.assertEqual(body['requester'], {
            'name': 'Sara Guest', 'phone': '+966500000009', 'email': 'sara.guest@example.com',
        })
        self.assertTrue(body['is_modifiable'])
        self.assertFalse(body['awaits_confirmation'])
        for secret in (NATIONAL_ID, INTERNAL_NOTE, self.invited.access_token, self.combination.display_name):
            self.assertNotIn(secret, response.text)

    def test_a_hidden_contact_field_is_not_returned(self):
        self._settings(phone_field='hidden', email_field='hidden')
        requester = self._call('GET', self.invited).json()['requester']
        self.assertEqual(requester, {'name': 'Sara Guest', 'phone': None, 'email': None})

    def test_every_refusal_is_the_same_404(self):
        other = self._invited(self.booking_type)
        missing = self.invited.id + 100000
        routes = (
            ('GET', '', {}), ('GET', '/slots', self._window()), ('POST', '/schedule', {'start': '2030-01-01T08:00:00Z'}),
            ('POST', '/confirm', {}), ('POST', '/cancel', {}),
        )
        responses = []
        for method, suffix, extra in routes:
            for token in ('wrong-token', 'x' * 500, other.access_token, '\u00e9' * 20, 'false'):
                responses.append(self._call(method, self.invited, suffix, token=token, **extra))
            # No token at all, an empty one, a non-text one, and a token that fits a booking that does not exist.
            bare = '%s/%d%s' % (PUBLIC, self.invited.id, suffix)
            if method == 'GET':
                responses += [self.api('GET', bare), self.api('GET', bare + '?access_token=')]
                gone = '%s/%d%s?access_token=%s' % (PUBLIC, missing, suffix, self.invited.access_token)
                responses.append(self.api('GET', gone))
            else:
                responses += [self.api('POST', bare, json=body) for body in ({}, {'access_token': ''}, {'access_token': 12345})]
                responses.append(self.api('POST', '%s/%d%s' % (PUBLIC, missing, suffix), json={'access_token': self.invited.access_token, **extra}))
        for response in responses:
            self.assertNotIn('set-cookie', {key.lower() for key in response.headers})
            self.assertEqual((response.status_code, response.json()['code']), (404, 'not_found'), response.text)
        self.assertEqual(len({response.json()['message'] for response in responses}), 1)
        self.assertEqual(self.invited.state, 'pending')

    def test_a_token_serves_only_a_booking_of_this_tenant(self):
        """#547: the elevated read keeps the tenant boundary, so a link of another company tree is not served."""
        _other, foreign_type, _combination, _booking = self._foreign_company_records()
        foreign = self._invited(foreign_type)
        self._error(self._call('GET', foreign), 404, 'not_found')
        self.assertEqual(self._call('GET', self.invited).status_code, 200)
        self._error(self._call('GET', self.invited, token=foreign.access_token), 404, 'not_found')
        self._error(self._call('POST', foreign, '/cancel'), 404, 'not_found')

    def test_a_closed_feature_refuses_every_route(self):
        set_probe_feature(self, key='appointments.enabled', enabled=False)
        for method, suffix, extra in (
            ('GET', '', {}), ('GET', '/slots', self._window()), ('POST', '/schedule', {'start': '2030-01-01T08:00:00Z'}),
            ('POST', '/confirm', {}), ('POST', '/cancel', {}),
        ):
            with self.subTest(suffix=suffix):
                self.assertEqual(self._call(method, self.invited, suffix, **extra).status_code, 403)

    # --- slots ---

    def test_slots_have_the_shape_and_the_notice_and_horizon_bounds(self):
        self._settings(min_notice_hours=72, horizon_days=6)
        # The horizon counts calendar days in the type's timezone, which is a day ahead of UTC late in the UTC day.
        booking = self._call('GET', self.invited).json()
        first, last = booking['first_bookable_date'], booking['last_bookable_date']
        today = datetime.now(UTC).date()
        self.assertIn(first, (str(today - timedelta(days=1)), str(today), str(today + timedelta(days=1))))
        self.assertEqual(date.fromisoformat(last) - date.fromisoformat(first), timedelta(days=6))
        response = self._call('GET', self.invited, '/slots', **{'from': first, 'to': last})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertGreater(body['total'], 0)
        now = datetime.now(UTC).replace(tzinfo=None)
        for item in body['items']:
            self.assertEqual(set(item), {'start', 'stop'})
            start = datetime.strptime(item['start'], UTC_FORMAT)
            self.assertGreaterEqual(start, now + timedelta(hours=72) - timedelta(minutes=1))
            self.assertLessEqual(start, now + timedelta(days=6))
        # A request for exactly the last bookable day was accepted above; one day beyond it is refused.
        self._error(self._call('GET', self.invited, '/slots', **{'from': first, 'to': date.fromisoformat(last) + timedelta(days=1)}), 422, 'invalid', 'to')
        self._error(self._call('GET', self.invited, '/slots', **{'from': 'x', 'to': 'y'}), 422, 'invalid', 'from')

    def test_slots_accept_no_choice_of_resources(self):
        self._error(
            self._call('GET', self.invited, '/slots', combination_id=self.combination.id, **self._window()),
            422, 'unknown_field', 'combination_id',
        )

    def test_a_slots_window_is_bounded_to_a_month(self):
        """#546: the whole booking horizon in one answer would hand out the company's occupancy."""
        first = self._window(2, 2)['from']
        last = first + timedelta(days=30)
        self.assertEqual(self._call('GET', self.invited, '/slots', **{'from': first, 'to': last}).status_code, 200)
        refused = self._call('GET', self.invited, '/slots', **{'from': first, 'to': last + timedelta(days=1)})
        self._error(refused, 422, 'invalid', 'to')

    def test_every_slots_answer_is_bounded_and_in_start_order(self):
        """#546: the horizon may reach 365 days; one answer still lists at most the bounded window."""
        self._settings(horizon_days=365, min_notice_hours=0)
        today = datetime.now(UTC).date()
        for first, last in ((today, today + timedelta(days=30)), (today + timedelta(days=2), today + timedelta(days=9))):
            body = self._call('GET', self.invited, '/slots', **{'from': first, 'to': last}).json()
            self.assertEqual(body['total'], len(body['items']))
            starts = [item['start'] for item in body['items']]
            self.assertEqual(starts, sorted(starts))
            self.assertLessEqual(len(starts), 500)
            self.assertTrue(all(datetime.strptime(value, UTC_FORMAT).date() <= last for value in starts))

    def test_one_token_has_its_own_read_budget(self):
        """#546: the edge limit counts addresses, not tokens; the token itself is bounded inside Odoo."""
        window = self._window()
        for _index in range(GUEST_READ_LIMIT):
            self.assertEqual(self._call('GET', self.invited, '/slots', **window).status_code, 200)
        refused = self._call('GET', self.invited, '/slots', **window)
        self.assertEqual((refused.status_code, refused.json()['code']), (429, 'rate_limited'), refused.text)
        # Another booking's token is untouched by the first one's spending.
        other = self._invited(self.booking_type)
        self.assertEqual(self._call('GET', other, '/slots', **window).status_code, 200)

    def test_a_slot_taken_by_another_booking_is_not_listed_and_not_bookable(self):
        other = self._invited(self.booking_type)
        slot = self._slots(self.invited)[0]
        self.assertEqual(self._schedule(self.invited, slot).status_code, 200)
        listed = [item['start'] for item in self._call('GET', other, '/slots', **self._window()).json()['items']]
        self.assertNotIn(slot, listed)
        self._error(self._schedule(other, slot), 409, 'conflict')

    def test_a_pinned_booking_lists_the_slots_of_its_combination(self):
        second = self._create_combination(self.env.company, 'Room B')
        self.booking_type.combination_rel_ids = [(0, 0, {'combination_id': second.id})]
        pinned = self._invited(self.booking_type, combination_id=self.combination.id, combination_auto_assign=False)
        slot = self._slots(pinned)[0]
        # Room A is taken at that time by another booking; the pinned booking must lose the slot even though Room B is free.
        self._invited(self.booking_type, combination_id=self.combination.id, combination_auto_assign=False).write({'start': datetime.strptime(slot, UTC_FORMAT)})
        self.env.flush_all()
        starts = [item['start'] for item in self._call('GET', pinned, '/slots', **self._window()).json()['items']]
        self.assertNotIn(slot, starts)
        free = self._invited(self.booking_type)
        self.assertIn(slot, [item['start'] for item in self._call('GET', free, '/slots', **self._window()).json()['items']])

    def test_an_archived_type_has_no_slots_and_cannot_be_scheduled(self):
        booking_type = self.env['resource.booking.type'].create({'name': 'Retired', 'duration': 0.5})
        booking = self._invited(booking_type)
        booking_type.combination_rel_ids = [(0, 0, {'combination_id': self.combination.id})]
        booking_type.active = False
        self.env.flush_all()
        self._error(self._call('GET', booking, '/slots', **self._window()), 422, 'invalid')
        self._error(self._call('POST', booking, '/schedule', start='2030-01-01T08:00:00Z'), 422, 'invalid')

    # --- schedule, confirm, cancel ---

    def test_scheduling_confirms_at_once_unless_the_company_asks_the_requester_to_confirm(self):
        response = self._schedule(self.invited)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), GUEST_KEYS)
        self.assertEqual(body['state'], 'confirmed')
        self.assertEqual(self.invited.state, 'confirmed')
        self.assertEqual(self.invited.meeting_id.start.strftime(UTC_FORMAT), body['start'])

    def test_the_requester_confirms_when_the_company_asks_for_it(self):
        self._settings(requester_confirmation=True)
        body = self._schedule(self.invited).json()
        self.assertEqual(body['state'], 'scheduled')
        self.assertTrue(body['awaits_confirmation'])
        confirmed = self._call('POST', self.invited, '/confirm')
        self.assertEqual((confirmed.status_code, confirmed.json()['state']), (200, 'confirmed'), confirmed.text)
        self.assertFalse(confirmed.json()['awaits_confirmation'])
        self._error(self._call('POST', self.invited, '/confirm'), 422, 'invalid')

    def test_a_confirmation_nobody_asked_for_is_refused(self):
        self._error(self._call('POST', self.invited, '/confirm'), 422, 'invalid')
        self._schedule(self.invited)
        self.assertEqual(self.invited.state, 'confirmed')
        self._error(self._call('POST', self.invited, '/confirm'), 422, 'invalid')

    def test_a_held_booking_is_not_confirmed_by_the_requester_without_the_setting(self):
        self._schedule(self.invited)
        self.invited.meeting_id.attendee_ids.write({'state': 'needsAction'})
        self.env.invalidate_all()
        self.assertEqual(self.invited.state, 'scheduled')
        self._error(self._call('POST', self.invited, '/confirm'), 422, 'invalid')

    def test_the_requester_reschedules_to_another_slot(self):
        first, second = self._slots(self.invited, count=2)
        self._schedule(self.invited, first)
        body = self._schedule(self.invited, second).json()
        self.assertEqual((body['start'], body['state']), (second, 'confirmed'))

    def test_a_start_outside_the_notice_and_horizon_is_refused(self):
        self._settings(min_notice_hours=24, horizon_days=10)
        now = datetime.now(UTC)
        for field_value in (now + timedelta(hours=1), now + timedelta(days=11)):
            with self.subTest(start=field_value):
                self._error(self._schedule(self.invited, field_value.strftime(UTC_FORMAT)), 422, 'invalid', 'start')
        for bad in ('tomorrow', '2030-01-01', 20300101):
            with self.subTest(start=bad):
                self._error(self._schedule(self.invited, bad), 422, 'invalid', 'start')
        self._error(self._call('POST', self.invited, '/schedule'), 422, 'invalid', 'start')

    def test_the_requester_cannot_pick_a_start_that_locks_them_out(self):
        self.booking_type.write({'inherits_company_deadline': False, 'own_deadline_hours': 48})
        self.env.flush_all()
        soon = (datetime.now(UTC) + timedelta(hours=30)).strftime(UTC_FORMAT)
        self._error(self._schedule(self.invited, soon), 422, 'invalid', 'start')
        slot = self._slots(self.invited, **self._window(3, 9))[0]
        self.assertEqual(self._schedule(self.invited, slot).status_code, 200)
        # Scheduled as far ahead as the deadline asks: the requester can still cancel.
        self.assertEqual(self._call('POST', self.invited, '/cancel').status_code, 200)

    def test_the_requesters_own_slot_does_not_block_a_small_shift(self):
        long_type = self.env['resource.booking.type'].create({'name': 'Long', 'duration': 1.0, 'slot_duration': 0.5})
        long_type.combination_rel_ids = [(0, 0, {'combination_id': self.combination.id})]
        pinned = {'combination_id': self.combination.id, 'combination_auto_assign': False}
        booking, other = self._invited(long_type, **pinned), self._invited(long_type, **pinned)
        starts = [item['start'] for item in self._call('GET', booking, '/slots', **self._window()).json()['items']]
        step = timedelta(minutes=30)
        first = next(
            start for start in starts
            if (datetime.strptime(start, UTC_FORMAT) + step).strftime(UTC_FORMAT) in starts
        )
        shifted = (datetime.strptime(first, UTC_FORMAT) + step).strftime(UTC_FORMAT)
        self.assertEqual(self._schedule(booking, first).status_code, 200)
        listed = [item['start'] for item in self._call('GET', booking, '/slots', **self._window()).json()['items']]
        self.assertIn(shifted, listed)
        # Another booking on the same resource still sees both overlapping starts as taken.
        others = [item['start'] for item in self._call('GET', other, '/slots', **self._window()).json()['items']]
        self.assertNotIn(first, others)
        self.assertNotIn(shifted, others)
        moved = self._schedule(booking, shifted)
        self.assertEqual((moved.status_code, moved.json()['start']), (200, shifted), moved.text)

    def test_a_schedule_body_accepts_only_the_token_and_the_start(self):
        for field in ('combination_id', 'partner_ids', 'type_id', 'state', 'access_url'):
            with self.subTest(field=field):
                response = self._call('POST', self.invited, '/schedule', start=self._slots(self.invited)[0], **{field: 1})
                self._error(response, 422, 'unknown_field', field)
        self._error(self._call('POST', self.invited, '/cancel', note='x'), 422, 'unknown_field', 'note')
        self.assertEqual(self.invited.state, 'pending')

    def test_cancelling_ends_the_token_for_every_route(self):
        self._schedule(self.invited)
        token = self.invited.access_token
        response = self._call('POST', self.invited, '/cancel')
        self.assertEqual((response.status_code, response.json()['state']), (200, 'canceled'), response.text)
        self.assertFalse(self.invited.meeting_id)
        for method, suffix, extra in (
            ('GET', '', {}), ('GET', '/slots', self._window()), ('POST', '/schedule', {'start': '2030-01-01T08:00:00Z'}),
            ('POST', '/confirm', {}), ('POST', '/cancel', {}),
        ):
            with self.subTest(suffix=suffix):
                self._error(self._call(method, self.invited, suffix, token=token, **extra), 404, 'not_found')

    def test_past_the_deadline_every_write_is_refused_and_a_manager_bypass_does_not_apply(self):
        self._settings(requester_confirmation=True)
        first, later = self._slots(self.invited, count=2)
        self._schedule(self.invited, first)
        # The engine lets an elevated caller modify past the deadline; the requester never gets that.
        self.invited.type_id.write({'inherits_company_deadline': False, 'own_deadline_hours': 24 * 30})
        self.env.flush_all()
        self.env.invalidate_all()
        self.assertTrue(self.invited.is_overdue)
        self.assertTrue(self.invited.with_user(1).sudo().is_modifiable)
        self.assertFalse(self._call('GET', self.invited).json()['is_modifiable'])
        self._error(self._call('POST', self.invited, '/schedule', start=later), 422, 'invalid', 'start')
        self._error(self._call('POST', self.invited, '/confirm'), 422, 'invalid')
        self._error(self._call('POST', self.invited, '/cancel'), 422, 'invalid')
        self.assertEqual(self.invited.state, 'scheduled')

    # --- the link's lifetime (#542) ---

    def _past_booking(self, days_ago):
        """A confirmed booking of ``days_ago`` days, with its token, fitted to an always-open calendar."""
        combination = self._create_combination(self.env.company, 'Past room %s' % days_ago)
        self._always_open(self.booking_type, combination)
        booking = self._invited(self.booking_type, combination_id=combination.id, combination_auto_assign=False)
        start = (datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days_ago)).replace(minute=0, second=0, microsecond=0)
        booking.write({'start': start})
        self.env.flush_all()
        return booking

    def test_a_link_works_until_its_validity_ends_and_answers_not_found_after(self):
        """#542: past ``link_valid_days_after_end`` the public read is the same 404 and shows no requester data."""
        self._settings(link_valid_days_after_end=30)
        recent = self._past_booking(10)
        old = self._past_booking(40)
        self.assertEqual(self._call('GET', recent).status_code, 200)
        expired = self._call('GET', old)
        self._error(expired, 404, 'not_found')
        for secret in ('sara.guest@example.com', '+966500000009', 'Sara Guest'):
            self.assertNotIn(secret, expired.text)
        self.assertEqual(self._call('GET', old, '/slots', **self._window(2, 9)).status_code, 404)
        self._error(self._call('POST', old, '/cancel'), 404, 'not_found')

    def test_the_setting_moves_the_expiry(self):
        """#542: the validity is the company's setting, so a longer one keeps the same link readable."""
        self._settings(link_valid_days_after_end=60)
        old = self._past_booking(40)
        self.assertEqual(self._call('GET', old).status_code, 200)
        self.env['liwan.appointment.settings'].search([('company_id', '=', self.env.company.id)]).link_valid_days_after_end = 7
        self.env.flush_all()
        self._error(self._call('GET', old), 404, 'not_found')

    def _pending_at(self, created_days_ago):
        """An invited booking that was never scheduled, created ``created_days_ago`` days ago."""
        booking = self._invited(self.booking_type)
        self.env.flush_all()
        self.env.cr.execute(
            'UPDATE resource_booking SET create_date = %s WHERE id = %s',
            (datetime.now(UTC).replace(tzinfo=None) - timedelta(days=created_days_ago), booking.id),
        )
        booking.invalidate_recordset()
        return booking

    def test_a_booking_without_a_time_expires_from_its_creation(self):
        """#542: an invitation nobody scheduled counts the validity from its creation, so it does not read for ever."""
        self._settings(link_valid_days_after_end=30)
        recent = self._pending_at(10)
        old = self._pending_at(40)
        self.assertFalse(recent.stop)
        self.assertFalse(old.stop)
        self.assertEqual(self._call('GET', recent).status_code, 200)
        self._error(self._call('GET', old), 404, 'not_found')
        self.assertEqual(self._call('GET', old, '/slots', **self._window(2, 9)).status_code, 404)
        self._error(self._call('POST', old, '/schedule', start='2030-01-01T08:00:00Z'), 404, 'not_found')

    def test_a_booking_without_a_time_keeps_reading_inside_its_validity(self):
        """#542: the same policy decides, so a row created inside the window still reads and schedules."""
        self._settings(link_valid_days_after_end=1, min_notice_hours=0)
        self._always_open(self.booking_type, self.combination)
        fresh = self._pending_at(0)
        self.assertEqual(self._call('GET', fresh).status_code, 200)
        slot = self._slots(fresh)[0]
        self.assertEqual(self._schedule(fresh, slot).status_code, 200)
        # Once scheduled the end of the appointment decides: a start inside the window keeps the link, one past it does not.
        fresh.write({'start': datetime.now(UTC).replace(tzinfo=None) - timedelta(days=3)})
        self.env.flush_all()
        self._error(self._call('GET', fresh), 404, 'not_found')

    def test_the_invitation_refuses_a_link_whose_validity_ended(self):
        """#542: nothing resurrects an expired link, because the validity is a privacy window from the appointment's end.
        Staff who need to reach the requester raise the setting; the route says so instead of handing out a dead link."""
        self._settings(link_valid_days_after_end=1)
        old = self._past_booking(10)
        token = old.access_token
        self._error(self._call('GET', old, token=token), 404, 'not_found')
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        refused = self.api('POST', '/api/v1/appointments/bookings/%d/invitation' % old.id)
        self.assertEqual((refused.status_code, refused.json()['code']), (422, 'invalid'), refused.text)
        self.assertNotIn('access_token=', refused.text)
        self.assertEqual(old.access_token, token)
        # Raising the window makes the same link readable again: the policy, not a token lifetime, decides.
        self.env['liwan.appointment.settings'].search([('company_id', '=', self.env.company.id)]).link_valid_days_after_end = 30
        self.env.flush_all()
        self.logout()
        self.assertEqual(self._call('GET', old, token=token).status_code, 200)

    # --- cancel reason (#548) ---

    def test_a_cancel_requires_the_reason_the_company_asks_for(self):
        self._settings(cancel_reason_required=True)
        reason = self.env['liwan.appointment.reason'].create({
            'company_id': self.env.company.id, 'kind': 'cancel', 'name': 'No longer needed',
        })
        body = self._call('GET', self.invited).json()
        self.assertTrue(body['cancel_reason_required'])
        self.assertEqual([item['id'] for item in body['cancel_reasons']], [reason.id])
        self._schedule(self.invited)
        self._error(self._call('POST', self.invited, '/cancel'), 422, 'invalid', 'reason_id')
        self.assertEqual(self._call('POST', self.invited, '/cancel', reason_id=reason.id).status_code, 200)
        self.assertEqual(self.invited.liwan_cancel_reason_id, reason)

    def test_a_cancel_names_no_reason_unless_the_company_asks_for_one(self):
        reason = self.env['liwan.appointment.reason'].create({
            'company_id': self.env.company.id, 'kind': 'cancel', 'name': 'Secretly required',
        })
        body = self._call('GET', self.invited).json()
        self.assertFalse(body['cancel_reason_required'])
        self.assertEqual(body['cancel_reasons'], [])
        self._schedule(self.invited)
        self.assertEqual(self._call('POST', self.invited, '/cancel', reason_id=reason.id).status_code, 200)
        self.assertEqual(self.invited.liwan_cancel_reason_id, reason)

    def test_an_unknown_or_archived_cancel_reason_is_refused(self):
        self._settings(cancel_reason_required=True)
        archived = self.env['liwan.appointment.reason'].create({
            'company_id': self.env.company.id, 'kind': 'cancel', 'name': 'Retired', 'active': False,
        })
        self._schedule(self.invited)
        self._error(self._call('POST', self.invited, '/cancel', reason_id=archived.id), 422, 'invalid', 'reason_id')
        self._error(self._call('POST', self.invited, '/cancel', reason_id=999999), 422, 'invalid', 'reason_id')
        self.assertEqual(self.invited.state, 'confirmed')

    # --- the slot grid (#548) ---

    def test_a_start_off_the_slot_grid_is_refused(self):
        """#548: a start must be a whole multiple of the type's slot duration from the work day's beginning."""
        self._settings(min_notice_hours=0)
        self._always_open(self.booking_type, self.combination)
        slot = self._slots(self.invited)[0]
        self.assertEqual(self._schedule(self.invited, slot).status_code, 200)
        off_grid = (datetime.strptime(slot, UTC_FORMAT) + timedelta(minutes=7)).strftime(UTC_FORMAT)
        self._error(self._schedule(self.invited, off_grid), 422, 'invalid', 'start')

    # --- the token in the log (#543) ---

    def test_a_public_request_writes_no_token_to_the_request_log(self):
        """#543 acceptance: the request line reaches the werkzeug log with the token masked, never in clear."""
        records = []

        class Capture(logging.Handler):
            def emit(self, record):
                records.append(record)

        logger = logging.getLogger('werkzeug')
        handler = Capture()
        logger.addHandler(handler)
        self.addCleanup(logger.removeHandler, handler)
        token = self.invited.access_token
        response = self._call('GET', self.invited)
        self.assertEqual(response.status_code, 200, response.text)
        lines = [record.getMessage() for record in records if '/api/v1/public/appointments/' in record.getMessage()]
        self.assertTrue(lines)
        for line in lines:
            self.assertNotIn(token, line)
            self.assertIn('access_token=***', line)

    # --- invitation (staff) ---

    def _invitation(self, booking):
        return self.api('POST', '/api/v1/appointments/bookings/%d/invitation' % booking.id)

    def test_the_invitation_is_the_requester_page_path_with_the_token(self):
        fresh = self._invited(self.booking_type)
        fresh.access_token = False
        self.env.flush_all()
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        response = self._invitation(fresh)
        self.assertEqual(response.status_code, 200, response.text)
        path = response.json()['path']
        self.assertEqual(set(response.json()), {'path'})
        self.assertEqual(path, '/book/%d?access_token=%s' % (fresh.id, fresh.access_token))
        self.assertRegex(path, re.compile(r'^/book/\d+\?access_token=[0-9a-f-]{36}$'))
        self.assertEqual(self._invitation(fresh).json()['path'], path)
        self.logout()
        self.assertEqual(self._call('GET', fresh, token=path.split('=')[1]).status_code, 200)

    def test_the_invitation_refuses_any_body_key(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        response = self.api('POST', '/api/v1/appointments/bookings/%d/invitation' % self.invited.id, {'x': 1})
        self.assertEqual((response.status_code, response.json()['code'], response.json()['field']), (422, 'invalid', 'x'))

    def test_the_engine_portal_link_points_to_the_liwan_page(self):
        self.assertEqual(self.invited.access_url, '/book/%d' % self.invited.id)
        self.assertTrue(self.invited.get_portal_url().startswith('/book/%d?access_token=' % self.invited.id))

    def test_the_invitation_needs_the_write_capability_in_the_current_company(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self._invitation(self.invited).status_code, 403)
        self._assert_forbidden_in_the_current_company([
            ('POST', '/api/v1/appointments/bookings/%d/invitation' % self.invited.id, None),
        ])

    def test_the_invitation_of_another_company_booking_is_not_found(self):
        _other, _type, _combination, foreign = self._foreign_company_records()
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        self._error(self._invitation(foreign), 404, 'not_found')

    def test_a_canceled_booking_has_no_invitation(self):
        booking = self._invited(self.booking_type)
        booking.action_cancel()
        self.env.flush_all()
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        self._error(self._invitation(booking), 422, 'invalid')
