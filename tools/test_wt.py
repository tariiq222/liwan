# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import socket
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import wt
from worktree_claims import read_claim
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
            self.assertRegex(database_name(suffix), r'^webvue_scratch_[a-z0-9_]{1,42}$')

    def test_short_database_name_is_unchanged(self):
        self.assertEqual(database_name('pmo-fix-x'), 'webvue_scratch_pmo_fix_x')

    def test_long_names_with_the_same_prefix_get_different_databases(self):
        prefix = 'web-' + 'a' * 60
        first, second = database_name(prefix + '-one'), database_name(prefix + '-two')
        self.assertNotEqual(first, second)
        for name in (first, second):
            self.assertRegex(name, r'^webvue_scratch_[a-z0-9_]{1,42}$')
            self.assertRegex(name, r'_[0-9a-f]{6}$')

    def test_pick_port_skips_used_and_busy(self):
        self.assertEqual(pick_port(range(10, 15), {10}, lambda p: p != 11), 12)
        with self.assertRaises(WorktreeError):
            pick_port(range(10, 12), {10, 11}, lambda p: True)

    def test_nuxt_allocator_keeps_vendor_ports_free_when_they_are_idle(self):
        self.assertEqual(pick_port(wt.NUXT_PORTS, set(), lambda port: True), 3101)
        self.assertEqual(pick_port(wt.NUXT_PORTS, {3101, 3102}, lambda port: True), 3104)

    def test_env_content_is_consistent(self):
        text = env_content(3101, 8171, 'webvue_scratch_x')
        self.assertIn('NUXT_ODOO_URL=http://127.0.0.1:8171', text)
        self.assertIn('NUXT_PUBLIC_WS_URL=ws://localhost:8171/websocket', text)
        self.assertEqual(set(map(int, re.findall(r'PORT=(\d+)', text))), {3101, 8171})

    def test_used_ports_reads_sibling_worktrees(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'a').mkdir()
            (Path(tmp) / 'a' / '.env.worktree').write_text(env_content(3105, 8180, 'webvue_scratch_a'), encoding='utf-8')
            self.assertEqual(used_ports(Path(tmp)), {3105, 8180})

    def test_used_ports_reads_registered_worktree_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / 'elsewhere'
            other.mkdir()
            (other / '.env.worktree').write_text(env_content(3110, 8190, 'webvue_scratch_b'), encoding='utf-8')
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
        merged=True, dirty=False, age_days=2, size=2048, database='webvue_scratch_pmo_a', ports=[3100, 8170])
    values.update(overrides)
    return wt.Worktree(**values)


class TestStatusAndGc(unittest.TestCase):
    def test_format_age_and_size(self):
        self.assertEqual([wt.format_age(d) for d in (0, 3, 45, 800)], ['today', '3d', '1mo', '2y'])
        self.assertEqual((wt.format_size(None), wt.format_size(2048), wt.format_size(2 * 1048576)), ('-', '2M', '2.0G'))

    def test_env_values_reads_database_and_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / '.env.worktree').write_text(env_content(3105, 8180, 'webvue_scratch_a'), encoding='utf-8')
            values = wt.env_values(tmp)
            self.assertEqual((values['NUXT_ODOO_DB'], values['NUXT_PORT']), ('webvue_scratch_a', '3105'))
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
        self.assertEqual(entry.database, 'webvue_scratch_pmo_gone')
        text = wt.format_status([worktree(is_main=True, path=root), entry], root)
        self.assertIn('missing', text)
        self.assertIn('1 folder missing', text)

    def test_abandoned_databases_only_those_of_going_worktrees_and_unconnected(self):
        databases = {
            'webvue_scratch_pmo_a': 0, 'webvue_scratch_e2e': 0, 'webvue_scratch_hand_ux': 0,
            'webvue_scratch_live': 2, 'webvue_scratch_kept': 0,
        }
        owners = [worktree(), worktree(database='webvue_scratch_e2e'), worktree(database='webvue_scratch_live'),
                  worktree(database='webvue_scratch_kept')]
        survivors = [worktree(database='webvue_scratch_kept')]
        with mock.patch.object(wt, 'scratch_databases', return_value=databases):
            self.assertEqual(wt.abandoned_databases(owners, survivors), ['webvue_scratch_pmo_a'])

    def test_no_database_lookup_without_candidates(self):
        with mock.patch.object(wt, 'scratch_databases', side_effect=AssertionError):
            self.assertEqual(wt.abandoned_databases([worktree(database=None)], []), [])

    def test_scratch_databases_parse_with_separator(self):
        with mock.patch.object(wt.shutil, 'which', return_value='/bin/psql'), \
                mock.patch.object(wt, 'run', return_value=(0, 'webvue_scratch_old|0\nodoo19|3\n')):
            self.assertEqual(wt.scratch_databases(), {'webvue_scratch_old': 0})

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
            mock.patch.object(wt, 'scratch_databases', return_value={'webvue_scratch_pmo_a': 0, 'webvue_scratch_old': 0}),
            mock.patch.object(wt, 'sh', side_effect=sh_side_effect),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            return wt.gc(Path('/r'), apply, Path('/elsewhere'))

    def test_gc_dry_run_removes_nothing_and_warns_about_ignored_files(self):
        calls = []
        dry = self._gc(False, lambda argv, cwd: calls.append(argv))
        self.assertEqual(calls, [])
        self.assertIn('would remove worktree /r/.worktrees/pmo-a', dry)
        self.assertIn('would drop database webvue_scratch_pmo_a', dry)
        self.assertNotIn('webvue_scratch_old', dry)
        self.assertIn('ignored files', dry)

    def test_gc_apply_removes_worktree_branch_and_its_database(self):
        calls = []

        def fake(argv, cwd):
            calls.append(argv)
            return 'main'

        self._gc(True, fake)
        self.assertEqual(calls, [
            ['git', 'branch', '--show-current'], ['git', 'worktree', 'remove', '/r/.worktrees/pmo-a'],
            ['git', 'branch', '-d', 'codex/pmo-a'], ['dropdb', '--if-exists', 'webvue_scratch_pmo_a']])

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
        self.assertNotIn(['dropdb', '--if-exists', 'webvue_scratch_pmo_a'], calls)  # its worktree survived

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
                mock.patch.object(wt, 'scratch_databases', return_value={'webvue_scratch_pmo_a': 0, 'webvue_scratch_pmo_b': 0}), \
                mock.patch.object(wt, 'merged_local_branch', return_value=merged_branch), \
                mock.patch.object(wt, 'sh', side_effect=fake):
            return wt.gc(Path('/r'), apply, Path(current), branch), calls

    def test_gc_branch_limits_victims_and_databases_to_that_branch(self):
        other = worktree(path=Path('/r/.worktrees/pmo-b'), branch='codex/pmo-b', database='webvue_scratch_pmo_b')
        text, calls = self._gc_branch([worktree(), other], 'codex/pmo-a', apply=True)
        self.assertIn('removing worktree /r/.worktrees/pmo-a', text)
        self.assertNotIn('pmo-b', text)
        self.assertIn(['git', 'branch', '-d', 'codex/pmo-a'], calls)
        self.assertIn(['dropdb', '--if-exists', 'webvue_scratch_pmo_a'], calls)
        self.assertNotIn(['dropdb', '--if-exists', 'webvue_scratch_pmo_b'], calls)

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


class TestCleanEnv(unittest.TestCase):
    def test_drops_npm_run_variables_and_keeps_the_rest(self):
        env = {
            'PATH': '/usr/bin', 'HOME': '/h', 'INIT_CWD': '/x', 'npm_command': 'run',
            'npm_config_local_prefix': '/x', 'npm_lifecycle_event': 'wt', 'NPM_TOKEN_NOT_NPM_PREFIX': '1',
        }
        self.assertEqual(clean_env(env), {'PATH': '/usr/bin', 'HOME': '/h', 'NPM_TOKEN_NOT_NPM_PREFIX': '1'})


if __name__ == '__main__':
    unittest.main()
