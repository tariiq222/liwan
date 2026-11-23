# Part of Odoo. See LICENSE file for full copyright and licensing details.
import json
import os
import re
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import wt
from worktree_lanes import LaneError, Take, read_take, resting, write_take
from wt import (
    WorktreeError,
    clean_env,
    database_name,
    env_content,
    parse_worktrees,
    pick_port,
    used_ports,
)

PORCELAIN = """worktree /r/main
HEAD aaaa
branch refs/heads/main

worktree /r/main/.worktrees/pmo-a
HEAD bbbb
branch refs/heads/pmo-a

worktree /r/detached
HEAD cccc
detached
"""


class TestWt(unittest.TestCase):
    def test_database_name_matches_scratch_pattern(self):
        for suffix in ('pmo-fix-x', 'web-' + 'a' * 80, 'docs-A_b--c'):
            self.assertRegex(database_name(suffix), r'^liwan_scratch_[a-z0-9_]{1,42}$')

    def test_short_database_name_is_unchanged(self):
        self.assertEqual(database_name('pmo-fix-x'), 'liwan_scratch_pmo_fix_x')

    def test_long_names_with_the_same_prefix_get_different_databases(self):
        prefix = 'web-' + 'a' * 60
        first, second = database_name(prefix + '-one'), database_name(prefix + '-two')
        self.assertNotEqual(first, second)
        for name in (first, second):
            self.assertRegex(name, r'^liwan_scratch_[a-z0-9_]{1,42}$')
            self.assertRegex(name, r'_[0-9a-f]{6}$')

    def test_pick_port_skips_used_and_busy(self):
        self.assertEqual(pick_port(range(10, 15), {10}, lambda p: p != 11), 12)
        with self.assertRaises(WorktreeError):
            pick_port(range(10, 12), {10, 11}, lambda p: True)

    def test_nuxt_allocator_keeps_vendor_ports_free_when_they_are_idle(self):
        self.assertEqual(pick_port(wt.NUXT_PORTS, set(), lambda port: True), 3101)
        self.assertEqual(pick_port(wt.NUXT_PORTS, {3101, 3102}, lambda port: True), 3104)

    def test_env_content_is_consistent(self):
        text = env_content(3101, 8171, 'liwan_scratch_x')
        self.assertIn('NUXT_ODOO_URL=http://127.0.0.1:8171', text)
        self.assertIn('NUXT_PUBLIC_WS_URL=ws://localhost:8171/websocket', text)
        self.assertEqual(set(map(int, re.findall(r'PORT=(\d+)', text))), {3101, 8171})

    def test_used_ports_reads_sibling_worktrees(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'a').mkdir()
            (Path(tmp) / 'a' / '.env.worktree').write_text(env_content(3105, 8180, 'liwan_scratch_a'), encoding='utf-8')
            self.assertEqual(used_ports(Path(tmp)), {3105, 8180})

    def test_used_ports_reads_registered_worktree_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / 'elsewhere'
            other.mkdir()
            (other / '.env.worktree').write_text(env_content(3110, 8190, 'liwan_scratch_b'), encoding='utf-8')
            self.assertEqual(used_ports(Path(tmp) / 'none', [str(other), str(Path(tmp) / 'missing')]), {3110, 8190})

    def test_parse_worktrees(self):
        self.assertEqual(parse_worktrees(PORCELAIN), [
            ('/r/main', 'refs/heads/main'),
            ('/r/main/.worktrees/pmo-a', 'refs/heads/pmo-a'),
            ('/r/detached', None),
        ])

    def test_port_is_busy_when_only_ipv6_loopback_listens(self):
        if not socket.has_ipv6:
            self.skipTest('no IPv6')
        try:
            server = socket.socket(socket.AF_INET6)
            server.bind(('::1', 0))
        except OSError:
            self.skipTest('::1 unavailable')
        with server:
            server.listen(1)
            self.assertFalse(wt.port_is_free(server.getsockname()[1]))

    def test_port_is_free_without_ipv6_support(self):
        real = socket.socket

        def only_ipv4(family=socket.AF_INET, *args, **kwargs):
            if family == socket.AF_INET6:
                message = 'no ipv6'
                raise OSError(message)
            return real(family, *args, **kwargs)

        with mock.patch.object(wt.socket, 'socket', only_ipv4):
            self.assertTrue(wt.port_is_free(1))

    def test_repo_root_refuses_a_common_dir_that_is_not_dot_git(self):
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(wt, 'sh', return_value=tmp):
            with self.assertRaises(WorktreeError):
                wt.repo_root()

    def test_repo_root_is_the_parent_of_the_common_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / '.git').mkdir()
            with mock.patch.object(wt, 'sh', return_value=str(Path(tmp) / '.git')):
                self.assertEqual(wt.repo_root(), Path(tmp))

    def test_failed_install_reports_code_tail_and_recovery(self):
        with mock.patch.object(wt, 'run', return_value=(1, 'x' * 1000 + 'END')):
            with self.assertRaises(WorktreeError) as caught:
                wt.install_dependencies(Path('/some/path'))
        message = str(caught.exception)
        self.assertIn('exit 1', message)
        self.assertTrue(message.count('x') <= 400)
        self.assertIn('END', message)
        self.assertIn('cd /some/path && npm ci --ignore-scripts && npm -w apps/web run postinstall', message)


def worktree(**overrides):
    values = dict(
        path=Path('/r/.worktrees/pmo-a'), branch='pmo-a', is_main=False, canonical=True, ahead=0, behind=3,
        merged=True, dirty=False, age_days=2, size=2048, database='liwan_scratch_pmo_a', ports=[3100, 8170])
    values.update(overrides)
    return wt.Worktree(**values)


class TestStatusAndGc(unittest.TestCase):
    def test_format_age_and_size(self):
        self.assertEqual([wt.format_age(d) for d in (0, 3, 45, 800)], ['today', '3d', '1mo', '2y'])
        self.assertEqual((wt.format_size(None), wt.format_size(2048), wt.format_size(2 * 1048576)), ('-', '2M', '2.0G'))

    def test_env_values_reads_database_and_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / '.env.worktree').write_text(env_content(3105, 8180, 'liwan_scratch_a'), encoding='utf-8')
            values = wt.env_values(tmp)
            self.assertEqual((values['NUXT_ODOO_DB'], values['NUXT_PORT']), ('liwan_scratch_a', '3105'))
            self.assertEqual(wt.env_values(Path(tmp) / 'missing'), {})

    def test_removable_needs_merged_clean_own_commits_unused_and_not_current(self):
        keep = [
            worktree(merged=False), worktree(dirty=True), worktree(own_commits=False), worktree(branch=None),
            worktree(is_main=True), worktree(path=Path('/r/.worktrees/busy')),
            worktree(path=Path('/r/.worktrees/current')), worktree(path=Path('/r/.worktrees/gone'), missing=True),
        ]
        busy = {Path('/r/.worktrees/busy/apps/web')}
        self.assertEqual(wt.removable(keep, busy, Path('/r/.worktrees/current/apps/web')), [])
        self.assertEqual(wt.removable([worktree()], busy, Path('/elsewhere')), [worktree()])

    def test_current_worktree_is_detected_from_a_subfolder(self):
        self.assertEqual(wt.removable([worktree()], set(), Path('/r/.worktrees/pmo-a/apps/web')), [])

    def test_missing_folder_is_reported_not_fatal(self):
        root = Path('/r')
        entry = wt.inspect_worktree(root, '/r/.worktrees/pmo-gone', 'refs/heads/pmo-gone')
        self.assertTrue(entry.missing)
        self.assertEqual(entry.database, 'liwan_scratch_pmo_gone')
        text = wt.format_status([worktree(is_main=True, path=root), entry], root, {})
        self.assertIn('missing', text)
        self.assertIn('1 folder missing', text)

    def test_abandoned_databases_only_those_of_going_worktrees_and_unconnected(self):
        databases = {
            'liwan_scratch_pmo_a': 0, 'liwan_scratch_e2e': 0, 'liwan_scratch_hand_ux': 0,
            'liwan_scratch_live': 2, 'liwan_scratch_kept': 0,
        }
        owners = [worktree(), worktree(database='liwan_scratch_e2e'), worktree(database='liwan_scratch_live'),
                  worktree(database='liwan_scratch_kept')]
        survivors = [worktree(database='liwan_scratch_kept')]
        with mock.patch.object(wt, 'scratch_databases', return_value=databases):
            self.assertEqual(wt.abandoned_databases(owners, survivors), ['liwan_scratch_pmo_a'])

    def test_no_database_lookup_without_candidates(self):
        with mock.patch.object(wt, 'scratch_databases', side_effect=AssertionError):
            self.assertEqual(wt.abandoned_databases([worktree(database=None)], []), [])

    def test_scratch_databases_parse_with_separator(self):
        with mock.patch.object(wt.shutil, 'which', return_value='/bin/psql'), \
                mock.patch.object(wt, 'run', return_value=(0, 'liwan_scratch_old|0\nodoo19|3\n')):
            self.assertEqual(wt.scratch_databases(), {'liwan_scratch_old': 0})

    def test_scratch_databases_fail_loudly(self):
        with mock.patch.object(wt.shutil, 'which', return_value=None), self.assertRaises(WorktreeError):
            wt.scratch_databases()
        with mock.patch.object(wt.shutil, 'which', return_value='/bin/psql'), \
                mock.patch.object(wt, 'run', return_value=(2, 'no server')), self.assertRaises(WorktreeError) as caught:
            wt.scratch_databases()
        self.assertIn('no server', str(caught.exception))

    def test_format_status_has_a_row_per_worktree_a_summary_shared_files_and_the_violations(self):
        root = Path('/r')
        lane = worktree(path=Path('/r/.worktrees/one'), take=Take('tools-x', 'session-a', 'task', 1, None, 'orch-1'))
        resting_lane = worktree(path=Path('/r/.worktrees/two'), take=resting())
        outside = worktree(canonical=False, dirty=True, path=Path('/x/y'))
        changes = {'one': frozenset({'a.py', 'b.py'}), 'two': frozenset({'b.py'})}
        text = wt.format_status([worktree(is_main=True, path=root), lane, resting_lane, outside], root, changes)
        lines = text.splitlines()
        self.assertIn('ORCHESTRATOR', lines[0])
        self.assertIn('orch-1', lines[1])  # sorted by orchestrator: the occupied lane comes first
        self.assertIn('session-a', lines[1])
        self.assertIn('resting', lines[3])
        self.assertIn('/x/y *', lines[4])
        self.assertTrue(lines[6].startswith('3 worktrees: 3 merged, 1 dirty, 1 outside .worktrees'))
        self.assertIn('2 lanes, 1 occupied', lines[6])
        self.assertIn('one and two: b.py', text)
        self.assertIn('rule violations (reported only', text)
        self.assertIn('/x/y: outside .worktrees/', text)

    def _gc(self, apply, sh_side_effect):
        patches = (
            mock.patch.object(wt, 'inspect_all', return_value=[worktree()]), mock.patch.object(wt, 'busy_paths', return_value=set()),
            mock.patch.object(wt, 'scratch_databases', return_value={'liwan_scratch_pmo_a': 0, 'liwan_scratch_old': 0}),
            mock.patch.object(wt, 'sh', side_effect=sh_side_effect),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            return wt.gc(Path('/r'), apply, Path('/elsewhere'))

    def test_gc_dry_run_removes_nothing_and_warns_about_ignored_files(self):
        calls = []
        dry = self._gc(False, lambda argv, cwd: calls.append(argv))
        self.assertEqual(calls, [])
        self.assertIn('would remove worktree /r/.worktrees/pmo-a', dry)
        self.assertIn('would drop database liwan_scratch_pmo_a', dry)
        self.assertNotIn('liwan_scratch_old', dry)
        self.assertIn('ignored files', dry)

    def test_gc_apply_removes_worktree_branch_and_its_database(self):
        calls = []

        def fake(argv, cwd):
            calls.append(argv)
            return 'main'

        self._gc(True, fake)
        self.assertEqual(calls, [
            ['git', 'branch', '--show-current'], ['git', 'worktree', 'remove', '/r/.worktrees/pmo-a'],
            ['git', 'branch', '-d', 'pmo-a'], ['dropdb', '--if-exists', 'liwan_scratch_pmo_a']])

    def test_gc_apply_refuses_when_root_is_not_on_main(self):
        with self.assertRaises(WorktreeError):
            self._gc(True, lambda argv, cwd: 'feature')

    def test_gc_apply_reports_failures_and_keeps_going(self):
        calls = []

        def fake(argv, cwd):
            calls.append(argv)
            if argv[:3] == ['git', 'worktree', 'remove']:
                message = 'locked'
                raise WorktreeError(message)
            return 'main'

        with self.assertRaises(WorktreeError) as caught:
            self._gc(True, fake)
        self.assertIn('locked', str(caught.exception))
        self.assertNotIn(['git', 'branch', '-d', 'pmo-a'], calls)  # the worktree is still there
        self.assertNotIn(['dropdb', '--if-exists', 'liwan_scratch_pmo_a'], calls)  # its worktree survived

    def test_gc_reports_when_nothing_qualifies(self):
        with mock.patch.object(wt, 'inspect_all', return_value=[worktree(dirty=True)]), \
                mock.patch.object(wt, 'busy_paths', return_value=set()):
            self.assertEqual(wt.gc(Path('/r'), True, Path('/x')), 'nothing to clean')

    def _gc_branch(self, worktrees, branch, busy=(), merged_branch=False, apply=False, current='/elsewhere'):
        calls = []

        def fake(argv, cwd):
            calls.append(argv)
            return 'main'

        with mock.patch.object(wt, 'inspect_all', return_value=worktrees), \
                mock.patch.object(wt, 'busy_paths', return_value=set(busy)), \
                mock.patch.object(wt, 'scratch_databases', return_value={'liwan_scratch_pmo_a': 0, 'liwan_scratch_pmo_b': 0}), \
                mock.patch.object(wt, 'merged_local_branch', return_value=merged_branch), \
                mock.patch.object(wt, 'sh', side_effect=fake):
            return wt.gc(Path('/r'), apply, Path(current), branch), calls

    def test_gc_branch_limits_victims_and_databases_to_that_branch(self):
        other = worktree(path=Path('/r/.worktrees/pmo-b'), branch='pmo-b', database='liwan_scratch_pmo_b')
        text, calls = self._gc_branch([worktree(), other], 'pmo-a', apply=True)
        self.assertIn('removing worktree /r/.worktrees/pmo-a', text)
        self.assertNotIn('pmo-b', text)
        self.assertIn(['git', 'branch', '-d', 'pmo-a'], calls)
        self.assertIn(['dropdb', '--if-exists', 'liwan_scratch_pmo_a'], calls)
        self.assertNotIn(['dropdb', '--if-exists', 'liwan_scratch_pmo_b'], calls)

    def test_gc_branch_raises_with_the_reason_when_the_worktree_is_kept(self):
        cases = (
            (worktree(dirty=True), (), '/elsewhere', 'uncommitted changes'),
            (worktree(merged=False), (), '/elsewhere', 'not merged into main'),
            (worktree(), (Path('/r/.worktrees/pmo-a'),), '/elsewhere', 'process is running'),
            (worktree(), (), '/r/.worktrees/pmo-a/apps', 'run this from the main checkout'),
            (worktree(own_commits=False), (), '/elsewhere', 'no commits of its own'),
        )
        for entry, busy, current, reason in cases:
            for apply in (False, True):
                with self.subTest(reason=reason, apply=apply):
                    calls = []
                    with self.assertRaises(wt.WorktreeKept) as caught:
                        _, calls = self._gc_branch([entry], 'pmo-a', busy=busy, apply=apply, current=current)
                    self.assertIn('kept: worktree /r/.worktrees/pmo-a (branch pmo-a): ', str(caught.exception))
                    self.assertIn(reason, str(caught.exception))
                    self.assertEqual(calls, [])

    def test_keep_reason_is_the_single_source_for_removable(self):
        self.assertIsNone(wt.keep_reason(worktree(), set(), Path('/elsewhere')))
        self.assertEqual(wt.keep_reason(worktree(is_main=True), set(), Path('/elsewhere')), 'it is the main checkout')
        self.assertIn('no branch', wt.keep_reason(worktree(branch=None), set(), Path('/elsewhere')))
        self.assertIn('missing', wt.keep_reason(worktree(missing=True), set(), Path('/elsewhere')))

    def test_gc_branch_deletes_a_merged_branch_without_a_worktree(self):
        text, calls = self._gc_branch([worktree(branch='pmo-b')], 'pmo-a', merged_branch=True, apply=True)
        self.assertIn('deleting branch pmo-a', text)
        self.assertEqual(calls, [['git', 'branch', '--show-current'], ['git', 'branch', '-d', 'pmo-a']])
        dry, calls = self._gc_branch([], 'pmo-a', merged_branch=True)
        self.assertIn('would delete branch pmo-a', dry)
        self.assertEqual(calls, [])

    def test_gc_branch_without_worktree_or_merged_branch_cleans_nothing(self):
        text, calls = self._gc_branch([worktree()], 'pmo-x', apply=True)
        self.assertEqual(text, 'nothing to clean')
        self.assertEqual(calls, [])

    def test_gc_branch_must_be_a_local_task_branch(self):
        for name in ('main', 'bad..name', 'Bad Name'):
            with self.subTest(name=name), self.assertRaises(WorktreeError):
                self._gc_branch([worktree()], name)

    def test_merged_local_branch_needs_an_existing_merged_branch(self):
        with mock.patch.object(wt, 'run', side_effect=[(1, ''), (0, '')]) as run:
            self.assertFalse(wt.merged_local_branch(Path('/r'), 'pmo-a'))
            run.assert_called_once()
        with mock.patch.object(wt, 'run', side_effect=[(0, ''), (1, '')]):
            self.assertFalse(wt.merged_local_branch(Path('/r'), 'pmo-a'))
        with mock.patch.object(wt, 'run', side_effect=[(0, ''), (0, '')]):
            self.assertTrue(wt.merged_local_branch(Path('/r'), 'pmo-a'))


LANE_ENV = {
    'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.com', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.com',
}


class LanePoolCase(unittest.TestCase):
    """Real git repositories: a bare origin, the main checkout and the lane worktrees; no network, no npm."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for patch in (mock.patch.dict(os.environ, LANE_ENV), mock.patch.object(wt, 'port_is_free', return_value=True)):
            patch.start()
            self.addCleanup(patch.stop)
        install = mock.patch.object(wt, 'install_dependencies')
        self.install = install.start()
        self.addCleanup(install.stop)
        base = Path(self.tmp.name).resolve()
        self.root = base / 'root'
        self.git('init', '-q', '-b', 'main', str(self.root), cwd=base)
        (self.root / 'package-lock.json').write_text('{"v": 1}', encoding='utf-8')
        self.git('add', 'package-lock.json', cwd=self.root)
        self.git('commit', '-q', '-m', 'first', cwd=self.root)
        self.git('init', '-q', '--bare', str(base / 'origin.git'), cwd=base)
        self.git('remote', 'add', 'origin', str(base / 'origin.git'), cwd=self.root)
        self.git('push', '-q', 'origin', 'main', cwd=self.root)
        (self.root / '.git' / 'info' / 'exclude').write_text('.env.worktree\n', encoding='utf-8')

    def git(self, *argv, cwd):
        return subprocess.run(['git', *argv], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

    def lane_path(self, name):
        return self.root / '.worktrees' / name

    def add(self, name, install=False):
        return wt.add_lane(self.root, name, '', '', '', install)

    def take(self, branch, lane=None, owner='session-a', orchestrator='orch-1'):
        return wt.take_lane(self.root, branch, owner, orchestrator, 'a task', lane)

    def record(self, name):
        return read_take(Path(self.git('rev-parse', '--absolute-git-dir', cwd=self.lane_path(name))))

    def commit_in(self, name, filename, text='x'):
        path = self.lane_path(name)
        target = path / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')
        self.git('add', filename, cwd=path)
        self.git('commit', '-q', '-m', 'work', cwd=path)

    def merge_into_origin(self, name):
        self.git('push', '-q', 'origin', 'HEAD:main', cwd=self.lane_path(name))

    def violations(self):
        worktrees = wt.inspect_all(self.root, sizes=False)
        return wt.violations(worktrees, wt.lane_changes(worktrees))


class TestLanePool(LanePoolCase):
    def test_add_creates_a_detached_resting_lane_with_env_and_record(self):
        text = self.add('one')
        self.assertIn('Nuxt port 3101, Odoo port 8170', text)
        self.assertEqual(self.git('branch', '--show-current', cwd=self.lane_path('one')), '')
        self.assertEqual(self.record('one'), resting())
        self.assertIn('liwan_scratch_one', (self.lane_path('one') / '.env.worktree').read_text(encoding='utf-8'))

    def test_add_refuses_a_bad_name_an_existing_lane_and_a_plain_folder(self):
        for bad in ('a/b', '..', '', '-x', 'a b'):
            with self.subTest(name=bad), self.assertRaises(LaneError):
                self.add(bad)
        self.add('one')
        with self.assertRaisesRegex(WorktreeError, 'already exists'):
            self.add('one')
        self.lane_path('plain').mkdir()
        with self.assertRaisesRegex(WorktreeError, 'not a registered worktree'):
            self.add('plain')

    def test_add_installs_dependencies_unless_told_otherwise(self):
        self.add('one')
        self.install.assert_not_called()
        self.add('two', install=True)
        self.install.assert_called_once_with(self.lane_path('two'))
        self.assertIsNotNone(self.record('two').lock_hash)

    def test_adopting_a_worktree_on_a_branch_records_it_and_drops_the_removed_record_files(self):
        self.git('worktree', 'add', '-q', '-b', 'tools-x', str(self.lane_path('old')), 'main', cwd=self.root)
        git_dir = Path(self.git('rev-parse', '--absolute-git-dir', cwd=self.lane_path('old')))
        for stale in wt.REMOVED_RECORDS:
            (git_dir / stale).write_text('{}', encoding='utf-8')
        with self.assertRaisesRegex(WorktreeError, 'needs --holder, --orchestrator and --task'):
            self.add('old')
        with self.assertRaisesRegex(WorktreeError, 'needs --holder, --orchestrator and --task'):
            wt.add_lane(self.root, 'old', 'session-a', ' ', 'fix it', False)
        wt.add_lane(self.root, 'old', 'session-a', 'orch-1', 'fix it', False)
        self.assertEqual(self.record('old')[:3], ('tools-x', 'session-a', 'fix it'))
        self.assertEqual(self.record('old').orchestrator, 'orch-1')
        self.assertEqual([stale for stale in wt.REMOVED_RECORDS if (git_dir / stale).exists()], [])

    def test_adopting_a_detached_worktree_makes_a_resting_lane(self):
        self.git('worktree', 'add', '-q', '--detach', str(self.lane_path('old')), 'main', cwd=self.root)
        self.add('old')
        self.assertFalse(self.record('old').occupied)

    def test_take_fills_the_first_free_lane_then_the_next_and_refuses_a_third(self):
        self.add('b-lane')
        self.add('a-lane')
        self.take('tools-a')
        self.take('tools-b', owner='session-b')
        self.assertEqual(self.record('a-lane')[:2], ('tools-a', 'session-a'))
        self.assertEqual(self.record('b-lane')[:2], ('tools-b', 'session-b'))
        self.assertEqual(self.git('branch', '--show-current', cwd=self.lane_path('a-lane')), 'tools-a')
        with self.assertRaises(WorktreeError) as caught:
            self.take('tools-c')
        self.assertIn('no free lane', str(caught.exception))
        self.assertIn('held by session-b on tools-b', str(caught.exception))
        self.assertIn('lane add <name>', str(caught.exception))

    def test_take_starts_the_branch_from_origin_main_without_upstream(self):
        self.add('one')
        self.take('tools-a')
        path = self.lane_path('one')
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=path), self.git('rev-parse', 'origin/main', cwd=path))
        self.assertEqual(subprocess.run(['git', 'config', 'branch.tools-a.remote'], cwd=path, capture_output=True, check=False).returncode, 1)

    def test_take_refuses_main_an_occupied_lane_a_dirty_lane_and_a_branch_held_elsewhere(self):
        self.add('one')
        self.add('two')
        for bad in ('main', 'HEAD'):
            with self.subTest(branch=bad), self.assertRaises(WorktreeError):
                self.take(bad)
        self.take('tools-a', lane='one')
        with self.assertRaisesRegex(WorktreeError, 'lane one is held by session-a on tools-a'):
            self.take('tools-b', lane='one')
        with self.assertRaisesRegex(WorktreeError, 'already held by lane one'):
            self.take('tools-a', lane='two')
        (self.lane_path('two') / 'dirty.txt').write_text('x', encoding='utf-8')
        with self.assertRaisesRegex(WorktreeError, 'uncommitted changes'):
            self.take('tools-b', lane='two')
        with self.assertRaisesRegex(WorktreeError, 'no free lane'):
            self.take('tools-b')
        with self.assertRaisesRegex(WorktreeError, '--holder'):
            self.take('tools-b', lane='two', owner=' ')
        with self.assertRaisesRegex(WorktreeError, '--orchestrator'):
            self.take('tools-b', lane='two', orchestrator=' ')
        self.assertFalse(self.record('two').occupied)

    def test_take_records_the_orchestrator_and_the_cli_requires_it(self):
        self.add('one')
        self.take('tools-a', orchestrator='orch-7')
        self.assertEqual(self.record('one').orchestrator, 'orch-7')
        with self.assertRaises(SystemExit), mock.patch.object(wt.sys, 'stderr'):
            wt.build_parser().parse_args(['take', 'tools-b', '--holder', 'x'])
        with self.assertRaises(SystemExit), mock.patch.object(wt.sys, 'stderr'):
            wt.build_parser().parse_args(['take', 'tools-b', '--owner', 'x', '--orchestrator', 'y'])

    def test_done_by_orchestrator_returns_only_its_lanes_and_reports_the_ones_it_leaves(self):
        for name in ('one', 'two', 'three'):
            self.add(name)
        self.take('tools-a', lane='one', orchestrator='orch-1')
        self.take('tools-b', lane='two', orchestrator='orch-1')
        self.take('tools-c', lane='three', orchestrator='orch-2')
        self.commit_in('one', 'a.txt')
        self.merge_into_origin('one')
        self.commit_in('two', 'b.txt')  # unmerged
        text, code = wt.done_orchestrator(self.root, 'orch-1', False)
        self.assertEqual(code, 1)
        self.assertIn('left: lane two: tools-b is not merged', text)
        self.assertIn('1 of 2 lanes of orch-1 returned; 1 left', text)
        self.assertFalse(self.record('one').occupied)
        self.assertEqual(self.record('two').branch, 'tools-b')
        self.assertEqual(self.record('three').orchestrator, 'orch-2')
        text, code = wt.done_orchestrator(self.root, 'orch-1', True)
        self.assertEqual(code, 0)
        self.assertFalse(self.record('two').occupied)
        self.assertTrue(self.record('three').occupied)
        with self.assertRaisesRegex(WorktreeError, 'holds no lane'):
            wt.done_orchestrator(self.root, 'orch-1', False)
        with self.assertRaisesRegex(WorktreeError, 'non-empty'):
            wt.done_orchestrator(self.root, ' ', False)

    def test_done_by_orchestrator_leaves_a_dirty_lane(self):
        self.add('one')
        self.take('tools-a')
        (self.lane_path('one') / 'dirty.txt').write_text('x', encoding='utf-8')
        text, code = wt.done_orchestrator(self.root, 'orch-1', True)
        self.assertEqual(code, 1)
        self.assertIn('left: ', text)
        self.assertTrue(self.record('one').occupied)

    def test_an_old_record_without_an_orchestrator_reads_and_fails_the_check(self):
        self.add('one')
        self.take('tools-a')
        git_dir = Path(self.git('rev-parse', '--absolute-git-dir', cwd=self.lane_path('one')))
        data = json.loads((git_dir / 'liwan-take.json').read_text(encoding='utf-8'))
        del data['orchestrator']
        (git_dir / 'liwan-take.json').write_text(json.dumps(data), encoding='utf-8')
        self.assertIsNone(self.record('one').orchestrator)
        self.assertIn('no orchestrator', [problem for _, problem in self.violations()][0])

    def test_take_refuses_a_resting_lane_that_was_put_on_a_branch(self):
        self.add('one')
        self.git('switch', '-q', '-c', 'stray', cwd=self.lane_path('one'))
        with self.assertRaisesRegex(WorktreeError, 'is on stray but its record says resting'):
            self.take('tools-a', lane='one')
        self.assertFalse(self.record('one').occupied)

    def test_done_refuses_an_unmerged_branch_a_dirty_tree_a_moved_lane_and_a_resting_lane(self):
        self.add('one')
        with self.assertRaisesRegex(WorktreeError, 'already resting'):
            wt.done_lane(self.root, 'one', Path.cwd(), False)
        self.take('tools-a')
        self.commit_in('one', 'b.txt')
        with self.assertRaisesRegex(WorktreeError, 'not merged into origin/main'):
            wt.done_lane(self.root, 'one', Path.cwd(), False)
        (self.lane_path('one') / 'dirty.txt').write_text('x', encoding='utf-8')
        with self.assertRaisesRegex(WorktreeError, 'uncommitted changes'):
            wt.done_lane(self.root, None, self.lane_path('one'), True)
        (self.lane_path('one') / 'dirty.txt').unlink()
        self.git('switch', '-q', '--detach', cwd=self.lane_path('one'))
        with self.assertRaisesRegex(WorktreeError, 'record says tools-a'):
            wt.done_lane(self.root, 'one', Path.cwd(), True)
        self.assertEqual(self.record('one').branch, 'tools-a')

    def test_done_from_inside_the_lane_returns_it_and_deletes_a_merged_branch(self):
        self.add('one')
        self.take('tools-a')
        self.commit_in('one', 'b.txt')
        self.merge_into_origin('one')
        with self.assertRaisesRegex(WorktreeError, 'run done inside a lane'):
            wt.done_lane(self.root, None, self.root, False)
        wt.done_lane(self.root, None, self.lane_path('one') / 'sub', False)
        self.assertEqual(self.record('one')[:4], resting()[:4])
        self.assertEqual(self.git('branch', '--list', 'tools-a', cwd=self.root), '')
        self.assertEqual(self.git('branch', '--show-current', cwd=self.lane_path('one')), '')

    def test_park_keeps_the_branch_and_a_later_take_resumes_it(self):
        self.add('one')
        self.add('two')
        self.take('tools-a', lane='one')
        self.commit_in('one', 'b.txt')
        head = self.git('rev-parse', 'HEAD', cwd=self.lane_path('one'))
        wt.done_lane(self.root, 'one', Path.cwd(), True)
        self.assertFalse(self.record('one').occupied)
        self.assertEqual(self.git('rev-parse', 'tools-a', cwd=self.root), head)
        self.take('tools-a', lane='two')
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.lane_path('two')), head)

    def test_take_installs_only_when_package_lock_changed(self):
        self.add('one', install=True)
        self.install.reset_mock()
        self.take('tools-a')
        self.install.assert_not_called()
        wt.done_lane(self.root, 'one', Path.cwd(), True)
        (self.root / 'package-lock.json').write_text('{"v": 2}', encoding='utf-8')
        self.git('commit', '-q', '-am', 'bump', cwd=self.root)
        self.git('push', '-q', 'origin', 'main', cwd=self.root)
        self.take('tools-b')
        self.install.assert_called_once_with(self.lane_path('one'))
        self.assertEqual(self.record('one').lock_hash, wt.lock_digest(self.lane_path('one')))
        self.install.reset_mock()
        wt.done_lane(self.root, 'one', Path.cwd(), True)
        self.take('tools-c')
        self.install.assert_not_called()

    def test_a_failed_install_leaves_no_lock_hash_and_the_next_take_installs(self):
        self.add('one', install=True)
        (self.root / 'package-lock.json').write_text('{"v": 3}', encoding='utf-8')
        self.git('commit', '-q', '-am', 'bump', cwd=self.root)
        self.git('push', '-q', 'origin', 'main', cwd=self.root)
        self.install.side_effect = WorktreeError('npm failed')
        with self.assertRaisesRegex(WorktreeError, 'npm failed'):
            self.take('tools-a')
        self.assertEqual(self.record('one')[:2], ('tools-a', 'session-a'))
        self.assertIsNone(self.record('one').lock_hash)
        self.install.side_effect = None
        self.install.reset_mock()
        wt.done_lane(self.root, 'one', Path.cwd(), True)
        self.take('tools-a')
        self.install.assert_called_once_with(self.lane_path('one'))
        self.assertEqual(self.record('one').lock_hash, wt.lock_digest(self.lane_path('one')))


class TestLaneRemove(LanePoolCase):
    def remove(self, name, current=None, busy=()):
        with mock.patch.object(wt, 'busy_paths', return_value=set(busy)), \
                mock.patch.object(wt, 'scratch_databases', return_value={'liwan_scratch_%s' % name: 0}):
            return wt.remove_lane(self.root, name, current or self.root)

    def test_it_removes_a_resting_clean_lane_with_its_folder_registration_and_database(self):
        self.add('one')
        self.add('two')
        dropped = []
        real_sh = wt.sh

        def fake_sh(argv, cwd):
            if argv[0] == 'dropdb':
                dropped.append(argv[-1])
                return ''
            return real_sh(argv, cwd)

        with mock.patch.object(wt, 'sh', side_effect=fake_sh):
            text = self.remove('one')
        self.assertIn('removed lane one', text)
        self.assertEqual(dropped, ['liwan_scratch_one'])
        self.assertFalse(self.lane_path('one').exists())
        self.assertNotIn('one', self.git('worktree', 'list', cwd=self.root))
        self.assertTrue(self.lane_path('two').is_dir())

    def test_it_refuses_an_occupied_lane_and_names_done(self):
        self.add('one')
        self.take('tools-a')
        with self.assertRaisesRegex(WorktreeError, r'held by session-a on tools-a.*npm run wt -- done'):
            self.remove('one')
        self.assertTrue(self.lane_path('one').is_dir())

    def test_it_refuses_a_dirty_lane_and_names_done(self):
        self.add('one')
        (self.lane_path('one') / 'dirty.txt').write_text('x', encoding='utf-8')
        with self.assertRaisesRegex(WorktreeError, r'uncommitted changes.*npm run wt -- done'):
            self.remove('one')

    def test_it_refuses_a_lane_whose_detached_head_has_unmerged_commits(self):
        self.add('one')
        self.git('switch', '-q', '--detach', cwd=self.lane_path('one'))
        self.commit_in('one', 'lost.txt')
        head = self.git('rev-parse', '--short', 'HEAD', cwd=self.lane_path('one'))
        with self.assertRaisesRegex(WorktreeError, 'HEAD %s is not merged.*on a branch first' % head):
            self.remove('one')
        self.assertTrue(self.lane_path('one').is_dir())

    def test_it_refuses_a_missing_lane_the_current_lane_and_a_lane_in_use(self):
        with self.assertRaisesRegex(WorktreeError, "no lane 'ghost'"):
            self.remove('ghost')
        self.add('one')
        with self.assertRaisesRegex(WorktreeError, 'current directory'):
            self.remove('one', current=self.lane_path('one') / 'sub')
        with self.assertRaisesRegex(WorktreeError, 'process is running'):
            self.remove('one', busy=[self.lane_path('one') / 'apps'])
        self.assertTrue(self.lane_path('one').is_dir())

    def test_a_non_lane_worktree_is_not_removed(self):
        self.git('worktree', 'add', '-q', '-b', 'other', str(self.lane_path('other')), 'main', cwd=self.root)
        with self.assertRaisesRegex(WorktreeError, "no lane 'other'"):
            self.remove('other')


class TestLaneChecks(LanePoolCase):
    def setUp(self):
        super().setUp()
        self.add('one')
        self.add('two')
        self.take('tools-a', lane='one')
        self.take('tools-b', lane='two', owner='session-b')

    def test_a_healthy_pool_breaks_no_rule(self):
        self.assertEqual(self.violations(), [])

    def test_status_lists_a_file_changed_in_two_lanes_under_shared_files(self):
        self.commit_in('one', 'docs/a.md')
        self.commit_in('two', 'docs/a.md', 'other')
        (self.lane_path('two') / 'only-two.txt').write_text('x', encoding='utf-8')
        worktrees = wt.inspect_all(self.root, sizes=False)
        changes = wt.lane_changes(worktrees)
        self.assertEqual(wt.shared_files(changes), [('one', 'two', ['docs/a.md'])])
        text = wt.format_status(worktrees, self.root, changes)
        self.assertIn('one and two: docs/a.md', text)
        self.assertIn('session-a', text)
        self.assertIn('only-two.txt', ' '.join(changes['two']))

    def test_two_lanes_changing_the_same_addon_migrations_fail_the_check(self):
        self.commit_in('one', 'odoo-addons/liwan_x/migrations/19.0.1.1.0/pre.py')
        self.commit_in('two', 'odoo-addons/liwan_x/migrations/19.0.1.2.0/post.py')
        self.commit_in('two', 'odoo-addons/liwan_y/migrations/19.0.1.1.0/post.py')
        self.assertEqual([problem for _, problem in self.violations()], [
            'lane one and lane two both change odoo-addons/liwan_x/migrations/'])

    def test_a_non_lane_worktree_fails_the_check(self):
        self.git('worktree', 'add', '-q', '-b', 'other', str(self.lane_path('other')), 'main', cwd=self.root)
        found = self.violations()
        self.assertEqual([(w.path.name, 'not a lane' in problem) for w, problem in found], [('other', True)])

    def test_a_lane_that_left_its_recorded_branch_or_has_no_holder_fails_the_check(self):
        self.git('switch', '-q', '--detach', cwd=self.lane_path('one'))
        write_take(self.git('rev-parse', '--absolute-git-dir', cwd=self.lane_path('two')), Take('tools-b', None, None, 1, None))
        problems = [problem for _, problem in self.violations()]
        self.assertEqual(len(problems), 3)
        self.assertIn('holds tools-a but a detached HEAD is checked out', problems[0])
        self.assertIn('no holder', problems[1])
        self.assertIn('no orchestrator', problems[2])
        wt.done_lane(self.root, 'two', Path.cwd(), True)
        self.git('switch', '-q', 'tools-b', cwd=self.lane_path('two'))
        self.assertIn('rests but tools-b is checked out', self.violations()[-1][1])

    def test_gc_never_removes_a_lane(self):
        worktrees = wt.inspect_all(self.root, sizes=False)
        self.assertEqual(wt.removable(worktrees, set(), Path('/elsewhere')), [])
        lane = next(w for w in worktrees if w.path.name == 'one')
        self.assertIn('lane', wt.keep_reason(lane, set(), Path('/elsewhere')))

    def test_main_dispatches_the_commands_and_check_exits_1_on_a_violation(self):
        with mock.patch.object(wt, 'repo_root', return_value=self.root), mock.patch.object(wt.sys, 'stdout') as out:
            self.assertEqual(wt.main(['check']), 0)
            self.git('worktree', 'add', '-q', '-b', 'other', str(self.lane_path('other')), 'main', cwd=self.root)
            self.assertEqual(wt.main(['check']), 1)
            self.assertEqual(wt.main(['status']), 0)
        self.assertIn('not a lane', ''.join(call.args[0] for call in out.write.call_args_list))


class TestCleanEnv(unittest.TestCase):
    def test_drops_npm_run_variables_and_keeps_the_rest(self):
        env = {
            'PATH': '/usr/bin', 'HOME': '/h', 'INIT_CWD': '/x', 'npm_command': 'run',
            'npm_config_local_prefix': '/x', 'npm_lifecycle_event': 'wt', 'NPM_TOKEN_NOT_NPM_PREFIX': '1',
        }
        self.assertEqual(clean_env(env), {'PATH': '/usr/bin', 'HOME': '/h', 'NPM_TOKEN_NOT_NPM_PREFIX': '1'})


if __name__ == '__main__':
    unittest.main()
