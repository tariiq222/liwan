# Part of Odoo. See LICENSE file for full copyright and licensing details.
import os
import re
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import wt
from worktree_claims import Lane, make_claim, read_claim, read_lane, write_lane
from wt import (
    WorktreeError,
    clean_env,
    create,
    database_name,
    env_content,
    parse_worktrees,
    pick_port,
    used_ports,
)

REQUEST = wt.ClaimRequest('session-a', 'fix the filters', ('apps/web/app/pages/hr',))

PORCELAIN = """worktree /r/main
HEAD aaaa
branch refs/heads/main

worktree /r/main/.worktrees/pmo-a
HEAD bbbb
branch refs/heads/codex/pmo-a

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
            ('/r/main/.worktrees/pmo-a', 'refs/heads/codex/pmo-a'),
            ('/r/detached', None),
        ])

    def test_create_rejects_bad_branch_names(self):
        for bad in ('../escape', '/absolute', 'bad..name', 'trailing/', 'space name', ''):
            with self.assertRaises(WorktreeError):
                create(bad, 'main', False, REQUEST)

    def _create_isolated(self, root, suffix):
        (root / '.git').mkdir()
        listing = 'worktree %s\nbranch refs/heads/main\n' % root

        def fake_sh(argv, cwd):
            if argv[:3] == ['git', 'worktree', 'add']:
                Path(argv[3]).mkdir(parents=True)
            return listing

        with mock.patch.object(wt, 'repo_root', return_value=root), \
                mock.patch.object(wt, 'sh', side_effect=fake_sh), \
                mock.patch.object(wt, 'inspect_all', return_value=[]), \
                mock.patch.object(wt, 'git_dir', return_value=root / '.git'), \
                mock.patch.object(wt, 'port_is_free', return_value=True):
            return create(suffix, 'main', False, REQUEST)

    def test_new_rejects_a_nested_suffix_even_when_its_branch_is_valid(self):
        self.assertIsNone(wt.check_branch('codex/feature/example'))
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(WorktreeError, 'single directory name'):
                self._create_isolated(Path(tmp), 'feature/example')

    def test_new_accepted_suffixes_produce_worktrees_that_pass_the_checker(self):
        for suffix in ('pmo', 'feature-example', 'pmo-Bad_Slug', 'موضوع+تصحيح', '-suffix'):
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                path, branch, *_ = self._create_isolated(root, suffix)
                self.assertEqual(path, root / '.worktrees' / suffix)
                entry = worktree(path=path, branch=branch, claim=read_claim(root / '.git'))
                self.assertEqual(wt.violations([entry]), [])

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

    def _setup_root(self, tmp, name):
        root = Path(tmp)
        (root / '.git').mkdir()
        path = root / '.worktrees' / name
        path.mkdir(parents=True)
        return root, path

    def test_existing_unregistered_path_is_refused_even_with_resume(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, _ = self._setup_root(tmp, 'tools-x')
            with mock.patch.object(wt, 'repo_root', return_value=root), \
                    mock.patch.object(wt, 'sh', return_value='worktree %s/main\nbranch refs/heads/main\n' % tmp):
                for resume in (False, True):
                    with self.assertRaises(WorktreeError) as caught:
                        create('tools-x', 'main', False, REQUEST, resume)
                    self.assertIn('already exists', str(caught.exception))

    def test_resume_continues_a_registered_worktree_and_keeps_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, path = self._setup_root(tmp, 'tools-x')
            listing = 'worktree %s\nbranch refs/heads/codex/tools-x\n' % path.resolve()
            installed = []
            with mock.patch.object(wt, 'repo_root', return_value=root), \
                    mock.patch.object(wt, 'sh', return_value=listing), \
                    mock.patch.object(wt, 'port_is_free', return_value=True), \
                    mock.patch.object(wt, 'install_dependencies', side_effect=installed.append), \
                    mock.patch.object(wt, 'inspect_all', return_value=[]), \
                    mock.patch.object(wt, 'git_dir', return_value=root / '.git'):
                with self.assertRaises(WorktreeError):
                    create('tools-x', 'main', True, REQUEST, False)
                first = create('tools-x', 'main', True, REQUEST, True)
                again = create('tools-x', 'main', True, REQUEST, True)
            self.assertEqual(first, again)
            self.assertEqual(first[2:], (3101, 8170))
            self.assertTrue((path / '.env.worktree').is_file())
            self.assertEqual(len(installed), 2)  # node_modules never appeared, so each resume retries

    def test_env_is_written_before_the_install_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, path = self._setup_root(tmp, 'tools-x')
            listing = 'worktree %s\nbranch refs/heads/codex/tools-x\n' % path.resolve()

            def failing_install(target):
                self.assertTrue((target / '.env.worktree').is_file())
                message = 'boom'
                raise WorktreeError(message)

            with mock.patch.object(wt, 'repo_root', return_value=root), \
                    mock.patch.object(wt, 'sh', return_value=listing), \
                    mock.patch.object(wt, 'port_is_free', return_value=True), \
                    mock.patch.object(wt, 'install_dependencies', side_effect=failing_install), \
                    mock.patch.object(wt, 'inspect_all', return_value=[]), \
                    mock.patch.object(wt, 'git_dir', return_value=root / '.git'):
                with self.assertRaises(WorktreeError):
                    create('tools-x', 'main', True, REQUEST, True)


CLAIM = wt.Claim('session-a', 'fix the filters', 'main', ('apps/web/app/pages/hr',), 100, 100)


def worktree(**overrides):
    values = dict(
        path=Path('/r/.worktrees/pmo-a'), branch='codex/pmo-a', is_main=False, canonical=True, ahead=0, behind=3,
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
        entry = wt.inspect_worktree(root, '/r/.worktrees/codex-gone', 'refs/heads/codex/pmo-gone')
        self.assertTrue(entry.missing)
        self.assertEqual(entry.database, 'liwan_scratch_pmo_gone')
        text = wt.format_status([worktree(is_main=True, path=root), entry], root)
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

    def test_format_status_has_a_row_per_worktree_a_summary_and_the_violations(self):
        root = Path('/r')
        claimed = worktree(claim=CLAIM)
        outside = worktree(canonical=False, dirty=True, path=Path('/x/y'), claim=CLAIM._replace(scopes=('docs',)))
        text = wt.format_status([worktree(is_main=True, path=root), claimed, outside], root)
        lines = text.splitlines()
        self.assertIn('session-a', lines[2])
        self.assertIn('/x/y *', lines[3])
        self.assertTrue(lines[5].startswith('2 worktrees: 2 merged, 1 dirty, 1 outside .worktrees'))
        self.assertIn('2 claimed, 0 expired', lines[5])
        self.assertIn('rule violations (reported only', lines[7])
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
            ['git', 'branch', '-d', 'codex/pmo-a'], ['dropdb', '--if-exists', 'liwan_scratch_pmo_a']])

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
        self.assertNotIn(['git', 'branch', '-d', 'codex/pmo-a'], calls)  # the worktree is still there
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
        other = worktree(path=Path('/r/.worktrees/pmo-b'), branch='codex/pmo-b', database='liwan_scratch_pmo_b')
        text, calls = self._gc_branch([worktree(), other], 'codex/pmo-a', apply=True)
        self.assertIn('removing worktree /r/.worktrees/pmo-a', text)
        self.assertNotIn('pmo-b', text)
        self.assertIn(['git', 'branch', '-d', 'codex/pmo-a'], calls)
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
                        _, calls = self._gc_branch([entry], 'codex/pmo-a', busy=busy, apply=apply, current=current)
                    self.assertIn('kept: worktree /r/.worktrees/pmo-a (branch codex/pmo-a): ', str(caught.exception))
                    self.assertIn(reason, str(caught.exception))
                    self.assertEqual(calls, [])

    def test_keep_reason_is_the_single_source_for_removable(self):
        self.assertIsNone(wt.keep_reason(worktree(), set(), Path('/elsewhere')))
        self.assertEqual(wt.keep_reason(worktree(is_main=True), set(), Path('/elsewhere')), 'it is the main checkout')
        self.assertIn('no branch', wt.keep_reason(worktree(branch=None), set(), Path('/elsewhere')))
        self.assertIn('missing', wt.keep_reason(worktree(missing=True), set(), Path('/elsewhere')))

    def test_gc_branch_deletes_a_merged_branch_without_a_worktree(self):
        text, calls = self._gc_branch([worktree(branch='codex/pmo-b')], 'codex/pmo-a', merged_branch=True, apply=True)
        self.assertIn('deleting branch codex/pmo-a', text)
        self.assertEqual(calls, [['git', 'branch', '--show-current'], ['git', 'branch', '-d', 'codex/pmo-a']])
        dry, calls = self._gc_branch([], 'codex/pmo-a', merged_branch=True)
        self.assertIn('would delete branch codex/pmo-a', dry)
        self.assertEqual(calls, [])

    def test_gc_branch_without_worktree_or_merged_branch_cleans_nothing(self):
        text, calls = self._gc_branch([worktree()], 'codex/pmo-x', apply=True)
        self.assertEqual(text, 'nothing to clean')
        self.assertEqual(calls, [])

    def test_gc_branch_must_be_a_local_task_branch(self):
        for name in ('main', 'bad..name', 'codex/Bad Name'):
            with self.subTest(name=name), self.assertRaises(WorktreeError):
                self._gc_branch([worktree()], name)

    def test_merged_local_branch_needs_an_existing_merged_branch(self):
        with mock.patch.object(wt, 'run', side_effect=[(1, ''), (0, '')]) as run:
            self.assertFalse(wt.merged_local_branch(Path('/r'), 'codex/pmo-a'))
            run.assert_called_once()
        with mock.patch.object(wt, 'run', side_effect=[(0, ''), (1, '')]):
            self.assertFalse(wt.merged_local_branch(Path('/r'), 'codex/pmo-a'))
        with mock.patch.object(wt, 'run', side_effect=[(0, ''), (0, '')]):
            self.assertTrue(wt.merged_local_branch(Path('/r'), 'codex/pmo-a'))


class TestRules(unittest.TestCase):
    def problems(self, worktrees):
        return [problem for _, problem in wt.violations(worktrees)]

    def test_a_claimed_canonical_task_worktree_breaks_no_rule(self):
        self.assertEqual(self.problems([worktree(is_main=True, path=Path('/r')), worktree(claim=CLAIM)]), [])

    def test_the_main_checkout_is_never_checked(self):
        self.assertEqual(self.problems([worktree(is_main=True, path=Path('/r'), branch='main', claim=None)]), [])

    def test_location_naming_and_claim_are_reported(self):
        agent = worktree(path=Path('/r/.claude/worktrees/agent-a1'), canonical=False, branch='worktree-agent-a1')
        problems = self.problems([agent])
        self.assertIn('outside .worktrees/', problems[0])
        # Any normal branch name is accepted: only the missing claim is still reported.
        self.assertIn('no ownership claim', problems[1])

    def test_folder_must_match_its_branch(self):
        problems = self.problems([worktree(path=Path('/r/.worktrees/other'), claim=CLAIM)])
        self.assertEqual(problems, ["folder 'other' does not match its branch codex/pmo-a (expected .worktrees/pmo-a)"])

    def test_detached_head_is_reported(self):
        self.assertIn('detached HEAD', self.problems([worktree(branch=None, claim=CLAIM)])[0])

    def test_a_missing_folder_is_only_checked_for_location(self):
        self.assertEqual(self.problems([worktree(missing=True, claim=None)]), [])

    def test_active_overlapping_claims_are_reported_unless_a_reason_was_given_or_one_expired(self):
        first = worktree(claim=CLAIM)
        second = worktree(path=Path('/r/.worktrees/pmo-b'), branch='codex/pmo-b', claim=CLAIM._replace(scopes=('apps/web',)))
        self.assertIn('overlaps apps/web of /r/.worktrees/pmo-b without a stated reason', self.problems([first, second])[0])
        agreed = second._replace(claim=second.claim._replace(overlap_reason='shared page header, agreed with session-a'))
        self.assertEqual(self.problems([first, agreed]), [])
        self.assertEqual(self.problems([first, second._replace(claim_expired=True)]), [])

    def test_check_never_runs_git_mutations(self):
        with mock.patch.object(wt, 'inspect_all', return_value=[worktree()]), \
                mock.patch.object(wt, 'repo_root', return_value=Path('/r')), \
                mock.patch.object(wt, 'sh', side_effect=AssertionError('check must not run git')), \
                mock.patch.object(wt.sys, 'stdout'):
            self.assertEqual(wt.main(['check']), 1)


class TestClaims(unittest.TestCase):
    def test_new_refuses_an_overlap_with_an_active_claim_and_names_its_owner(self):
        other = worktree(path=Path('/r/.worktrees/hr-b'), branch='codex/hr-b', claim=CLAIM._replace(owner='session-b', scopes=('apps/web',)))
        with self.assertRaises(WorktreeError) as caught:
            wt.refuse_conflicts(REQUEST, [other])
        self.assertIn('apps/web/app/pages/hr overlaps apps/web of /r/.worktrees/hr-b (owner session-b', str(caught.exception))
        self.assertIn('--allow-overlap', str(caught.exception))

    def test_a_stated_reason_an_expired_or_a_disjoint_claim_does_not_block(self):
        other = worktree(claim=CLAIM._replace(scopes=('apps/web',)))
        wt.refuse_conflicts(REQUEST._replace(overlap_reason='agreed'), [other])
        wt.refuse_conflicts(REQUEST, [other._replace(claim_expired=True)])
        wt.refuse_conflicts(REQUEST, [other._replace(claim=CLAIM._replace(scopes=('odoo-addons',)))])
        wt.refuse_conflicts(REQUEST, [worktree(claim=None)])

    def test_the_whole_repository_scope_overlaps_everything(self):
        with self.assertRaises(WorktreeError):
            wt.refuse_conflicts(REQUEST._replace(scopes=('.',)), [worktree(claim=CLAIM._replace(scopes=('docs/a.md',)))])

    def test_new_accepts_any_normal_base_and_rejects_invalid_ref_names(self):
        for base in ('main', 'origin/main', 'feature/x', 'codex/Nope', 'codex/tools-integrate-x'):
            with self.subTest(base=base):
                self.assertIsNone(wt.check_base(base))
        for base in ('HEAD~1', '-bad', 'bad..name', 'feature/.hidden', ''):
            with self.subTest(base=base):
                self.assertIsNotNone(wt.check_base(base))

    def test_new_writes_the_claim_and_refuses_before_creating_the_worktree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / '.git').mkdir()
            listing = 'worktree %s\nbranch refs/heads/main\n' % root
            calls = []

            def fake_sh(argv, cwd):
                calls.append(argv)
                if argv[:3] == ['git', 'worktree', 'add']:
                    Path(argv[3]).mkdir(parents=True)
                return listing

            blocker = worktree(path=root / '.worktrees' / 'hr-b', branch='codex/hr-b', claim=CLAIM._replace(scopes=('apps',)))
            with mock.patch.object(wt, 'repo_root', return_value=root), mock.patch.object(wt, 'sh', side_effect=fake_sh), \
                    mock.patch.object(wt, 'port_is_free', return_value=True), \
                    mock.patch.object(wt, 'git_dir', return_value=root / '.git'):
                with mock.patch.object(wt, 'inspect_all', return_value=[blocker]), self.assertRaises(WorktreeError):
                    create('hr-x', 'main', False, REQUEST)
                self.assertFalse(any(argv[:3] == ['git', 'worktree', 'add'] for argv in calls))
                with mock.patch.object(wt, 'inspect_all', return_value=[]):
                    create('hr-x', 'main', False, REQUEST)
            claim = read_claim(root / '.git')
            self.assertEqual((claim.owner, claim.task, claim.base, claim.scopes),
                             ('session-a', 'fix the filters', 'main', ('apps/web/app/pages/hr',)))

    def test_new_needs_owner_task_and_scope(self):
        for request in (REQUEST._replace(owner=' '), REQUEST._replace(task=''), REQUEST._replace(scopes=()),
                        REQUEST._replace(scopes=('/abs/path',)), REQUEST._replace(scopes=('../outside',))):
            with self.subTest(request=request), self.assertRaises(WorktreeError):
                with mock.patch.object(wt, 'repo_root', return_value=Path('/nonexistent')), \
                        mock.patch.object(wt, 'sh', return_value=''):
                    create('hr-x', 'main', False, request)

    def _update(self, mine, others=(), request=REQUEST, current='/r/.worktrees/pmo-a/apps'):
        written = []
        with mock.patch.object(wt, 'inspect_all', return_value=[worktree(is_main=True, path=Path('/r')), mine, *others]), \
                mock.patch.object(wt, 'git_dir', return_value=Path('/r/.git/worktrees/pmo-a')), \
                mock.patch.object(wt, 'write_claim', side_effect=lambda folder, claim: written.append(claim)):
            text = wt.update_claim(Path('/r'), Path(current), request, now=500)
        return text, written

    def test_claim_records_a_claim_for_an_unclaimed_worktree(self):
        text, written = self._update(worktree(claim=None))
        self.assertIn('recorded claim', text)
        self.assertEqual((written[0].owner, written[0].claimed_at, written[0].refreshed_at), ('session-a', 500, 500))

    def test_the_owner_refreshes_and_keeps_task_scopes_and_start_time(self):
        text, written = self._update(worktree(claim=CLAIM), request=wt.ClaimRequest('session-a', '', ()))
        self.assertIn('refreshed claim', text)
        self.assertEqual((written[0].task, written[0].scopes, written[0].claimed_at, written[0].refreshed_at),
                         (CLAIM.task, CLAIM.scopes, 100, 500))

    def test_another_owner_cannot_take_an_active_claim_but_takes_an_expired_one(self):
        request = wt.ClaimRequest('session-b', '', ())
        with self.assertRaises(WorktreeError) as caught:
            self._update(worktree(claim=CLAIM), request=request)
        self.assertIn('claimed by session-a', str(caught.exception))
        text, written = self._update(worktree(claim=CLAIM, claim_expired=True), request=request)
        self.assertIn('took over the expired claim of session-a', text)
        self.assertEqual((written[0].owner, written[0].claimed_at), ('session-b', 500))

    def test_claim_refuses_outside_a_task_worktree_and_on_overlap(self):
        with self.assertRaises(WorktreeError):
            self._update(worktree(claim=None), current='/r/apps')
        other = worktree(path=Path('/r/.worktrees/hr-b'), branch='codex/hr-b', claim=CLAIM._replace(owner='session-b'))
        with self.assertRaises(WorktreeError):
            self._update(worktree(claim=None), others=[other])

    def test_last_activity_is_the_newest_of_commit_files_and_refresh(self):
        with tempfile.TemporaryDirectory() as tmp:
            edited = Path(tmp) / 'a.py'
            edited.write_text('x', encoding='utf-8')
            mtime = int(edited.stat().st_mtime)
            self.assertEqual(wt.last_activity(Path(tmp), 10, ['a.py', 'gone.py'], None), mtime)
            self.assertEqual(wt.last_activity(Path(tmp), 10, [], CLAIM._replace(refreshed_at=20)), 20)

    def test_changed_paths_reads_renames_and_untracked_files(self):
        output = ' M tools/wt.py\0R  new.py\0old.py\0?? docs/x.md\0'
        with mock.patch.object(wt, 'run', return_value=(0, output)):
            self.assertEqual(wt.changed_paths(Path('/r')), ['tools/wt.py', 'new.py', 'docs/x.md'])


LANE_ENV = {
    'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.com', 'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.com',
}


def session_claim(owner, *scopes, refreshed=100):
    return make_claim(owner, 'task of ' + owner, 'tools-x', scopes, refreshed)


def lane_entry(sessions=(), branch='tools-x', expired=(), record=True, **overrides):
    values = dict(
        path=Path('/r/.worktrees/claude-1'), branch=branch, is_lane=True, lane=Lane(branch, tuple(sessions)) if record else None,
        expired_sessions=tuple(expired))
    values.update(overrides)
    return worktree(**values)


class TestLaneClaims(unittest.TestCase):
    def _update(self, mine, others=(), request=REQUEST, current='/r/.worktrees/claude-1/apps'):
        written = []
        with mock.patch.object(wt, 'inspect_all', return_value=[worktree(is_main=True, path=Path('/r')), mine, *others]), \
                mock.patch.object(wt, 'git_dir', return_value=Path('/r/.git/worktrees/claude-1')), \
                mock.patch.object(wt, 'write_lane', side_effect=lambda folder, lane: written.append(lane)):
            text = wt.update_claim(Path('/r'), Path(current), request, now=500)
        return text, written

    def test_the_first_claim_of_a_session_is_recorded_on_the_started_branch(self):
        text, written = self._update(lane_entry())
        self.assertIn('recorded claim', text)
        claim = written[0].sessions[0]
        self.assertEqual((written[0].branch, claim.owner, claim.base, claim.claimed_at, claim.refreshed_at), ('tools-x', 'session-a', 'tools-x', 500, 500))

    def test_the_same_session_refreshes_or_changes_its_claim_and_keeps_the_start_time(self):
        mine = lane_entry([session_claim('session-a', 'docs'), session_claim('session-b', 'tools')])
        text, written = self._update(mine, request=wt.ClaimRequest('session-a', '', ()))
        self.assertIn('refreshed claim', text)
        self.assertEqual([(c.owner, c.scopes, c.claimed_at, c.refreshed_at) for c in written[0].sessions],
                         [('session-b', ('tools',), 100, 100), ('session-a', ('docs',), 100, 500)])
        _, written = self._update(mine, request=wt.ClaimRequest('session-a', 'new task', ('apps/api',)))
        mine_after = next(c for c in written[0].sessions if c.owner == 'session-a')
        self.assertEqual((mine_after.task, mine_after.scopes, mine_after.claimed_at), ('new task', ('apps/api',), 100))

    def test_a_claim_needs_a_started_branch_and_a_record(self):
        for entry, text in ((lane_entry(branch=None), 'no started branch'), (lane_entry(record=False), 'has no record')):
            with self.subTest(text=text), self.assertRaisesRegex(WorktreeError, text):
                self._update(entry)

    def test_a_first_claim_needs_task_and_scope(self):
        for request in (REQUEST._replace(task=''), REQUEST._replace(scopes=())):
            with self.subTest(request=request), self.assertRaises(WorktreeError):
                self._update(lane_entry(), request=request)

    def test_overlap_with_another_session_of_the_lane_is_refused_unless_a_reason_is_given(self):
        mine = lane_entry([session_claim('session-b', 'apps/web')])
        with self.assertRaises(WorktreeError) as caught:
            self._update(mine)
        self.assertIn('owner session-b', str(caught.exception))
        _, written = self._update(mine, request=REQUEST._replace(overlap_reason='agreed with session-b'))
        self.assertEqual(written[0].sessions[-1].overlap_reason, 'agreed with session-b')

    def test_overlap_with_another_worktree_is_refused(self):
        other = worktree(path=Path('/r/.worktrees/hr-b'), branch='codex/hr-b', claim=CLAIM._replace(owner='session-b', scopes=('apps/web',)))
        with self.assertRaisesRegex(WorktreeError, 'owner session-b'):
            self._update(lane_entry(), others=[other])
        self._update(lane_entry(), others=[other._replace(claim_expired=True)])

    def test_an_overlapping_expired_session_claim_is_taken_over_and_other_expired_ones_stay(self):
        mine = lane_entry(
            [session_claim('old', 'apps/web'), session_claim('stale', 'docs')], expired=('old', 'stale'))
        text, written = self._update(mine)
        self.assertIn('took over the expired claim of old', text)
        self.assertEqual([c.owner for c in written[0].sessions], ['stale', 'session-a'])

    def test_release_removes_one_session_claim(self):
        mine = lane_entry([session_claim('session-a', 'docs'), session_claim('session-b', 'tools')])
        written = []
        with mock.patch.object(wt, 'inspect_all', return_value=[mine]), \
                mock.patch.object(wt, 'git_dir', return_value=Path('/r/.git')), \
                mock.patch.object(wt, 'write_lane', side_effect=lambda folder, lane: written.append(lane)):
            text = wt.release_claim(Path('/r'), Path('/r/.worktrees/claude-1'), ' session-a ')
            self.assertIn('released the claim of session session-a in lane claude-1', text)
            self.assertEqual([c.owner for c in written[0].sessions], ['session-b'])
            with self.assertRaisesRegex(WorktreeError, 'session nobody has no claim'):
                wt.release_claim(Path('/r'), Path('/r/.worktrees/claude-1'), 'nobody')

    def test_release_runs_only_inside_a_lane(self):
        with mock.patch.object(wt, 'inspect_all', return_value=[worktree(is_main=True, path=Path('/r')), worktree()]):
            for current in ('/r', '/r/.worktrees/pmo-a', '/elsewhere'):
                with self.subTest(current=current), self.assertRaisesRegex(WorktreeError, 'inside a fixed lane'):
                    wt.release_claim(Path('/r'), Path(current), 'session-a')

    def test_new_refuses_the_name_of_a_fixed_lane(self):
        for name in wt.LANES:
            with self.subTest(name=name), self.assertRaisesRegex(WorktreeError, 'fixed lane; set it up with'):
                create(name, 'main', False, REQUEST)


class TestLaneRules(unittest.TestCase):
    def problems(self, worktrees):
        return [problem for _, problem in wt.violations(worktrees)]

    def test_a_started_lane_without_a_task_claim_breaks_no_rule(self):
        self.assertEqual(self.problems([lane_entry()]), [])
        self.assertEqual(self.problems([lane_entry(branch=None, claim=None)]), [])  # detached and resting

    def test_a_lane_without_a_record_or_on_another_branch_is_reported(self):
        self.assertIn('no lane record; set it up with: wt.py lane setup claude-1', self.problems([lane_entry(record=False)])[0])
        moved = lane_entry(branch='other')._replace(lane=Lane('tools-x', ()))
        self.assertIn('lane is on other but its recorded branch is tools-x', self.problems([moved])[0])
        resting_on_branch = lane_entry(branch='other')._replace(lane=Lane(None, ()))
        self.assertIn('recorded branch is none (resting)', self.problems([resting_on_branch])[0])

    def test_session_claims_of_a_lane_are_checked_against_each_other_and_other_worktrees(self):
        lane = lane_entry([session_claim('a', 'apps/web'), session_claim('b', 'apps/web/app')])
        self.assertIn('overlaps apps/web/app of /r/.worktrees/claude-1 session b without a stated reason', self.problems([lane])[0])
        agreed = lane_entry([session_claim('a', 'apps/web'), session_claim('b', 'apps/web/app')._replace(overlap_reason='agreed')])
        self.assertEqual(self.problems([agreed]), [])
        self.assertEqual(self.problems([lane._replace(expired_sessions=('b',))]), [])
        task = worktree(path=Path('/r/.worktrees/hr-b'), branch='codex/hr-b', claim=CLAIM._replace(scopes=('apps/web',)))
        self.assertEqual(len(self.problems([lane_entry([session_claim('a', 'apps/web')]), task])), 1)

    def test_status_lists_the_session_owners_of_a_lane(self):
        root = Path('/r')
        lane = lane_entry([session_claim('a', 'docs'), session_claim('b', 'tools')], expired=('b',))
        text = wt.format_status([worktree(is_main=True, path=root), lane, lane_entry(path=Path('/r/.worktrees/claude-2'))], root)
        lines = text.splitlines()
        self.assertIn('a, b (expired)', lines[2])
        self.assertRegex(lines[3], r'claude-2\s+tools-x\s+-\s')
        self.assertIn('2 claimed, 1 expired', text)

    def test_gc_never_removes_a_lane(self):
        lane = lane_entry()
        self.assertIn('fixed lane; return it with: wt.py lane finish claude-1', wt.keep_reason(lane, set(), Path('/elsewhere')))
        self.assertEqual(wt.removable([lane], set(), Path('/elsewhere')), [])


class TestLaneCommands(unittest.TestCase):
    """Real git repositories: an origin, the main checkout and the lane worktrees."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patch = mock.patch.dict(os.environ, LANE_ENV)
        patch.start()
        self.addCleanup(patch.stop)
        base = Path(self.tmp.name).resolve()
        self.root = base / 'root'
        self.git('init', '-q', '-b', 'main', str(self.root), cwd=base)
        (self.root / 'a.txt').write_text('a', encoding='utf-8')
        self.git('add', 'a.txt', cwd=self.root)
        self.git('commit', '-q', '-m', 'first', cwd=self.root)
        self.git('init', '-q', '--bare', str(base / 'origin.git'), cwd=base)
        self.git('remote', 'add', 'origin', str(base / 'origin.git'), cwd=self.root)
        self.git('push', '-q', 'origin', 'main', cwd=self.root)
        (self.root / '.git' / 'info' / 'exclude').write_text('.env.worktree\n', encoding='utf-8')  # git-ignored in the real repository
        self.path = self.root / '.worktrees' / 'claude-1'

    def git(self, *argv, cwd):
        return subprocess.run(['git', *argv], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()

    def setup_lane(self, install=False):
        with mock.patch.object(wt, 'port_is_free', return_value=True):
            return wt.lane_setup(self.root, 'claude-1', install)

    def record(self):
        return read_lane(Path(self.git('rev-parse', '--absolute-git-dir', cwd=self.path)))

    def merge_into_origin(self):
        (self.path / 'b.txt').write_text('b', encoding='utf-8')
        self.git('add', 'b.txt', cwd=self.path)
        self.git('commit', '-q', '-m', 'work', cwd=self.path)
        self.git('push', '-q', 'origin', 'HEAD:main', cwd=self.path)

    def test_setup_creates_a_detached_lane_with_env_and_a_resting_record(self):
        text = self.setup_lane()
        self.assertIn('Nuxt port 3101, Odoo port 8170', text)
        self.assertEqual(self.git('branch', '--show-current', cwd=self.path), '')
        self.assertEqual(self.record(), Lane(None, ()))
        self.assertIn('liwan_scratch_claude_1', (self.path / '.env.worktree').read_text(encoding='utf-8'))

    def test_setup_is_repeatable_and_keeps_the_record_and_ports(self):
        first = self.setup_lane()
        write_lane(self.git('rev-parse', '--absolute-git-dir', cwd=self.path), Lane('tools-x', (session_claim('a', 'tools'),)))
        self.assertEqual(self.setup_lane(), first)
        self.assertEqual(self.record().branch, 'tools-x')

    def test_setup_adopts_a_registered_worktree_and_records_its_branch(self):
        self.git('worktree', 'add', '-q', '-b', 'tools-x', str(self.path), 'main', cwd=self.root)
        self.setup_lane()
        self.assertEqual(self.record(), Lane('tools-x', ()))

    def test_setup_refuses_a_plain_folder_and_a_name_that_is_not_a_lane(self):
        self.path.mkdir(parents=True)
        with self.assertRaisesRegex(WorktreeError, 'not a registered worktree'):
            self.setup_lane()
        with self.assertRaisesRegex(WorktreeError, 'not a fixed lane'):
            wt.lane_setup(self.root, 'pmo-a', False)

    def test_setup_installs_dependencies_unless_told_otherwise(self):
        with mock.patch.object(wt, 'install_dependencies') as install:
            self.setup_lane(install=True)
        install.assert_called_once_with(self.path)

    def test_start_refuses_what_is_not_ready(self):
        with self.assertRaisesRegex(WorktreeError, 'not set up'):
            wt.lane_start(self.root, 'claude-1', 'tools-x')
        self.setup_lane()
        for branch in ('main', 'HEAD', 'bad..name'):
            with self.subTest(branch=branch), self.assertRaises(WorktreeError):
                wt.lane_start(self.root, 'claude-1', branch)
        (self.path / 'dirty.txt').write_text('x', encoding='utf-8')
        with self.assertRaisesRegex(WorktreeError, 'uncommitted changes'):
            wt.lane_start(self.root, 'claude-1', 'tools-x')

    def test_start_refuses_a_lane_without_a_record(self):
        self.setup_lane()
        Path(self.git('rev-parse', '--absolute-git-dir', cwd=self.path), 'liwan-lane.json').unlink()
        with self.assertRaisesRegex(WorktreeError, 'has no record'):
            wt.lane_start(self.root, 'claude-1', 'tools-x')

    def test_start_begins_the_branch_from_origin_main_without_upstream_and_records_it(self):
        self.setup_lane()
        self.assertIn('started tools-x', wt.lane_start(self.root, 'claude-1', 'tools-x'))
        self.assertEqual(self.git('branch', '--show-current', cwd=self.path), 'tools-x')
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.path), self.git('rev-parse', 'origin/main', cwd=self.path))
        self.assertEqual(subprocess.run(['git', 'config', 'branch.tools-x.remote'], cwd=self.path, check=False).returncode, 1)
        self.assertEqual(self.record(), Lane('tools-x', ()))

    def test_start_refuses_while_the_lane_holds_an_unmerged_branch(self):
        self.setup_lane()
        wt.lane_start(self.root, 'claude-1', 'tools-x')
        (self.path / 'b.txt').write_text('b', encoding='utf-8')
        self.git('add', 'b.txt', cwd=self.path)
        self.git('commit', '-q', '-m', 'work', cwd=self.path)
        with self.assertRaisesRegex(WorktreeError, 'still holds tools-x, which is not merged into origin/main'):
            wt.lane_start(self.root, 'claude-1', 'tools-y')

    def test_start_accepts_a_lane_whose_branch_is_already_merged(self):
        self.setup_lane()
        wt.lane_start(self.root, 'claude-1', 'tools-x')
        self.merge_into_origin()
        wt.lane_start(self.root, 'claude-1', 'tools-y')
        self.assertEqual(self.record().branch, 'tools-y')
        self.assertNotIn('tools-x', self.git('branch', '--list', 'tools-x', cwd=self.root))

    def test_finish_refuses_a_resting_lane_another_branch_a_dirty_tree_and_an_unmerged_branch(self):
        self.setup_lane()
        with self.assertRaisesRegex(WorktreeError, 'already resting'):
            wt.lane_finish(self.root, 'claude-1')
        wt.lane_start(self.root, 'claude-1', 'tools-x')
        self.git('switch', '-q', '-c', 'moved', cwd=self.path)
        with self.assertRaisesRegex(WorktreeError, 'git switch tools-x'):
            wt.lane_finish(self.root, 'claude-1')
        self.git('switch', '-q', 'tools-x', cwd=self.path)
        (self.path / 'dirty.txt').write_text('x', encoding='utf-8')
        with self.assertRaisesRegex(WorktreeError, 'uncommitted changes'):
            wt.lane_finish(self.root, 'claude-1')
        (self.path / 'dirty.txt').unlink()
        (self.path / 'b.txt').write_text('b', encoding='utf-8')
        self.git('add', 'b.txt', cwd=self.path)
        self.git('commit', '-q', '-m', 'work', cwd=self.path)
        with self.assertRaisesRegex(WorktreeError, 'not merged into origin/main yet'):
            wt.lane_finish(self.root, 'claude-1')

    def test_finish_returns_the_lane_to_a_detached_origin_main_and_deletes_the_branch(self):
        self.setup_lane()
        wt.lane_start(self.root, 'claude-1', 'tools-x')
        self.merge_into_origin()
        write_lane(self.git('rev-parse', '--absolute-git-dir', cwd=self.path), Lane('tools-x', (session_claim('a', 'tools'),)))
        self.assertIn('finished tools-x', wt.lane_finish(self.root, 'claude-1'))
        self.assertEqual(self.git('branch', '--show-current', cwd=self.path), '')
        self.assertEqual(self.git('branch', '--list', 'tools-x', cwd=self.root), '')
        self.assertEqual(self.git('rev-parse', 'HEAD', cwd=self.path), self.git('rev-parse', 'origin/main', cwd=self.path))
        self.assertEqual(self.record(), Lane(None, ()))

    def test_main_dispatches_the_lane_subcommands(self):
        with mock.patch.object(wt, 'repo_root', return_value=Path('/r')), \
                mock.patch.object(wt, 'lane_setup', return_value='set up') as setup, \
                mock.patch.object(wt, 'lane_start', return_value='started') as start, \
                mock.patch.object(wt, 'lane_finish', return_value='finished') as finish, \
                mock.patch.object(wt.sys, 'stdout'):
            self.assertEqual(wt.main(['lane', 'setup', 'claude-1', '--no-install']), 0)
            self.assertEqual(wt.main(['lane', 'start', 'claude-1', 'tools-x']), 0)
            self.assertEqual(wt.main(['lane', 'finish', 'claude-1']), 0)
        setup.assert_called_once_with(Path('/r'), 'claude-1', False)
        start.assert_called_once_with(Path('/r'), 'claude-1', 'tools-x')
        finish.assert_called_once_with(Path('/r'), 'claude-1')

    def test_claim_and_release_run_under_the_repository_claims_lock(self):
        with mock.patch.object(wt, 'repo_root', return_value=Path('/r')), \
                mock.patch.object(wt, 'claims_lock') as lock, \
                mock.patch.object(wt, 'update_claim', side_effect=lambda *a: 'held' if lock.return_value.__enter__.called else 'free'), \
                mock.patch.object(wt, 'release_claim', return_value='released'), \
                mock.patch.object(wt.sys, 'stdout') as out:
            self.assertEqual(wt.main(['claim', '--owner', 'a']), 0)
            self.assertEqual(wt.main(['release', '--owner', 'a']), 0)
        self.assertEqual(lock.call_args_list, [mock.call(Path('/r/.git')), mock.call(Path('/r/.git'))])
        self.assertEqual(out.write.call_args_list[0], mock.call('held\n'))


class TestCleanEnv(unittest.TestCase):
    def test_drops_npm_run_variables_and_keeps_the_rest(self):
        env = {
            'PATH': '/usr/bin', 'HOME': '/h', 'INIT_CWD': '/x', 'npm_command': 'run',
            'npm_config_local_prefix': '/x', 'npm_lifecycle_event': 'wt', 'NPM_TOKEN_NOT_NPM_PREFIX': '1',
        }
        self.assertEqual(clean_env(env), {'PATH': '/usr/bin', 'HOME': '/h', 'NPM_TOKEN_NOT_NPM_PREFIX': '1'})


if __name__ == '__main__':
    unittest.main()
