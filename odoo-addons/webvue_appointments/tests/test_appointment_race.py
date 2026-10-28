# Part of Odoo. See LICENSE file for full copyright and licensing details.
import psycopg2

from odoo import SUPERUSER_ID, api, sql_db
from odoo.exceptions import UserError
from odoo.tests import BaseCase, get_db_name, tagged
from odoo.tools import mute_logger

from .test_appointment_service import next_monday_nine
from odoo.addons.webvue_api.controllers.common import ApiError

RACES = 20


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentRace(BaseCase):
    """Real concurrent transactions book one resource; the guard lets exactly one of them win.

    A BaseCase holds no test transaction: fixtures are committed through their own cursor and removed
    afterwards. The service's lock never waits (SKIP LOCKED), so both transactions run on this thread.
    """

    def setUp(self):
        super().setUp()
        # A hard gate, not a skip: committed concurrency tests never touch a development database.
        if not get_db_name().startswith('webvue_scratch_'):
            self.fail('Committed concurrency tests require a webvue_scratch_ database.')
        self.db = sql_db.db_connect(get_db_name())
        self.cursors = []
        # Cleanups run last in, first out: the open cursors release their locks before the fixtures go.
        self.addCleanup(self._remove_fixtures)
        self.addCleanup(self._close_cursors)
        self.created = {}
        with self.db.cursor() as cr:
            env = self._env(cr)
            calendar = env.ref('resource.resource_calendar_std')
            self.tz = calendar.tz
            resource = env['resource.resource'].create({
                'name': 'Race room', 'resource_type': 'material', 'calendar_id': calendar.id,
            })
            self.combination = env['resource.booking.combination'].create({
                'company_id': env.company.id, 'resource_ids': [(6, 0, resource.ids)],
            })
            self.booking_type = env['resource.booking.type'].create({
                'name': 'Race type', 'duration': 1.0, 'resource_calendar_id': calendar.id,
                'combination_rel_ids': [(0, 0, {'combination_id': self.combination.id})],
            })
            self.partner = env['res.partner'].create({'name': 'Race client'})
            # The guard row exists before any snapshot is opened, as it does once a resource was booked.
            env['webvue.appointment.service']._webvue_guards(resource)
            self.created = {
                'combination': self.combination.ids, 'type': self.booking_type.ids,
                'resource': resource.ids, 'partner': self.partner.ids,
            }
            self.combination, self.booking_type, self.partner = (
                self.combination.id, self.booking_type.id, self.partner.id,
            )

    def _env(self, cr):
        return api.Environment(cr, SUPERUSER_ID, {'tz': getattr(self, 'tz', 'UTC'), 'mail_auto_subscribe_no_notify': True})

    def _cursor(self):
        cursor = self.db.cursor()
        self.cursors.append(cursor)
        return cursor

    def _close_cursors(self):
        for cursor in self.cursors:
            cursor.rollback()
            cursor.close()

    def _remove_fixtures(self):
        with self.db.cursor() as cr:
            env = self._env(cr)
            bookings = env['resource.booking'].search([('type_id', 'in', self.created.get('type', []))])
            bookings.meeting_id.unlink()
            bookings.unlink()
            for model, key in (
                ('resource.booking.type', 'type'), ('resource.booking.combination', 'combination'),
                ('resource.resource', 'resource'), ('res.partner', 'partner'),
            ):
                env[model].browse(self.created.get(key, [])).exists().unlink()

    def _new_booking(self):
        with self.db.cursor() as cr:
            return self._env(cr)['resource.booking'].create({
                'type_id': self.booking_type, 'partner_ids': [(6, 0, [self.partner])],
                'combination_auto_assign': False,
            }).id

    def _schedule(self, cursor, booking_id, start):
        env = self._env(cursor)
        combination = env['resource.booking.combination'].browse(self.combination)
        env['webvue.appointment.service']._webvue_schedule(env['resource.booking'].browse(booking_id), start, combination)

    def _scheduled_at(self, start):
        with self.db.cursor() as cr:
            return self._env(cr)['resource.booking'].search_count([
                ('type_id', '=', self.booking_type), ('meeting_id', '!=', False), ('start', '=', start),
            ])

    def test_a_concurrent_booking_of_one_slot_is_refused_while_the_first_holds_the_guard(self):
        for race in range(RACES):
            start = next_monday_nine(race)
            first, second = self._new_booking(), self._new_booking()
            winner, loser = self._cursor(), self._cursor()
            self._schedule(winner, first, start)
            with self.assertRaises(ApiError, msg=f'race {race}') as raised:
                self._schedule(loser, second, start)
            self.assertEqual((raised.exception.status, raised.exception.code), (409, 'conflict'))
            loser.rollback()
            winner.commit()
            self.assertEqual(self._scheduled_at(start), 1, f'race {race}')

    @mute_logger('odoo.sql_db')
    def test_a_booking_from_a_snapshot_older_than_a_committed_booking_fails_serialization(self):
        for race in range(RACES):
            start = next_monday_nine(race)
            first, second = self._new_booking(), self._new_booking()
            winner, loser = self._cursor(), self._cursor()
            loser.execute('SELECT 1')  # the loser's snapshot predates the winner's commit
            self._schedule(winner, first, start)
            winner.commit()
            with self.assertRaises(psycopg2.errors.SerializationFailure, msg=f'race {race}'):
                self._schedule(loser, second, start)
            loser.rollback()
            self.assertEqual(self._scheduled_at(start), 1, f'race {race}')

    def test_a_fresh_snapshot_after_the_commit_meets_the_conflict(self):
        start = next_monday_nine()
        first, second = self._new_booking(), self._new_booking()
        winner = self._cursor()
        self._schedule(winner, first, start)
        winner.commit()
        with self.assertRaises(UserError):
            self._schedule(self._cursor(), second, start)
        self.assertEqual(self._scheduled_at(start), 1)
