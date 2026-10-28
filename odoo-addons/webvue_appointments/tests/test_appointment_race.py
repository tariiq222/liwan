# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading

import psycopg2

from odoo import SUPERUSER_ID, api, sql_db
from odoo.exceptions import UserError
from odoo.tests import BaseCase, get_db_name, tagged
from odoo.tools import mute_logger

from .test_appointment_service import next_monday_nine

RACES = 20
WAIT_SECONDS = 10


@tagged('post_install', '-at_install', 'webvue')
class TestAppointmentRace(BaseCase):
    """Real concurrent transactions book the resources of one type; the guard makes them take turns.

    A BaseCase holds no test transaction: fixtures are committed through their own cursor and removed
    afterwards. The service's lock waits, so the second transaction runs on its own thread.
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
        with self.db.cursor() as cr:
            env = self._env(cr)
            calendar = env.ref('resource.resource_calendar_std')
            self.tz = calendar.tz
            resources = env['resource.resource'].create([
                {'name': name, 'resource_type': 'material', 'calendar_id': calendar.id}
                for name in ('Race room A', 'Race room B')
            ])
            combinations = env['resource.booking.combination'].create([
                {'company_id': env.company.id, 'resource_ids': [(6, 0, resource.ids)]} for resource in resources
            ])
            booking_type = env['resource.booking.type'].create({
                'name': 'Race type', 'duration': 1.0, 'resource_calendar_id': calendar.id,
                'combination_rel_ids': [(0, 0, {'combination_id': combination.id}) for combination in combinations],
            })
            partner = env['res.partner'].create({'name': 'Race client'})
            # The guard rows exist before any snapshot is opened, as they do once a resource was booked.
            env['webvue.appointment.service']._webvue_guards(resources)
            self.created = {
                'combination': combinations.ids, 'type': booking_type.ids,
                'resource': resources.ids, 'partner': partner.ids,
            }
            self.combination_a, self.combination_b = combinations.ids
            self.booking_type, self.partner = booking_type.id, partner.id

    def _env(self, cr):
        return api.Environment(cr, SUPERUSER_ID, {'tz': getattr(self, 'tz', 'UTC'), 'mail_auto_subscribe_no_notify': True})

    def _cursor(self):
        cursor = self.db.cursor()
        self.cursors.append(cursor)
        # The snapshot of a REPEATABLE READ transaction starts at its first query; a bound keeps a failure from hanging.
        cursor.execute("SET LOCAL lock_timeout = '%ds'" % WAIT_SECONDS)
        cursor.execute('SELECT 1')
        return cursor

    def _close_cursors(self):
        for cursor in self.cursors:
            cursor.rollback()
            cursor.close()

    def _remove_fixtures(self):
        with self.db.cursor() as cr:
            env = self._env(cr)
            bookings = env['resource.booking'].search([('type_id', 'in', self.created['type'])])
            bookings.meeting_id.unlink()
            bookings.unlink()
            for model, key in (
                ('resource.booking.type', 'type'), ('resource.booking.combination', 'combination'),
                ('resource.resource', 'resource'), ('res.partner', 'partner'),
            ):
                env[model].browse(self.created[key]).exists().unlink()

    def _new_booking(self):
        with self.db.cursor() as cr:
            return self._env(cr)['resource.booking'].create({
                'type_id': self.booking_type, 'partner_ids': [(6, 0, [self.partner])],
                'combination_auto_assign': False,
            }).id

    def _schedule(self, env, booking_id, start, combination):
        env['resource.booking'].browse(booking_id).write({
            'start': start, 'combination_id': combination, 'combination_auto_assign': False,
        })

    def _schedule_in_thread(self, cursor, booking_id, start, combination):
        outcome = {}
        # Built here: creating an environment takes the registry lock, which module loading holds
        # while this test runs, so the thread must not create one.
        env = self._env(cursor)

        def run():
            try:
                self._schedule(env, booking_id, start, combination)
            except Exception as error:  # noqa: BLE001 - handed to the asserting thread
                outcome['error'] = error

        thread = threading.Thread(target=run)
        thread.start()
        return thread, outcome

    def _wait_until_blocked(self, thread):
        with self.db.cursor() as cr:
            for _ in range(WAIT_SECONDS * 20):
                cr.execute("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
                if cr.fetchone()[0] or not thread.is_alive():
                    return
                thread.join(0.05)
        self.fail('the second booking never waited for the guard')

    def _finish(self, thread):
        thread.join(WAIT_SECONDS)
        self.assertFalse(thread.is_alive(), 'the waiting booking never returned')

    def _scheduled_at(self, start):
        with self.db.cursor() as cr:
            return self._env(cr)['resource.booking'].search_count([
                ('type_id', '=', self.booking_type), ('meeting_id', '!=', False), ('start', '=', start),
            ])

    @mute_logger('odoo.sql_db')
    def test_a_competing_booking_waits_then_fails_serialization(self):
        for race in range(RACES):
            start = next_monday_nine(race)
            first, second = self._new_booking(), self._new_booking()
            winner, loser = self._cursor(), self._cursor()
            self._schedule(self._env(winner), first, start, self.combination_a)
            thread, outcome = self._schedule_in_thread(loser, second, start, self.combination_a)
            self._wait_until_blocked(thread)
            winner.commit()
            self._finish(thread)
            self.assertIsInstance(outcome.get('error'), psycopg2.errors.SerializationFailure, f'race {race}')
            loser.rollback()
            self.assertEqual(self._scheduled_at(start), 1, f'race {race}')

    def test_a_competing_booking_proceeds_when_the_holder_rolls_back(self):
        for race in range(RACES):
            start = next_monday_nine(race)
            first, second = self._new_booking(), self._new_booking()
            winner, loser = self._cursor(), self._cursor()
            self._schedule(self._env(winner), first, start, self.combination_a)
            thread, outcome = self._schedule_in_thread(loser, second, start, self.combination_a)
            self._wait_until_blocked(thread)
            winner.rollback()
            self._finish(thread)
            self.assertNotIn('error', outcome, f'race {race}')
            loser.commit()
            self.assertEqual(self._scheduled_at(start), 1, f'race {race}')

    def test_different_resources_at_the_same_second_both_succeed(self):
        for race in range(RACES):
            start = next_monday_nine(race)
            first, second = self._new_booking(), self._new_booking()
            one, other = self._cursor(), self._cursor()
            self._schedule(self._env(one), first, start, self.combination_a)
            self._schedule(self._env(other), second, start, self.combination_b)  # no wait: another guard row
            one.commit()
            other.commit()
            self.assertEqual(self._scheduled_at(start), 2, f'race {race}')

    def test_a_fresh_snapshot_after_the_commit_meets_the_conflict(self):
        start = next_monday_nine()
        first, second = self._new_booking(), self._new_booking()
        winner = self._cursor()
        self._schedule(self._env(winner), first, start, self.combination_a)
        winner.commit()
        with self.assertRaises(UserError):
            self._schedule(self._env(self._cursor()), second, start, self.combination_a)
        self.assertEqual(self._scheduled_at(start), 1)
