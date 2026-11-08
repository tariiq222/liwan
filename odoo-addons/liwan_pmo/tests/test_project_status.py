# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading

import psycopg2

from odoo import SUPERUSER_ID, api, sql_db
from odoo.exceptions import AccessError
from odoo.tests import BaseCase, TransactionCase, get_db_name, new_test_user, tagged
from odoo.tools import mute_logger

LOCK_WAIT_SECONDS = 10


@tagged('liwan')
class TestProjectStatus(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(cls.env, login='pmo_emp', groups='liwan_core.group_employee')
        cls.manager = new_test_user(cls.env, login='pmo_mgr',
                                    groups='liwan_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'Status project'})

    def test_manager_sets_status_and_odoo_records_an_update(self):
        project = self.project.with_user(self.manager)
        self.assertEqual(project.last_update_status, 'to_define')
        project._liwan_set_status('at_risk')
        self.assertEqual(project.last_update_status, 'at_risk')
        update = self.env['project.update'].search([('project_id', '=', self.project.id)])
        self.assertEqual(len(update), 1)
        self.assertEqual(update.status, 'at_risk')

    def test_the_update_titles_are_worded_in_the_company_language(self):
        self.env['res.lang']._activate_lang('ar_001')
        self.env['ir.module.module']._load_module_terms(['liwan_pmo'], ['ar_001'])
        self.project.company_id.partner_id.lang = 'ar_001'
        project = self.project.with_user(self.manager)
        project._liwan_set_status('at_risk')
        self.env['project.task'].create({'name': 'Only task', 'project_id': self.project.id, 'state': '1_done'})
        titles = self.env['project.update'].search([('project_id', '=', self.project.id)], order='id').mapped('name')
        self.assertEqual(titles, ['تحديث الحالة', 'اكتملت جميع المهام'])

    def test_employee_cannot_set_status(self):
        with self.assertRaises(AccessError):
            self.project.with_user(self.employee)._liwan_set_status('on_track')
        self.assertEqual(self.project.last_update_status, 'to_define')

    def test_unknown_value_is_a_value_error(self):
        with self.assertRaises(ValueError):
            self.project.with_user(self.manager)._liwan_set_status('to_define')

    def test_can_manage(self):
        self.assertFalse(self.project.with_user(self.employee)._liwan_can_manage())
        self.assertTrue(self.project.with_user(self.manager)._liwan_can_manage())


@tagged('liwan')
class TestProjectCompletionStatus(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.manager = new_test_user(cls.env, login='pmo_done_mgr',
                                    groups='liwan_core.group_employee,project.group_project_manager')
        cls.project = cls.env['project.project'].create({'name': 'Completion project'})

    def _task(self, name, state='01_in_progress'):
        return self.env['project.task'].create({'name': name, 'project_id': self.project.id, 'state': state})

    def _updates(self):
        return self.env['project.update'].search([('project_id', '=', self.project.id)], order='id desc')

    def test_all_tasks_done_completes_and_reopen_restores(self):
        self.project.with_user(self.manager)._liwan_set_status('at_risk')
        first, second = self._task('A'), self._task('B')
        first.write({'state': '1_done'})
        self.assertEqual(self.project.last_update_status, 'at_risk')
        second.write({'state': '1_done'})
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertTrue(self.project.liwan_status_auto_done)
        self.assertEqual(self._updates()[0].status, 'done')
        second.write({'state': '01_in_progress'})
        self.assertEqual(self.project.last_update_status, 'at_risk')
        self.assertFalse(self.project.liwan_status_auto_done)

    def test_cancelled_tasks_do_not_block_but_do_not_complete_alone(self):
        cancelled = self._task('Cancelled', '1_canceled')
        self.assertEqual(self.project.last_update_status, 'to_define')
        self._task('Done', '1_done')
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertTrue(cancelled.exists())

    def test_project_without_tasks_never_completes(self):
        self.project._liwan_sync_completion_status()
        self.assertEqual(self.project.last_update_status, 'to_define')
        self.assertFalse(self._updates())

    def test_new_task_reopens_to_on_track_when_there_was_no_status(self):
        self._task('Done', '1_done')
        self.assertEqual(self.project.last_update_status, 'done')
        self._task('New work')
        self.assertEqual(self.project.last_update_status, 'on_track')

    def test_archiving_the_last_open_task_completes(self):
        self._task('Done', '1_done')
        open_task = self._task('Open')
        self.assertFalse(self.project.liwan_status_auto_done)
        open_task.write({'active': False})
        self.assertEqual(self.project.last_update_status, 'done')

    def test_manual_status_is_not_reverted(self):
        task = self._task('Open')
        self.project.with_user(self.manager)._liwan_set_status('done')
        task.write({'state': '1_done'})
        task.write({'state': '01_in_progress'})
        self.assertEqual(self.project.last_update_status, 'done')

    def test_manual_change_after_auto_completion_wins(self):
        task = self._task('Done', '1_done')
        self.project.with_user(self.manager)._liwan_set_status('on_hold')
        self.assertFalse(self.project.liwan_status_auto_done)
        task.write({'state': '01_in_progress'})
        self.assertEqual(self.project.last_update_status, 'on_hold')

    def test_moving_the_open_task_away_completes_its_old_project(self):
        other = self.env['project.project'].create({'name': 'Other project'})
        self._task('Done', '1_done')
        moving = self._task('Moving')
        moving.write({'project_id': other.id})
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertEqual(other.last_update_status, 'to_define')

    def test_backfill_completes_existing_projects_once(self):
        params = self.env['ir.config_parameter'].sudo()
        params.set_param('liwan_pmo.completion_status_backfill_v1_done', False)
        # An existing project whose tasks all closed before the feature existed.
        self._task('Old done', '1_done')
        self.project.write({
            'last_update_status': 'on_track', 'liwan_status_auto_done': False, 'liwan_status_before_auto_done': False,
        })
        self.assertEqual(self.project.last_update_status, 'on_track')
        self.env['project.project']._liwan_backfill_completion_status()
        self.assertEqual(self.project.last_update_status, 'done')
        self.assertTrue(self.project.liwan_status_auto_done)
        # A manager's later choice survives a second module update.
        self.project.with_user(self.manager)._liwan_set_status('on_hold')
        self.env['project.project']._liwan_backfill_completion_status()
        self.assertEqual(self.project.last_update_status, 'on_hold')

    def test_backfill_requires_superuser(self):
        with self.assertRaises(AccessError):
            self.env['project.project'].with_user(self.manager)._liwan_backfill_completion_status()

    def test_the_project_is_locked_before_the_counters_are_read(self):
        """The counters and the write are one critical section, so the lock comes first."""
        self._task('Only task')
        task_model = self.env['project.task']
        task_class = type(task_model)
        real_lock = task_class._liwan_lock_projects_then_tasks
        real_count = task_class.search_count
        steps = []

        def lock(model, projects, tasks):
            steps.append(('lock', sorted(projects.ids), list(tasks.ids)))
            return real_lock(model, projects, tasks)

        def count(model, *args, **kwargs):
            steps.append(('count', None, None))
            return real_count(model, *args, **kwargs)

        self.patch(task_class, '_liwan_lock_projects_then_tasks', lock)
        self.patch(task_class, 'search_count', count)
        self.project._liwan_sync_completion_status()
        kinds = [step[0] for step in steps]
        self.assertEqual(kinds[0], 'lock', 'the counters were read before the project row was locked')
        self.assertGreaterEqual(kinds[1:].count('count'), 2)
        # Project rows only, sorted by id: the caller may already hold its own task row.
        self.assertEqual(steps[0][1], [self.project.id])
        self.assertEqual(steps[0][2], [])

    def test_a_project_already_done_posts_no_second_update(self):
        def completions():
            return self.env['project.update'].search_count([('project_id', '=', self.project.id)])

        task = self._task('Only task')
        task.write({'state': '1_done'})
        self.assertEqual(completions(), 1)
        # A second pass over a project that is still 'done' records nothing.
        self.project._liwan_sync_completion_status()
        self.assertEqual(completions(), 1)
        task.write({'state': '1_done'})
        self.assertEqual(completions(), 1)


@tagged('post_install', '-at_install', 'liwan')
class TestProjectCompletionStatusRace(BaseCase):
    """Real transactions race the automatic completion pass of one project.

    A BaseCase holds no test transaction: each fixture is committed through its own cursor and
    removed afterwards. The competing transaction runs on its own thread because the test runner
    holds the registry lock, and it must wait on the project row the first one locked.
    """

    def setUp(self):
        super().setUp()
        # A hard gate, not a skip: committed concurrency tests never touch a development database.
        if not get_db_name().startswith('liwan_scratch_'):
            self.fail('Committed concurrency tests require a liwan_scratch_ database.')
        self.db = sql_db.db_connect(get_db_name())
        self.cursors = []
        self.project_ids = []
        # Cleanups run last in, first out: the open cursors release their locks before the fixtures go.
        self.addCleanup(self._remove_fixtures)
        self.addCleanup(self._close_cursors)

    def _env(self, cr):
        return api.Environment(cr, SUPERUSER_ID, {})

    def _cursor(self):
        cursor = self.db.cursor()
        self.cursors.append(cursor)
        # The snapshot of a REPEATABLE READ transaction starts at its first query; a bound keeps a
        # failure from hanging the run.
        cursor.execute("SET LOCAL lock_timeout = '%ds'" % LOCK_WAIT_SECONDS)
        cursor.execute('SELECT 1')
        return cursor

    def _close_cursors(self):
        for cursor in self.cursors:
            cursor.rollback()
            cursor.close()

    def _remove_fixtures(self):
        if not self.project_ids:
            return
        with self.db.cursor() as cr:
            env = self._env(cr)
            env['project.task'].with_context(active_test=False).search([
                ('project_id', 'in', self.project_ids),
            ]).unlink()
            env['project.update'].search([('project_id', 'in', self.project_ids)]).unlink()
            env['project.project'].browse(self.project_ids).exists().unlink()

    def _complete_project(self):
        """A committed, complete project that is not 'done' yet, plus its baseline completion count.

        Every task is closed but a manager then chose another status, so the next pass posts "All
        tasks are complete": exactly the pass that two concurrent task writes both run.
        """
        with self.db.cursor() as cr:
            env = self._env(cr)
            project = env['project.project'].create({'name': 'Completion race'})
            task = env['project.task'].create({'name': 'Race task', 'project_id': project.id})
            task.write({'state': '1_done'})  # the automatic completion, one update
            project.write({'last_update_status': 'on_hold', 'liwan_status_auto_done': False})
            self.project_ids.append(project.id)
            project_id = project.id
        return project_id, self._done_updates(project_id)

    def _project_with_open_tasks(self, open_tasks, done_tasks=0):
        """A committed project with OPEN_TASKS open tasks and DONE_TASKS closed ones."""
        with self.db.cursor() as cr:
            env = self._env(cr)
            project = env['project.project'].create({'name': 'Completion closers'})
            open_ids = env['project.task'].create([
                {'name': f'Closer open {index}', 'project_id': project.id}
                for index in range(open_tasks)
            ]).ids
            if done_tasks:
                env['project.task'].create([
                    {'name': f'Closer done {index}', 'project_id': project.id, 'state': '1_done'}
                    for index in range(done_tasks)
                ])
            self.project_ids.append(project.id)
            return project.id, open_ids

    def _close(self, env, task_id):
        env['project.task'].browse(task_id).write({'state': '1_done'})

    def _done_updates(self, project_id):
        with self.db.cursor() as cr:
            return self._env(cr)['project.update'].search_count([
                ('project_id', '=', project_id), ('status', '=', 'done'),
            ])

    def _read(self, project_id):
        with self.db.cursor() as cr:
            project = self._env(cr)['project.project'].browse(project_id)
            return project.last_update_status, project.liwan_status_auto_done

    def _run_pass(self, env, project_id):
        """The critical section under test, as a task mutation or a retried request runs it."""
        env['project.project'].browse(project_id)._liwan_sync_completion_status()

    def _in_thread(self, cursor, action):
        outcome = {}
        # Built here: creating an environment takes the registry lock, which module loading holds
        # while this test runs, so the thread must not create one.
        env = self._env(cursor)

        def run():
            try:
                action(env)
            except Exception as error:  # noqa: BLE001 - handed to the asserting thread
                outcome['error'] = error

        thread = threading.Thread(target=run)
        thread.start()
        return thread, outcome

    def _wait_until_blocked(self, thread):
        """Assert that THREAD is waiting on a database lock, which is what the project lock causes."""
        with self.db.cursor() as cr:
            for _ in range(LOCK_WAIT_SECONDS * 20):
                cr.execute(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() AND wait_event_type = 'Lock'",
                )
                if cr.fetchone()[0]:
                    return
                if not thread.is_alive():
                    self.fail('the competing completion pass finished without waiting for the project lock')
                thread.join(0.05)
        self.fail('the competing completion pass never waited for the project lock')

    def _finish(self, thread):
        thread.join(LOCK_WAIT_SECONDS)
        self.assertFalse(thread.is_alive(), 'the waiting completion pass never returned')

    @mute_logger('odoo.sql_db')
    def test_two_simultaneous_completion_passes_post_one_update(self):
        project_id, baseline = self._complete_project()
        winner, loser = self._cursor(), self._cursor()
        self._run_pass(self._env(winner), project_id)  # holds the project row until this commit
        thread, outcome = self._in_thread(loser, lambda env: self._run_pass(env, project_id))
        self._wait_until_blocked(thread)
        winner.commit()  # posts the completion and releases the project row
        self._finish(thread)
        # The loser waited on a row this project's completion updated after its snapshot, so
        # PostgreSQL refuses with a serialization failure and Odoo retries on a fresh snapshot. The
        # loser can never post a second "All tasks are complete".
        self.assertIsInstance(outcome.get('error'), psycopg2.errors.SerializationFailure)
        loser.rollback()
        self.assertEqual(self._done_updates(project_id), baseline + 1)
        self.assertEqual(self._read(project_id), ('done', True))
        # The retried request finds the project done and posts nothing.
        with self.db.cursor() as cr:
            self._run_pass(self._env(cr), project_id)
        self.assertEqual(self._done_updates(project_id), baseline + 1)

    @mute_logger('odoo.sql_db')
    def test_the_waiting_pass_completes_when_the_first_rolls_back(self):
        project_id, baseline = self._complete_project()
        winner, loser = self._cursor(), self._cursor()
        self._run_pass(self._env(winner), project_id)
        thread, outcome = self._in_thread(loser, lambda env: self._run_pass(env, project_id))
        self._wait_until_blocked(thread)
        winner.rollback()  # the first completion never happened, so the lock only made the loser wait
        self._finish(thread)
        self.assertNotIn('error', outcome)
        loser.commit()
        # The loser's own pass is the one completion; waiting for the lock did not discard it.
        self.assertEqual(self._done_updates(project_id), baseline + 1)
        self.assertEqual(self._read(project_id), ('done', True))

    @mute_logger('odoo.sql_db')
    def test_two_last_closers_never_post_two_completions(self):
        """The issue's case: both last tasks close in parallel and exactly one completion is posted.

        The loser waits on the project row before writing its own task. The winner's pass wrote that
        row, so the loser's REPEATABLE READ snapshot is refused with a serialization failure; Odoo
        retries the request on a fresh snapshot, which sees both tasks closed and completes once.
        """
        project_id, (first, second) = self._project_with_open_tasks(2, done_tasks=1)
        baseline = self._done_updates(project_id)
        winner, loser = self._cursor(), self._cursor()
        self._close(self._env(winner), first)  # holds the project row until this cursor commits
        thread, outcome = self._in_thread(loser, lambda env: self._close(env, second))
        self._wait_until_blocked(thread)  # the loser waits on the project row the winner holds
        winner.commit()
        self._finish(thread)
        self.assertIsInstance(outcome.get('error'), psycopg2.errors.SerializationFailure)
        loser.rollback()
        with self.db.cursor() as cr:
            self._close(self._env(cr), second)  # the request Odoo retries
        self.assertEqual(self._done_updates(project_id), baseline + 1)
        self.assertEqual(self._read(project_id), ('done', True))
