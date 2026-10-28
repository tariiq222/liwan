# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import UTC, datetime, timedelta

from odoo.tests import tagged

from .common import WebVueAppointmentsCase
from odoo.addons.webvue_api.tests.common import set_probe_feature

PUBLIC = '/api/v1/public/appointments/bookings'
UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'
GUEST_KEYS = {
    'id', 'state', 'type_name', 'duration_minutes', 'location', 'start', 'stop', 'is_modifiable', 'company_name',
    'requester',
}
REQUESTER_KEYS = {'name', 'phone', 'email'}
NATIONAL_ID = '1098765432'
INTERNAL_NOTE = 'Internal note for staff only'


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentGuest(WebVueAppointmentsCase):
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
            'webvue_requester_national_id': NATIONAL_ID,
            'description': '<p>%s</p>' % INTERNAL_NOTE,
            **values,
        })
        booking._portal_ensure_token()
        return booking

    def _settings(self, **values):
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, **values})
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

    def test_a_token_of_another_company_booking_serves_that_booking_only(self):
        _other, foreign_type, _combination, _booking = self._foreign_company_records()
        foreign = self._invited(foreign_type)
        body = self._call('GET', foreign).json()
        self.assertEqual((body['id'], body['company_name']), (foreign.id, 'Other appointments company'))
        self._error(self._call('GET', self.invited, token=foreign.access_token), 404, 'not_found')
        self._error(self._call('GET', foreign, token=self.invited.access_token), 404, 'not_found')

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
        today = datetime.now(UTC).date()
        window = {'from': today, 'to': today + timedelta(days=6)}
        response = self._call('GET', self.invited, '/slots', **window)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertGreater(body['total'], 0)
        now = datetime.now(UTC).replace(tzinfo=None)
        for item in body['items']:
            self.assertEqual(set(item), {'start', 'stop'})
            start = datetime.strptime(item['start'], UTC_FORMAT)
            self.assertGreaterEqual(start, now + timedelta(hours=72) - timedelta(minutes=1))
            self.assertLessEqual(start, now + timedelta(days=6))
        beyond = {'from': today, 'to': today + timedelta(days=7)}
        self._error(self._call('GET', self.invited, '/slots', **beyond), 422, 'invalid', 'to')
        self._error(self._call('GET', self.invited, '/slots', **{'from': 'x', 'to': 'y'}), 422, 'invalid', 'from')

    def test_slots_accept_no_choice_of_resources(self):
        self._error(
            self._call('GET', self.invited, '/slots', combination_id=self.combination.id, **self._window()),
            422, 'unknown_field', 'combination_id',
        )

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
        confirmed = self._call('POST', self.invited, '/confirm')
        self.assertEqual((confirmed.status_code, confirmed.json()['state']), (200, 'confirmed'), confirmed.text)
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
        self.invited.type_id.modifications_deadline = 24 * 30
        self.env.flush_all()
        self.env.invalidate_all()
        self.assertTrue(self.invited.is_overdue)
        self.assertTrue(self.invited.with_user(1).sudo().is_modifiable)
        self.assertFalse(self._call('GET', self.invited).json()['is_modifiable'])
        self._error(self._call('POST', self.invited, '/schedule', start=later), 422, 'invalid', 'start')
        self._error(self._call('POST', self.invited, '/confirm'), 422, 'invalid')
        self._error(self._call('POST', self.invited, '/cancel'), 422, 'invalid')
        self.assertEqual(self.invited.state, 'scheduled')

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

    def test_the_engine_portal_link_points_to_the_webvue_page(self):
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
