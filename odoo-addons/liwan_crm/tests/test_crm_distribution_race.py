# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading
import uuid

from psycopg2.errors import DeadlockDetected, LockNotAvailable, SerializationFailure

from odoo import SUPERUSER_ID, api, sql_db
from odoo.exceptions import ConcurrencyError
from odoo.tests import BaseCase, get_db_name, tagged
from odoo.tools import mute_logger

from odoo.addons.liwan_crm.models import intake as intake_module

WAIT_SECONDS = 20
# What odoo.service.model.retrying replays a request on: the PostgreSQL concurrency failures and ConcurrencyError.
RETRYABLE = (SerializationFailure, LockNotAvailable, DeadlockDetected, ConcurrencyError)
REPLAYS = 5


@tagged('post_install', '-at_install', 'liwan')
class TestCrmDistributionRace(BaseCase):
    """Two real transactions reach a company's first round robin at the same time.

    A ``BaseCase`` holds no test transaction: the fixtures are committed through their own cursor and
    removed afterwards, and every racing call runs on its own REPEATABLE READ connection, as two HTTP
    requests do. The race runs in the main company, which has no rotation row yet, with a committed
    distribution pool of two new agents: a new company could not be removed again, because other
    installed modules attach their own records to every company. Both snapshots open before either
    transaction creates the rotation row, so the one that loses the insert cannot read the winner's
    row and must be replayed. ``_replayed`` does what ``odoo.service.model.retrying`` does for a
    request; it cannot call ``retrying`` itself, which resets the registry under the registry lock
    that the test runner holds for the whole run. The sql_db logger is muted where the losing
    insert's expected unique violation is logged.
    """

    def setUp(self):
        super().setUp()
        # A hard gate, not a skip: committed concurrency tests never touch a development database.
        if not get_db_name().startswith('liwan_scratch_'):
            self.fail('Committed concurrency tests require a liwan_scratch_ database.')
        self.db = sql_db.db_connect(get_db_name())
        self.cursors = []
        self.created = None
        # Cleanups run last in, first out: the open cursors release their locks before the fixtures go.
        self.addCleanup(self._remove_fixtures)
        self.addCleanup(self._close_cursors)
        with self.db.cursor() as cr:
            env = self._env(cr)
            company = env.ref('base.main_company')
            for model in ('liwan.crm.rotation', 'liwan.crm.settings'):
                if env[model].search_count([('company_id', '=', company.id)]):
                    self.fail(f'The race needs a main company without a committed {model} row.')
            suffix = uuid.uuid4().hex[:8]
            agents = env['res.users'].create([
                {
                    'login': f'{login}_{suffix}', 'name': name,
                    'password': f'{login}_{suffix}_pass_123',
                    'company_id': company.id, 'company_ids': [(6, 0, [company.id])],
                }
                for login, name in (('race_agent_a', 'Race Agent A'), ('race_agent_b', 'Race Agent B'))
            ]).sorted('id')
            role = env.ref('liwan_crm.role_crm_agent')
            scoped = env['liwan.access.service'].with_company(company)
            for agent in agents:
                scoped._liwan_replace_assignments(agent, [{'role_id': role.id, 'company_id': company.id}])
            # The pool keeps every other user of the company out of the rotation; the mode is round robin.
            settings = env['liwan.crm.settings'].create({
                'company_id': company.id, 'distribution_user_ids': [(6, 0, agents.ids)],
            })
            source = env['utm.source'].create({'name': f'Race source {suffix}'})
            # Plain ids only: a recordset is bound to its cursor, and this one closes below.
            created = {
                'company': company.id, 'agents': agents.ids, 'partners': agents.partner_id.ids,
                'settings': settings.id, 'source': source.id,
            }
        self.created = created
        self.company_id = created['company']
        self.source_id = created['source']
        self.agent_ids = created['agents']
        self.assertEqual(len(self.agent_ids), 2)

    def _env(self, cr):
        return api.Environment(cr, SUPERUSER_ID, {'tz': 'UTC', 'mail_auto_subscribe_no_notify': True})

    def _racer(self):
        """The environment of a REPEATABLE READ transaction whose snapshot opens now.

        Built on the test thread: an environment for a new cursor takes the registry lock, which the
        test runner holds for the whole run, so a racing thread that built its own would never start.
        """
        cursor = self.db.cursor()
        self.cursors.append(cursor)
        cursor.execute("SET LOCAL lock_timeout = '%ds'" % WAIT_SECONDS)
        cursor.execute('SELECT 1')  # the snapshot starts here, before any rotation row exists
        return self._env(cursor)

    def _close_cursors(self):
        for cursor in self.cursors:
            if not cursor.closed:
                cursor.rollback()
                cursor.close()

    def _remove_fixtures(self):
        """Delete what setUp and the races committed, by id, in a transaction of its own.

        Every opportunity of the test carries the race source. The main company had no rotation row
        before the test, so its row is the one the races created. The agents' role assignments go with them.
        """
        if not self.created:
            return
        created = self.created
        with self.db.cursor() as cr:
            env = self._env(cr)
            race_source = [('source_id', '=', created['source'])]
            env['crm.lead'].with_context(active_test=False).search(race_source).unlink()
            env['liwan.crm.import.batch'].search(race_source).unlink()
            env['liwan.crm.rotation'].search([('company_id', '=', created['company'])]).unlink()
            env['liwan.crm.settings'].browse(created['settings']).exists().unlink()
            env['res.users'].browse(created['agents']).exists().unlink()
            env['res.partner'].browse(created['partners']).exists().unlink()
            env['utm.source'].browse(created['source']).exists().unlink()

    def _company(self, env):
        return env['res.company'].browse(self.company_id)

    def _leads(self, count):
        with self.db.cursor() as cr:
            return self._env(cr)['crm.lead'].create([
                {'name': f'Race lead {index}', 'company_id': self.company_id, 'source_id': self.source_id, 'user_id': False}
                for index in range(count)
            ]).ids

    def _committed_rotations(self):
        """``[(id, last_user_id)]`` of the company's committed rotation rows, read in a fresh transaction."""
        with self.db.cursor() as cr:
            rows = self._env(cr)['liwan.crm.rotation'].search([('company_id', '=', self.company_id)])
            return [(row.id, row.last_user_id.id) for row in rows]

    def _committed_owners(self, domain):
        """``{lead id: user id}`` of the test's committed leads matching ``domain``."""
        with self.db.cursor() as cr:
            leads = self._env(cr)['crm.lead'].search([('source_id', '=', self.source_id), *domain])
            return {lead.id: lead.user_id.id for lead in leads}

    @staticmethod
    def _replay_once(env):
        """Roll back and drop every cache, as ``retrying`` does, so the next run reads a fresh snapshot."""
        env.cr.rollback()
        env.clear()
        env.cr.execute("SET LOCAL lock_timeout = '%ds'" % WAIT_SECONDS)

    def _replayed(self, env, work):
        """``(result, attempts)`` of ``work(env)`` committed, replayed on a retryable failure like a request.

        ``work`` returns plain values, never records, because a replay rolls the transaction back.
        """
        attempt = 1
        while True:
            try:
                result = work(env)
                env.cr.commit()
                return result, attempt
            except RETRYABLE:
                if attempt == REPLAYS:
                    raise
            self._replay_once(env)
            attempt += 1

    def _run_both(self, first, second):
        """``{'first': (result, attempts), 'second': ...}`` of two transactions started together."""
        outcomes = {}
        racers = {'first': (self._racer(), first), 'second': (self._racer(), second)}

        def run(key, env, work):
            try:
                outcomes[key] = ('ok', self._replayed(env, work))
            except Exception as error:  # noqa: BLE001 - handed to the asserting thread
                outcomes[key] = ('error', error)

        threads = [threading.Thread(target=run, args=(key, env, work)) for key, (env, work) in racers.items()]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(WAIT_SECONDS * 2)
            self.assertFalse(thread.is_alive(), 'a racing transaction never returned')
        for key, (status, value) in outcomes.items():
            self.assertEqual(status, 'ok', f'{key} raised {value!r}')
        results = {key: value for key, (_status, value) in outcomes.items()}
        self.assertGreater(
            max(attempts for _result, attempts in results.values()), 1,
            'the transaction that lost the first insert was replayed in a fresh snapshot',
        )
        return {key: result for key, (result, _attempts) in results.items()}

    @mute_logger('odoo.sql_db')
    def test_two_transactions_initialise_the_rotation_atomically(self):
        def initialise(env):
            return env['liwan.crm.distribution']._liwan_locked_rotation(self._company(env)).id

        found = self._run_both(initialise, initialise)
        rotations = self._committed_rotations()
        self.assertEqual(len(rotations), 1, 'exactly one rotation row exists')
        self.assertEqual({found['first'], found['second']}, {rotations[0][0]}, 'both locked the same row')

    @mute_logger('odoo.sql_db')
    def test_first_round_robin_in_two_transactions_splits_the_two_leads(self):
        lead_a, lead_b = self._leads(2)

        def assign(lead_id):
            def work(env):
                lead = env['crm.lead'].browse(lead_id)
                env['liwan.crm.distribution'].with_company(self._company(env))._liwan_assign(lead)
                return lead.user_id.id
            return work

        picked = self._run_both(assign(lead_a), assign(lead_b))
        rotations = self._committed_rotations()
        self.assertEqual(len(rotations), 1, 'the two transactions share exactly one rotation row')
        owners = self._committed_owners([('id', 'in', [lead_a, lead_b])])
        self.assertEqual(sorted(owners.values()), self.agent_ids, 'each agent took one lead, none was lost')
        self.assertEqual(sorted(picked.values()), self.agent_ids, 'each transaction kept its own pick')
        # The allocations are serialised on the row: the first takes the lowest eligible id and the
        # replayed one reads it and takes the next, so the row ends on the higher id in either order.
        self.assertEqual(rotations[0][1], self.agent_ids[1], 'the row records the later pick')

    @mute_logger('odoo.sql_db')
    def test_two_imports_commit_concurrently_without_losing_a_batch(self):
        mapping = {'name': 'Name', 'phone': 'Phone'}
        jobs = [
            (intake_module.SourceRow(2, {'Name': name, 'Phone': phone}), file_name)
            for name, phone, file_name in (
                ('Race Customer A', '0501110001', 'Race A.csv'),
                ('Race Customer B', '0501110002', 'Race B.csv'),
            )
        ]

        def commit(index):
            row, file_name = jobs[index]

            def work(env):
                company = self._company(env)
                batch = env['liwan.crm.intake'].with_company(company)._liwan_commit(
                    [row], mapping, env['utm.source'].browse(self.source_id), env['res.users'],
                    company, env['res.users'].browse(SUPERUSER_ID), file_name,
                )
                return batch.created_count, batch.unassigned_count

            return work

        results = self._run_both(commit(0), commit(1))
        self.assertEqual(sorted(results.values()), [(1, 0), (1, 0)], 'each import created its one opportunity')
        rotations = self._committed_rotations()
        self.assertEqual(len(rotations), 1, 'the two imports share exactly one rotation row')
        owners = self._committed_owners([('type', '=', 'opportunity')])
        self.assertEqual(sorted(owners.values()), self.agent_ids, 'round robin gave one opportunity to each agent')
        self.assertEqual(rotations[0][1], self.agent_ids[1], 'the row records the later pick')

    @mute_logger('odoo.sql_db')
    def test_a_row_this_snapshot_cannot_see_is_reported_retryable_never_locked_empty(self):
        """The defect of the first-use race: a committed row the snapshot cannot see was locked as an empty set."""
        stale = self._racer()
        with self.db.cursor() as cr:
            self._env(cr)['liwan.crm.rotation'].create({'company_id': self.company_id})
        rotations = self._committed_rotations()
        self.assertEqual(len(rotations), 1, 'the competing transaction committed the row')
        distribution = stale['liwan.crm.distribution']
        self.assertFalse(
            distribution._liwan_rotation(self._company(stale)),
            'the older snapshot cannot read the committed row, which is the real first-use race',
        )
        with self.assertRaises(ConcurrencyError):
            distribution._liwan_locked_rotation(self._company(stale))
        # The replay Odoo performs on that error reads a fresh snapshot, which sees and locks the row.
        self._replay_once(stale)
        self.assertEqual(distribution._liwan_locked_rotation(self._company(stale)).id, rotations[0][0])
