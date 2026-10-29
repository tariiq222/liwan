# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
from datetime import UTC, datetime

from odoo.tests import tagged

from .common import WebVueAppointmentsCase

BOOKINGS = '/api/v1/appointments/bookings'
REFERENCE = re.compile(r'(?P<prefix>[A-Z0-9-]+)/(?P<year>\d{4})/(?P<number>\d{6})')


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentReference(WebVueAppointmentsCase):

    def _new_booking(self, booking_type=None):
        booking_type = booking_type or self.booking_type
        booking = self.env['resource.booking'].with_context(mail_auto_subscribe_no_notify=True).create({
            'type_id': booking_type.id, 'partner_ids': [(6, 0, self.employee.partner_id.ids)],
        })
        self.env.flush_all()
        return booking

    def _number(self, booking):
        match = REFERENCE.fullmatch(booking.webvue_reference)
        self.assertTrue(match, booking.webvue_reference)
        return match['prefix'], int(match['year']), int(match['number'])

    def test_a_new_booking_gets_prefix_year_and_a_padded_counter(self):
        first, second = self._new_booking(), self._new_booking()
        (prefix, year, number), (_prefix, _year, next_number) = self._number(first), self._number(second)
        self.assertEqual((prefix, year), ('APT', datetime.now(UTC).year))
        self.assertEqual(next_number, number + 1)

    def test_the_prefix_applies_to_new_bookings_only(self):
        before = self._new_booking()
        self.env['webvue.appointment.settings'].create({'company_id': self.env.company.id, 'reference_prefix': 'CLN-2'})
        after = self._new_booking()
        self.assertEqual((self._number(before)[0], self._number(after)[0]), ('APT', 'CLN-2'))
        self.assertEqual(self._number(after)[2], self._number(before)[2] + 1)
        self.assertTrue(before.webvue_reference.startswith('APT/'))

    def test_each_company_counts_on_its_own_with_its_own_prefix(self):
        other, other_type, other_combination, _foreign = self._foreign_company_records()
        self.env['webvue.appointment.settings'].create({'company_id': other.id, 'reference_prefix': 'OTH'})
        first = self._new_booking(other_type)
        second = self._new_booking(other_type)
        self.assertEqual([self._number(first)[0], self._number(first)[2]], ['OTH', 2])
        self.assertEqual(self._number(second)[2], 3)
        own = self._new_booking()
        self.assertEqual(self._number(own)[0], 'APT')
        self.assertGreater(self._number(own)[2], 1)
        self.assertEqual(other_combination.company_id, other)

    def test_references_are_unique_within_a_company(self):
        references = [self._new_booking().webvue_reference for _ in range(5)]
        self.assertEqual(len(set(references)), 5)
        self.assertNotIn(self.booking.webvue_reference, references)

    def test_every_company_has_exactly_one_counter(self):
        self.env['res.company'].create({'name': 'Counter company'})
        companies = self.env['res.company'].with_context(active_test=False).search([])
        counters = self.env['ir.sequence'].search([('code', '=', 'webvue.appointment.booking')])
        self.assertEqual(sorted(counters.company_id.ids), sorted(companies.ids))
        self.env['res.company']._webvue_ensure_reference_sequences()
        self.assertEqual(self.env['ir.sequence'].search_count([('code', '=', 'webvue.appointment.booking')]), len(companies))

    def test_the_reference_is_server_set_and_not_copied(self):
        forced = self.env['resource.booking'].create({
            'type_id': self.booking_type.id, 'partner_ids': [(6, 0, self.employee.partner_id.ids)], 'webvue_reference': 'FORGED/1',
        })
        self.assertNotEqual(forced.webvue_reference, 'FORGED/1')
        copy = self.booking.copy()
        self.assertNotEqual(copy.webvue_reference, self.booking.webvue_reference)
        self._number(copy)

    def test_routes_show_the_reference_to_readers(self):
        self.authenticate('appointments_booker', 'appointments_booker_pass_123')
        created = self.api('POST', BOOKINGS, json={
            'type_id': self.booking_type.id, 'requester': {'name': 'Sara Ali', 'phone': '+966500000001'},
        })
        self.assertEqual(created.status_code, 200, created.text)
        reference = created.json()['reference']
        self.assertTrue(REFERENCE.fullmatch(reference), reference)
        own = self._new_booking()
        self.authenticate('api_emp', 'api_emp_pass_123')
        rows = {item['id']: item['reference'] for item in self.api('GET', BOOKINGS).json()['items']}
        self.assertEqual(rows[own.id], own.webvue_reference)
