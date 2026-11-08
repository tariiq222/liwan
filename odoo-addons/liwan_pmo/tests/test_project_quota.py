# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading
from unittest.mock import patch

import psycopg2

from odoo import SUPERUSER_ID, api, sql_db
from odoo.tests import BaseCase, TransactionCase, get_db_name, new_test_user, tagged
from odoo.tools import mute_logger

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.liwan_pmo.models.entitlement_service import PROJECTS_LIMIT

WAIT_SECONDS = 10


class _Fence:
    """A tenant-profile stand-in that records the order of one project claim.

    It answers the fence reads ``_liwan_claim`` performs itself (the lifecycle and the limit payload),
    so the claim runs for real without writing a database row.
    """

    status = 'active'
    valid_until = False
    commercial_valid_until = False

    def __init__(self):
        self.features = {PROJECTS_LIMIT: None}
        self.locked = False
        self.bumps = 0

    def _liwan_lock(self):
        self.locked = True
        return self

    def _liwan_bump_quota_revision(self):
        self.bumps += 1
        return self.bumps


@tagged('post_install', '-at_install', 'liwan')
class TestProjectQuota(TransactionCase):
    """liwan_pmo registers the project counter that liwan_platform's limits use (ruling R-F)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.record = cls.env.ref('liwan_platform.tenant_profile')
        cls.record._liwan_initialize_legacy_policy(
            cls.env['liwan.feature.registry']._liwan_installed_module_ids(),
        )
        cls.service = cls.env['liwan.entitlement.service'].sudo()

    def _operator(self):
        return self.record.with_context(**{OPERATOR_CONTEXT: True})

    def test_usage_counter_is_registered_by_liwan_pmo(self):
        self.env['project.project'].create({'name': 'Counted project'})
        self.assertEqual(
            self.service._liwan_count_usage('projects.max_projects'),
            self.service._liwan_count_projects(),
        )
        self.assertGreaterEqual(self.service._liwan_count_projects(), 1)
        self.assertEqual(self.service._liwan_count_usage('users.limit'), self.service._liwan_count_users())

    def test_project_limit_blocks_create_and_restore(self):
        project = self.env['project.project'].create({'name': 'Quota project'})
        current = self.service._liwan_count_projects()
        self._operator().write({'features': {**self.record.features, 'projects.max_projects': current}})
        with self.assertRaises(LiwanAccessRule):
            self.env['project.project'].create({'name': 'Over quota'})
        project.write({'active': False})
        self.assertEqual(self.service._liwan_count_projects(), current - 1)
        extra = self.env['project.project'].create({'name': 'Takes freed slot'})
        self.assertEqual(self.service._liwan_count_projects(), current)
        with self.assertRaises(LiwanAccessRule):
            project.write({'active': True})
        extra.unlink()
        project.write({'active': True})
        self.assertEqual(self.service._liwan_count_projects(), current)

    def test_project_manager_claims_the_quota_unelevated(self):
        """Project create/archive/restore call the entitlement service in the caller's environment;
        the service elevates its own tenant-profile read, so a non-system manager still claims."""
        manager = new_test_user(
            self.env, login='quota_pm', groups='liwan_core.group_employee,project.group_project_manager',
        )
        self.assertFalse(manager.has_group('base.group_system'))
        Project = self.env['project.project'].with_user(manager)
        project = Project.create({'name': 'Manager quota', 'user_id': manager.id, 'date': '2030-12-31'})
        current = self.service._liwan_count_projects()
        self._operator().write({'features': {**self.record.features, 'projects.max_projects': current}})
        with self.assertRaises(LiwanAccessRule):
            Project.create({'name': 'Manager over quota', 'user_id': manager.id, 'date': '2030-12-31'})
        project.write({'active': False})
        self.assertEqual(self.service._liwan_count_projects(), current - 1)
        project.write({'active': True})
        self.assertEqual(self.service._liwan_count_projects(), current)

    def test_projects_are_counted_after_the_tenant_fence_is_taken(self):
        """A create reads the project count only after taking the profile row lock.

        Counting first let two concurrent creates read the same count before either held the fence.
        The stand-in records the lock in memory, so this proves the ordering without depending on a
        database lock. An archive (a negative delta) frees a slot and is never refused, so it counts
        nothing at all rather than reading a usage it cannot contradict.
        """
        service = self.env['liwan.entitlement.service']

        def claim(delta):
            fence = _Fence()
            locked_at_count = []

            def count_projects(records):
                locked_at_count.append(fence.locked)
                return 0

            with (
                patch.object(type(service), '_liwan_profile', lambda records: fence),
                patch.object(type(service), '_liwan_count_projects', count_projects),
            ):
                self.assertTrue(service._liwan_claim_projects(delta))
            return fence, locked_at_count

        fence, locked_at_count = claim(1)
        self.assertEqual(
            locked_at_count, [True], 'the create counted before the tenant fence was taken',
        )
        self.assertEqual(fence.bumps, 1, 'a fitting create bumps the quota revision once')

        fence, locked_at_count = claim(-1)
        self.assertEqual(locked_at_count, [], 'the archive counted a usage that it only releases')
        self.assertEqual(fence.bumps, 1, 'an archive bumps the quota revision')


@tagged('post_install', '-at_install', 'liwan')
class TestProjectQuotaRace(BaseCase):
    """Two real transactions spend the tenant's last project slot at the same time.

    The asserted guarantee is the outcome, not an internal call order: exactly one create commits, the
    other never does, and the tenant does not end above ``projects.max_projects``. Odoo runs
    REPEATABLE READ, so a loser whose snapshot predates the winner's commit cannot see the winner's
    project even once it holds the fence, and its own count would still admit it. What refuses it is
    the tenant profile row the winner updated (``_liwan_bump_quota_revision``): taking the fence is a
    row lock on a row a concurrent transaction changed after this snapshot, which PostgreSQL answers
    with a serialization failure rather than with a stale count. Odoo's request retry then reruns the
    request from a fresh snapshot, which counts the winner's project and refuses the create with
    ``LiwanAccessRule``.

    Both halves are asserted here, the second by a fresh transaction standing for the retried
    request. This test pins the *outcome* that must hold whatever the internal order, because under
    REPEATABLE READ the serialization failure refuses the loser either way; the ordering itself is
    pinned by ``TestProjectQuota.test_projects_are_counted_after_the_tenant_fence_is_taken``.

    A ``BaseCase`` holds no test transaction, so its fixtures are committed through their own
    cursors and released afterwards: the projects are removed and the tenant's project limit and
    quota revision are written back. A one-shot legacy policy this class may have to initialize
    stays, exactly as ``TestProjectQuota`` leaves it.
    """

    def setUp(self):
        super().setUp()
        # A hard gate, not a skip: committed concurrency tests never touch a development database.
        if not get_db_name().startswith('liwan_scratch_'):
            self.fail('Committed concurrency tests require a liwan_scratch_ database.')
        self.db = sql_db.db_connect(get_db_name())
        self.cursors = []
        self.backends = {}
        self.threads = []
        self.project_ids = []
        # Cleanups run last in, first out: the open cursors release their locks before the rows go.
        self.addCleanup(self._remove_fixtures)
        self.addCleanup(self._close_cursors)
        with self.db.cursor() as cr:
            env = self._env(cr)
            profile = env.ref('liwan_platform.tenant_profile')
            # A fresh database may not have a policy yet; initializing it here is what the rest of
            # the suite does too, and the values it produces are what the cleanup restores.
            profile._liwan_initialize_legacy_policy(
                env['liwan.feature.registry']._liwan_installed_module_ids(),
            )
            # Every policy value this test overwrites; the cleanup writes them back.
            self.initial_features = dict(profile.features or {})
            self.initial_retained = list(profile.retained_read_features or [])
            self.policy_revision = profile.policy_revision
            self.quota_revision = profile.quota_revision
            # One free slot: one create fits, and a second one in the same window must not.
            self.limit = env['liwan.entitlement.service']._liwan_count_projects() + 1
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({
                'features': {**self.initial_features, PROJECTS_LIMIT: self.limit},
            })
            self.profile_id = profile.id  # last, so a failure above leaves the cleanup nothing to do

    def _env(self, cr):
        return api.Environment(cr, SUPERUSER_ID, {})

    def _cursor(self):
        cursor = self.db.cursor()
        self.cursors.append(cursor)
        # The snapshot of a REPEATABLE READ transaction starts at its first query, so this one
        # predates any later commit; the timeout bounds a lock wait instead of hanging the test.
        cursor.execute("SET LOCAL lock_timeout = '%ds'" % WAIT_SECONDS)
        cursor.execute('SELECT 1')
        cursor.execute('SELECT pg_backend_pid()')
        self.backends[cursor] = cursor.fetchone()[0]
        return cursor

    def _close_cursors(self):
        for thread in self.threads:
            thread.join(WAIT_SECONDS)
        for cursor in self.cursors:
            if not cursor.closed:
                cursor.rollback()
                cursor.close()

    def _remove_fixtures(self):
        if not hasattr(self, 'profile_id'):
            return
        with self.db.cursor() as cr:
            env = self._env(cr)
            projects = env['project.project'].with_context(active_test=False).browse(self.project_ids).exists()
            projects.unlink()
            profile = env['liwan.tenant.profile'].browse(self.profile_id)
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({
                'features': self.initial_features,
                'retained_read_features': self.initial_retained,
                'policy_revision': self.policy_revision,
                'quota_revision': self.quota_revision,
            })

    def _create_in_thread(self, env, name, outcome):
        # Built by the caller: creating an environment takes the registry lock, which module
        # loading holds while this test runs, so the thread must not create one.
        def run():
            try:
                outcome['id'] = env['project.project'].create({'name': name}).id
            except Exception as error:  # noqa: BLE001 - handed to the asserting thread
                outcome['error'] = error

        thread = threading.Thread(target=run)
        self.threads.append(thread)
        thread.start()
        return thread

    def _wait_until_blocked(self, cursor, thread, outcome):
        """Wait until CURSOR's backend is queued on a lock: it has reached the tenant fence.

        ``pg_locks`` is readable by every role, unlike the per-session columns of
        ``pg_stat_activity``; the state is read from another session because the racing cursor
        belongs to the thread while it runs.
        """
        backend = self.backends[cursor]
        for _ in range(WAIT_SECONDS * 20):
            with self.db.cursor() as cr:
                cr.execute('SELECT count(*) FROM pg_locks WHERE pid = %s AND NOT granted', [backend])
                waiting = cr.fetchone()[0]
            if waiting:
                return
            if not thread.is_alive():
                detail = outcome.get('error') or outcome.get('id')
                self.fail(f'the competing create returned without waiting for the tenant fence: {detail!r}')
            thread.join(0.05)
        self.fail('the competing create never waited for the tenant fence')

    def _count_projects(self):
        with self.db.cursor() as cr:
            return self._env(cr)['liwan.entitlement.service']._liwan_count_projects()

    @mute_logger('odoo.sql_db')
    def test_two_concurrent_creates_spend_the_last_slot_once(self):
        winner_cr, loser_cr = self._cursor(), self._cursor()
        outcome = {}
        thread = None
        try:
            winner = self._env(winner_cr)['project.project'].create({'name': 'Quota race winner'})
            self.project_ids.append(winner.id)
            winner_cr.flush()
            thread = self._create_in_thread(self._env(loser_cr), 'Quota race loser', outcome)
            self._wait_until_blocked(loser_cr, thread, outcome)
            # The loser's snapshot predates this commit, so it cannot see the winner's project.
            winner_cr.commit()
            thread.join(WAIT_SECONDS)
            self.assertFalse(thread.is_alive(), 'the competing create never returned')
            self.assertNotIn('id', outcome, 'both concurrent creates committed')
            self.assertIsInstance(
                outcome.get('error'), psycopg2.errors.SerializationFailure,
                'the stale snapshot must be refused by the tenant fence, not pass the count',
            )
        finally:
            if thread is not None:
                # Release the fence first, so a still-blocked loser cannot outlive the test. A loser
                # that unexpectedly committed is rolled back with its own cursor, so its project
                # never reaches the committed fixtures.
                winner_cr.rollback()
                thread.join(WAIT_SECONDS)
            for cursor in (winner_cr, loser_cr):
                if not cursor.closed:
                    cursor.rollback()
                    cursor.close()

        # One slot was free and one project took it: the tenant sits exactly at its limit.
        self.assertEqual(self._count_projects(), self.limit)

        # The retried request (odoo.service.model.retrying) runs from a fresh snapshot, counts the
        # winner's project, and reports the limit instead of spending a slot that is gone.
        retry_cr = self._cursor()
        with self.assertRaises(LiwanAccessRule) as error:
            self._env(retry_cr)['project.project'].create({'name': 'Quota race loser retried'})
        self.assertEqual(error.exception.status, 403)
        self.assertEqual(error.exception.details, {'reason': 'limit', 'limit_key': PROJECTS_LIMIT})
