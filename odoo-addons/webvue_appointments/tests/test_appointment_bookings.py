# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import UTC, datetime, timedelta

from odoo.tests import tagged

from .common import WebVueAppointmentsCase

BOOKINGS = '/api/v1/appointments/bookings'
UTC_FORMAT = '%Y-%m-%dT%H:%M:%SZ'
ROW_KEYS = {
    'id', 'state', 'type_id', 'type_name', 'combination_id', 'start', 'stop', 'duration_minutes', 'requester_name',
}
DETAIL_KEYS = ROW_KEYS | {'requester', 'national_id', 'notes', 'is_modifiable'}


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentBookings(WebVueAppointmentsCase):

    def _login(self, name='booker'):
        self.authenticate('appointments_%s' % name, 'appointments_%s_pass_123' % name)

    def _slots(self, count=1, booking_type=None, combination_id=None):
        """Free slot starts (UTC strings) of the type, as the slots route lists them."""
        today = datetime.now(UTC).date()
        path = '/api/v1/appointments/types/%d/slots?from=%s&to=%s' % (
            (booking_type or self.booking_type).id, today + timedelta(days=2), today + timedelta(days=9),
        )
        if combination_id:
            path += '&combination_id=%d' % combination_id
        items = self.api('GET', path).json()['items']
        self.assertGreaterEqual(len(items), count)
        return [item['start'] for item in items[:count]]

    def _settings(self, **values):
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, **values})
        self.env.flush_all()

    def _create(self, body):
        return self.api('POST', BOOKINGS, json={'type_id': self.booking_type.id, **body})

    def _sara(self, **extra):
        return {'requester': {'name': 'Sara Ali', 'phone': '+966500000001', **extra.pop('requester', {})}, **extra}

    def _error(self, result, status, code, field=None):
        body = result.json()
        self.assertEqual((result.status_code, body.get('code')), (status, code), result.text)
        if field:
            self.assertEqual(body.get('field'), field, result.text)

    def _scheduled(self, **body):
        """A booking scheduled through the route as the booker."""
        self._login()
        start = self._slots()[0]
        result = self._create({**self._sara(), 'start': start, **body})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    # --- create ---

    def test_create_a_pending_invitation(self):
        self._login()
        result = self._create(self._sara(requester={'email': 'sara@example.com'}, notes='First visit'))
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(set(body), DETAIL_KEYS)
        self.assertEqual((body['state'], body['start'], body['stop'], body['combination_id']), ('pending', None, None, None))
        self.assertEqual(body['requester']['name'], 'Sara Ali')
        self.assertEqual((body['requester']['phone'], body['requester']['email']), ('+966500000001', 'sara@example.com'))
        self.assertEqual((body['notes'], body['national_id']), ('First visit', None))
        partner = self.env['res.partner'].browse(body['requester']['id'])
        self.assertEqual(partner.company_id, self.env.company)

    def test_create_with_a_start_schedules_it_and_the_company_confirms_it_by_default(self):
        body = self._scheduled()
        self.assertEqual(body['state'], 'confirmed')
        self.assertEqual(body['combination_id'], self.combination.id)
        self.assertEqual(body['stop'][:11], body['start'][:11])

    def test_requester_confirmation_keeps_a_directly_scheduled_booking_scheduled_until_confirmed(self):
        self._settings(requester_confirmation=True)
        body = self._scheduled()
        self.assertEqual(body['state'], 'scheduled')
        result = self.api('POST', '%s/%d/confirm' % (BOOKINGS, body['id']))
        self.assertEqual((result.status_code, result.json()['state']), (200, 'confirmed'), result.text)
        self._error(self.api('POST', '%s/%d/confirm' % (BOOKINGS, body['id'])), 422, 'invalid')

    def test_create_with_an_existing_requester_and_a_chosen_combination(self):
        self._login()
        other = self._create_combination(self.env.company, 'Room B')
        self.booking_type.combination_rel_ids = [(0, 0, {'combination_id': other.id})]
        # The default policy requires a phone on the requester.
        self.employee.partner_id.phone = '+966500000003'
        self.env.flush_all()
        start = self._slots(combination_id=other.id)[0]
        result = self._create({
            'requester_id': self.employee.partner_id.id, 'combination_id': other.id, 'start': start,
        })
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual((result.json()['combination_id'], result.json()['requester']['id']), (other.id, self.employee.partner_id.id))

    def test_a_taken_slot_is_a_409_conflict_and_creates_nothing(self):
        self._login()
        start = self._slots()[0]
        self.assertEqual(self._create({**self._sara(), 'start': start, 'combination_id': self.combination.id}).status_code, 200)
        count = self.env['res.partner'].search_count([('name', '=', 'Sara Ali')])
        result = self._create({**self._sara(), 'start': start, 'combination_id': self.combination.id})
        self._error(result, 409, 'conflict')
        self.assertEqual(self.env['res.partner'].search_count([('name', '=', 'Sara Ali')]), count)

    def test_a_start_with_no_free_resource_is_a_409(self):
        self._login()
        start = self._slots()[0]
        self.assertEqual(self._create({**self._sara(), 'start': start}).status_code, 200)
        self._error(self._create({**self._sara(), 'start': start}), 409, 'conflict')

    def test_min_notice_and_horizon_are_enforced_on_start(self):
        self._settings(min_notice_hours=48, horizon_days=10)
        self._login()
        now = datetime.now(UTC)
        for hours in (24, 24 * 11):
            start = (now + timedelta(hours=hours)).strftime(UTC_FORMAT)
            self._error(self._create({**self._sara(), 'start': start}), 422, 'invalid', 'start')
        pending = self._create(self._sara())
        self.assertEqual(pending.status_code, 200)
        past = (now - timedelta(days=1)).strftime(UTC_FORMAT)
        self._error(self.api('POST', '%s/%d/schedule' % (BOOKINGS, pending.json()['id']), json={'start': past}), 422, 'invalid', 'start')

    def test_bad_input_is_a_422_naming_the_field(self):
        self._login()
        sara = self._sara()
        cases = (
            ({'type_id': 'x', **sara}, 'type_id'),
            ({'type_id': self.booking_type.id}, 'requester'),
            ({**sara, 'requester_id': self.employee.partner_id.id}, 'requester'),
            ({'requester': 'Sara'}, 'requester'),
            ({'requester': {'phone': '+966500000001'}}, 'requester.name'),
            ({'requester': {'name': 'Sara', 'phone': 'abc'}}, 'requester.phone'),
            ({'requester': {'name': 'Sara', 'phone': '+966500000001', 'email': 'nope'}}, 'requester.email'),
            ({'requester': {'name': 'Sara', 'phone': '+966500000001', 'vat': '1'}}, 'requester.vat'),
            ({**sara, 'start': '2030-01-01'}, 'start'),
            ({**sara, 'start': 5}, 'start'),
            ({**sara, 'company_id': 1}, 'company_id'),
            ({**sara, 'combination_id': self._create_combination(self.env.company, 'Unlisted').id}, 'combination_id'),
            ({**sara, 'combination_id': 0}, 'combination_id'),
            ({**sara, 'notes': 'x' * 2001}, 'notes'),
            ({'requester_id': 999999999}, 'requester_id'),
        )
        for body, field in cases:
            self.env.flush_all()
            result = self.api('POST', BOOKINGS, json={'type_id': self.booking_type.id, **body} if 'type_id' not in body else body)
            self._error(result, 422, 'invalid', field)

    def test_an_unknown_or_foreign_type_is_a_422(self):
        _other, foreign_type, _combination, _booking = self._foreign_company_records()
        self._login()
        for type_id in (foreign_type.id, 999999999):
            self._error(self.api('POST', BOOKINGS, json={'type_id': type_id, **self._sara()}), 422, 'invalid', 'type_id')

    def test_a_foreign_company_partner_is_not_a_requester(self):
        other = self.env['res.company'].create({'name': 'Partner company'})
        partner = self.env['res.partner'].create({'name': 'Foreign requester', 'company_id': other.id, 'phone': '+966500000009'})
        self.env.flush_all()
        self._login()
        self._error(self._create({'requester_id': partner.id}), 422, 'invalid', 'requester_id')

    def test_field_policies_required_hidden_and_optional(self):
        self._settings(phone_field='optional', email_field='required', national_id_field='required', notes_field='hidden')
        self._login()
        base = {'requester': {'name': 'Sara', 'email': 'sara@example.com'}, 'national_id': '1234567890'}
        self.assertEqual(self._create(base).status_code, 200)
        self._error(self._create({**base, 'national_id': None}), 422, 'invalid', 'national_id')
        self._error(self._create({**base, 'national_id': '  '}), 422, 'invalid', 'national_id')
        no_email = {'requester': {'name': 'Sara'}, 'national_id': '1234567890'}
        self._error(self._create(no_email), 422, 'invalid', 'requester.email')
        self._error(self._create({**base, 'notes': 'hello'}), 422, 'invalid', 'notes')
        created = self._create(base).json()
        self.assertEqual((created['national_id'], created['notes'], created['requester']['phone']), ('1234567890', None, None))

    def test_a_hidden_national_id_is_refused_and_a_required_contact_applies_to_an_existing_partner(self):
        self._login()
        self._error(self._create({**self._sara(), 'national_id': '1234567890'}), 422, 'invalid', 'national_id')
        self.env['webvue.appointment.settings'].create({
            'company_id': self.env.company.id, 'email_field': 'required', 'phone_field': 'required',
        })
        self.employee.partner_id.write({'email': False, 'phone': False})
        self.env.flush_all()
        self._error(self._create({'requester_id': self.employee.partner_id.id}), 422, 'invalid', 'requester_id')
        self.employee.partner_id.write({'email': 'emp@example.com', 'phone': '+966500000002'})
        self.env.flush_all()
        self.assertEqual(self._create({'requester_id': self.employee.partner_id.id}).status_code, 200)

    # --- list and detail ---

    def test_list_filters_and_the_whitelisted_row(self):
        scheduled = self._scheduled()
        pending = self._create(self._sara()).json()
        result = self.api('GET', BOOKINGS)
        self.assertEqual(result.status_code, 200, result.text)
        body = result.json()
        self.assertEqual(body['total'], len(body['items']))
        row = next(item for item in body['items'] if item['id'] == pending['id'])
        self.assertEqual(set(row), ROW_KEYS)
        self.assertEqual(row['requester_name'], 'Sara Ali')
        # pending bookings sort after scheduled ones
        ids = [item['id'] for item in body['items']]
        self.assertLess(ids.index(scheduled['id']), ids.index(pending['id']))

        def ids_of(query):
            return {item['id'] for item in self.api('GET', BOOKINGS + query).json()['items']}
        self.assertEqual(ids_of('?state=pending') & {scheduled['id'], pending['id']}, {pending['id']})
        self.assertEqual(ids_of('?state=confirmed') & {scheduled['id'], pending['id']}, {scheduled['id']})
        self.assertIn(scheduled['id'], ids_of('?type_id=%d' % self.booking_type.id))
        self.assertNotIn(scheduled['id'], ids_of('?type_id=%d' % (self.booking_type.id + 9999)))
        resource_id = self.combination.resource_ids.id
        self.assertIn(scheduled['id'], ids_of('?resource_id=%d' % resource_id))
        self.assertNotIn(scheduled['id'], ids_of('?resource_id=%d' % (resource_id + 9999)))
        day = scheduled['start'][:10]
        self.assertIn(scheduled['id'], ids_of('?from=%s&to=%s' % (day, day)))
        self.assertNotIn(pending['id'], ids_of('?from=%s&to=%s' % (day, day)))
        later = (datetime.strptime(day, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
        self.assertNotIn(scheduled['id'], ids_of('?from=%s' % later))
        self.assertEqual(len(self.api('GET', BOOKINGS + '?limit=1').json()['items']), 1)

    def test_canceled_bookings_are_listed_only_by_state(self):
        booking = self._scheduled()
        self.assertEqual(self.api('POST', '%s/%d/cancel' % (BOOKINGS, booking['id'])).json()['state'], 'canceled')
        self.assertNotIn(booking['id'], {item['id'] for item in self.api('GET', BOOKINGS).json()['items']})
        canceled = self.api('GET', BOOKINGS + '?state=canceled').json()
        self.assertIn(booking['id'], {item['id'] for item in canceled['items']})
        self.assertEqual(self.api('GET', '%s/%d' % (BOOKINGS, booking['id'])).json()['state'], 'canceled')

    def test_bad_filters_are_422(self):
        self._login()
        for query, field in (
            ('?state=done', 'state'), ('?mine=yes', 'mine'), ('?type_id=x', 'type_id'), ('?resource_id=0', 'resource_id'),
            ('?from=2026-13-01', 'from'), ('?to=tomorrow', 'to'), ('?from=2026-02-02&to=2026-02-01', 'to'), ('?limit=-1', 'limit'),
        ):
            self._error(self.api('GET', BOOKINGS + query), 422, 'invalid', field)

    def test_mine_lists_requested_and_assigned_bookings_only(self):
        mine_as_requester = self._create_booking_for(self.booker.partner_id)
        user_resource = self._create_combination(self.env.company, 'Booker desk', user=self.booker)
        mine_as_resource = self._create_booking_for(self.employee.partner_id, combination=user_resource)
        other = self._create_booking_for(self.employee.partner_id)
        self._login()
        every = {item['id'] for item in self.api('GET', BOOKINGS).json()['items']}
        self.assertTrue({mine_as_requester.id, mine_as_resource.id, other.id} <= every)
        mine = {item['id'] for item in self.api('GET', BOOKINGS + '?mine=true').json()['items']}
        self.assertEqual(mine & {mine_as_requester.id, mine_as_resource.id, other.id}, {mine_as_requester.id, mine_as_resource.id})
        self.assertEqual(self.api('GET', BOOKINGS + '?mine=true').json()['total'], len(mine))

    def _create_booking_for(self, partner, combination=None):
        booking_type = self.env['resource.booking.type'].create({'name': 'Mine %s' % partner.id})
        booking = self._create_booking(booking_type, combination or self._create_combination(self.env.company, 'Mine room'), partner)
        self.env.flush_all()
        return booking

    def test_a_read_user_sees_only_their_own_bookings(self):
        own = self._create_booking_for(self.employee.partner_id)
        foreign = self._create_booking_for(self.booker.partner_id)
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', BOOKINGS).json()
        self.assertEqual({item['id'] for item in body['items']}, {own.id})
        self.assertEqual(body['total'], 1)
        self.assertEqual(self.api('GET', '%s/%d' % (BOOKINGS, own.id)).status_code, 200)
        self._error(self.api('GET', '%s/%d' % (BOOKINGS, foreign.id)), 404, 'not_found')

    def test_detail_shape_and_missing_record(self):
        self._login()
        created = self._create(self._sara(notes='Line one\nLine two')).json()
        detail = self.api('GET', '%s/%d' % (BOOKINGS, created['id'])).json()
        self.assertEqual(detail, created)
        self.assertEqual(set(detail), DETAIL_KEYS)
        self.assertEqual(detail['notes'], 'Line one\nLine two')
        self._error(self.api('GET', BOOKINGS + '/999999999'), 404, 'not_found')

    # --- schedule, confirm, cancel ---

    def test_schedule_then_reschedule(self):
        self._login()
        pending = self._create(self._sara()).json()
        first, second = self._slots(2)
        path = '%s/%d/schedule' % (BOOKINGS, pending['id'])
        scheduled = self.api('POST', path, json={'start': first})
        self.assertEqual((scheduled.status_code, scheduled.json()['state'], scheduled.json()['start']), (200, 'confirmed', first), scheduled.text)
        moved = self.api('POST', path, json={'start': second, 'combination_id': self.combination.id})
        self.assertEqual((moved.status_code, moved.json()['start']), (200, second), moved.text)
        # the freed first slot can be booked again
        self.assertEqual(self._create({**self._sara(), 'start': first, 'combination_id': self.combination.id}).status_code, 200)

    def test_schedule_validates_its_body_and_the_booking_state(self):
        self._login()
        pending = self._create(self._sara()).json()
        path = '%s/%d/schedule' % (BOOKINGS, pending['id'])
        self._error(self.api('POST', path, json={}), 422, 'invalid', 'start')
        self._error(self.api('POST', path, json={'start': 'soon'}), 422, 'invalid', 'start')
        self._error(self.api('POST', path, json={'start': self._slots()[0], 'x': 1}), 422, 'invalid', 'x')
        other = self._create_combination(self.env.company, 'Not offered')
        self._error(self.api('POST', path, json={'start': self._slots()[0], 'combination_id': other.id}), 422, 'invalid', 'combination_id')
        self.api('POST', '%s/%d/cancel' % (BOOKINGS, pending['id']))
        self._error(self.api('POST', path, json={'start': self._slots()[0]}), 422, 'invalid')
        self._error(self.api('POST', '%s/%d/cancel' % (BOOKINGS, pending['id'])), 422, 'invalid')
        self._error(self.api('POST', '%s/%d/confirm' % (BOOKINGS, pending['id'])), 422, 'invalid')

    def test_scheduling_onto_a_taken_slot_is_a_409(self):
        self._login()
        taken = self._scheduled(combination_id=self.combination.id)
        pending = self._create({**self._sara(), 'combination_id': self.combination.id}).json()
        result = self.api('POST', '%s/%d/schedule' % (BOOKINGS, pending['id']), json={'start': taken['start']})
        self._error(result, 409, 'conflict')
        self.assertEqual(self.api('GET', '%s/%d' % (BOOKINGS, pending['id'])).json()['state'], 'pending')

    def test_confirming_a_pending_booking_is_a_422(self):
        self._login()
        pending = self._create(self._sara()).json()
        self._error(self.api('POST', '%s/%d/confirm' % (BOOKINGS, pending['id'])), 422, 'invalid')

    def test_the_modification_deadline_blocks_a_booker_but_not_a_manager(self):
        self._settings(min_notice_hours=0)
        self._login()
        near = (datetime.now(UTC) + timedelta(hours=1)).strftime(UTC_FORMAT)
        # book first, then widen the deadline so the booking is inside it
        start = self._slots()[0]
        booking = self._create({**self._sara(), 'start': start}).json()
        self.booking_type.modifications_deadline = 24 * 30
        self.env.flush_all()
        self.assertFalse(self.api('GET', '%s/%d' % (BOOKINGS, booking['id'])).json()['is_modifiable'])
        for action, body in (('schedule', {'start': near}), ('cancel', None)):
            self._error(self.api('POST', '%s/%d/%s' % (BOOKINGS, booking['id'], action), json=body), 422, 'invalid')
        self._login('manager')
        result = self.api('POST', '%s/%d/cancel' % (BOOKINGS, booking['id']))
        self.assertEqual((result.status_code, result.json()['state']), (200, 'canceled'), result.text)

    # --- access ---

    def test_a_read_only_user_cannot_write(self):
        booking = self._scheduled()
        self.authenticate('api_emp', 'api_emp_pass_123')
        for method, path, body in (
            ('POST', BOOKINGS, {'type_id': self.booking_type.id, **self._sara()}),
            ('POST', '%s/%d/schedule' % (BOOKINGS, booking['id']), {'start': booking['start']}),
            ('POST', '%s/%d/confirm' % (BOOKINGS, booking['id']), None),
            ('POST', '%s/%d/cancel' % (BOOKINGS, booking['id']), None),
        ):
            self._error(self.api(method, path, json=body), 403, 'forbidden')

    def test_a_user_without_the_capability_is_forbidden_everywhere(self):
        self.authenticate('appointments_outsider', 'appointments_outsider_pass_123')
        for method, path in (
            ('GET', BOOKINGS), ('GET', '%s/%d' % (BOOKINGS, self.booking.id)), ('POST', BOOKINGS),
            ('POST', '%s/%d/cancel' % (BOOKINGS, self.booking.id)),
        ):
            self._error(self.api(method, path, json={} if method == 'POST' else None), 403, 'forbidden')

    def test_a_capability_held_only_in_another_company_is_forbidden(self):
        start = (datetime.now(UTC) + timedelta(days=3)).strftime(UTC_FORMAT)
        booking_id = self.booking.id
        self.env.flush_all()
        self._assert_forbidden_in_the_current_company([
            ('GET', BOOKINGS, None),
            ('GET', '%s/%d' % (BOOKINGS, booking_id), None),
            ('POST', BOOKINGS, {'type_id': self.booking_type.id, **self._sara()}),
            ('POST', '%s/%d/schedule' % (BOOKINGS, booking_id), {'start': start}),
            ('POST', '%s/%d/confirm' % (BOOKINGS, booking_id), None),
            ('POST', '%s/%d/cancel' % (BOOKINGS, booking_id), None),
        ])

    def test_another_company_booking_is_not_found_and_untouched(self):
        _other, _type, _combination, foreign = self._foreign_company_records()
        self.env.flush_all()
        self._login('manager')
        self.assertNotIn(foreign.id, {item['id'] for item in self.api('GET', BOOKINGS).json()['items']})
        start = (datetime.now(UTC) + timedelta(days=3)).strftime(UTC_FORMAT)
        for method, path, body in (
            ('GET', '%s/%d' % (BOOKINGS, foreign.id), None),
            ('POST', '%s/%d/schedule' % (BOOKINGS, foreign.id), {'start': start}),
            ('POST', '%s/%d/confirm' % (BOOKINGS, foreign.id), None),
            ('POST', '%s/%d/cancel' % (BOOKINGS, foreign.id), None),
        ):
            self._error(self.api(method, path, json=body), 404, 'not_found')
        self.assertTrue(foreign.active)
