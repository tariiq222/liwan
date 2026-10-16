# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re
import socket
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import wt
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
            self.assertRegex(database_name(suffix), r'^nasq_scratch_[a-z0-9_]{1,42}$')

    def test_short_database_name_is_unchanged(self):
        self.assertEqual(database_name('pmo-fix-x'), 'nasq_scratch_pmo_fix_x')

    def test_long_names_with_the_same_prefix_get_different_databases(self):
        prefix = 'web-' + 'a' * 60
        first, second = database_name(prefix + '-one'), database_name(prefix + '-two')
        self.assertNotEqual(first, second)
        for name in (first, second):
            self.assertRegex(name, r'^nasq_scratch_[a-z0-9_]{1,42}$')
            self.assertRegex(name, r'_[0-9a-f]{6}$')

    def test_pick_port_skips_used_and_busy(self):
        self.assertEqual(pick_port(range(10, 15), {10}, lambda p: p != 11), 12)
        with self.assertRaises(WorktreeError):
            pick_port(range(10, 12), {10, 11}, lambda p: True)

    def test_env_content_is_consistent(self):
        text = env_content(3101, 8171, 'nasq_scratch_x')
        self.assertIn('NUXT_ODOO_URL=http://127.0.0.1:8171', text)
        self.assertIn('NUXT_PUBLIC_WS_URL=ws://localhost:8171/websocket', text)
        self.assertEqual(set(map(int, re.findall(r'PORT=(\d+)', text))), {3101, 8171})

    def test_used_ports_reads_sibling_worktrees(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / 'a').mkdir()
            (Path(tmp) / 'a' / '.env.worktree').write_text(env_content(3105, 8180, 'nasq_scratch_a'), encoding='utf-8')
            self.assertEqual(used_ports(Path(tmp)), {3105, 8180})

    def test_used_ports_reads_registered_worktree_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            other = Path(tmp) / 'elsewhere'
            other.mkdir()
            (other / '.env.worktree').write_text(env_content(3110, 8190, 'nasq_scratch_b'), encoding='utf-8')
            self.assertEqual(used_ports(Path(tmp) / 'none', [str(other), str(Path(tmp) / 'missing')]), {3110, 8190})

    def test_parse_worktrees(self):
        self.assertEqual(parse_worktrees(PORCELAIN), [
            ('/r/main', 'refs/heads/main'),
            ('/r/main/.worktrees/pmo-a', 'refs/heads/codex/pmo-a'),
            ('/r/detached', None),
        ])

    def test_create_rejects_bad_branch_names(self):
        for bad in ('nonsense-thing', 'pmo', 'pmo-Bad_Slug', ''):
            with self.assertRaises(WorktreeError):
                create(bad, 'main', False)

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
                        create('tools-x', 'main', False, resume)
                    self.assertIn('already exists', str(caught.exception))

    def test_resume_continues_a_registered_worktree_and_keeps_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, path = self._setup_root(tmp, 'tools-x')
            listing = 'worktree %s\nbranch refs/heads/codex/tools-x\n' % path.resolve()
            installed = []
            with mock.patch.object(wt, 'repo_root', return_value=root), \
                    mock.patch.object(wt, 'sh', return_value=listing), \
                    mock.patch.object(wt, 'port_is_free', return_value=True), \
                    mock.patch.object(wt, 'install_dependencies', side_effect=installed.append):
                with self.assertRaises(WorktreeError):
                    create('tools-x', 'main', True, False)
                first = create('tools-x', 'main', True, True)
                again = create('tools-x', 'main', True, True)
            self.assertEqual(first, again)
            self.assertEqual(first[2:], (3100, 8170))
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
                    mock.patch.object(wt, 'install_dependencies', side_effect=failing_install):
                with self.assertRaises(WorktreeError):
                    create('tools-x', 'main', True, True)


def worktree(**overrides):
    values = dict(
        path=Path('/r/.worktrees/pmo-a'), branch='codex/pmo-a', is_main=False, canonical=True, ahead=0, behind=3,
        merged=True, dirty=False, age_days=2, size=2048, database='nasq_scratch_pmo_a', ports=[3100, 8170])
    values.update(overrides)
    return wt.Worktree(**values)


class TestStatusAndGc(unittest.TestCase):
    def test_format_age_and_size(self):
        self.assertEqual([wt.format_age(d) for d in (0, 3, 45, 800)], ['today', '3d', '1mo', '2y'])
        self.assertEqual((wt.format_size(None), wt.format_size(2048), wt.format_size(2 * 1048576)), ('-', '2M', '2.0G'))

    def test_env_values_reads_database_and_ports(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / '.env.worktree').write_text(env_content(3105, 8180, 'nasq_scratch_a'), encoding='utf-8')
            values = wt.env_values(tmp)
            self.assertEqual((values['NUXT_ODOO_DB'], values['NUXT_PORT']), ('nasq_scratch_a', '3105'))
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
        self.assertEqual(entry.database, 'nasq_scratch_pmo_gone')
        text = wt.format_status([worktree(is_main=True, path=root), entry], root)
        self.assertIn('missing', text)
        self.assertIn('1 folder missing', text)

    def test_abandoned_databases_only_those_of_going_worktrees_and_unconnected(self):
        databases = {
            'nasq_scratch_pmo_a': 0, 'nasq_scratch_e2e': 0, 'nasq_scratch_hand_ux': 0,
            'nasq_scratch_live': 2, 'nasq_scratch_kept': 0,
        }
        owners = [worktree(), worktree(database='nasq_scratch_e2e'), worktree(database='nasq_scratch_live'),
                  worktree(database='nasq_scratch_kept')]
        survivors = [worktree(database='nasq_scratch_kept')]
        with mock.patch.object(wt, 'scratch_databases', return_value=databases):
            self.assertEqual(wt.abandoned_databases(owners, survivors), ['nasq_scratch_pmo_a'])

    def test_no_database_lookup_without_candidates(self):
        with mock.patch.object(wt, 'scratch_databases', side_effect=AssertionError):
            self.assertEqual(wt.abandoned_databases([worktree(database=None)], []), [])

    def test_scratch_databases_parse_with_separator(self):
        with mock.patch.object(wt.shutil, 'which', return_value='/bin/psql'), \
                mock.patch.object(wt, 'run', return_value=(0, 'nasq_scratch_old|0\nodoo19|3\n')):
            self.assertEqual(wt.scratch_databases(), {'nasq_scratch_old': 0})

    def test_scratch_databases_fail_loudly(self):
        with mock.patch.object(wt.shutil, 'which', return_value=None), self.assertRaises(WorktreeError):
            wt.scratch_databases()
        with mock.patch.object(wt.shutil, 'which', return_value='/bin/psql'), \
                mock.patch.object(wt, 'run', return_value=(2, 'no server')), self.assertRaises(WorktreeError) as caught:
            wt.scratch_databases()
        self.assertIn('no server', str(caught.exception))

    def test_format_status_has_a_row_per_worktree_and_a_summary(self):
        root = Path('/r')
        text = wt.format_status([worktree(is_main=True, path=root), worktree(), worktree(canonical=False, dirty=True, path=Path('/x/y'))], root)
        lines = text.splitlines()
        self.assertEqual(len(lines), 6)
        self.assertIn('/x/y *', lines[3])
        self.assertTrue(lines[-1].startswith('2 worktrees: 2 merged, 1 dirty, 1 outside .worktrees'))

    def _gc(self, apply, sh_side_effect):
        patches = (
            mock.patch.object(wt, 'inspect_all', return_value=[worktree()]), mock.patch.object(wt, 'busy_paths', return_value=set()),
            mock.patch.object(wt, 'scratch_databases', return_value={'nasq_scratch_pmo_a': 0, 'nasq_scratch_old': 0}),
            mock.patch.object(wt, 'sh', side_effect=sh_side_effect),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            return wt.gc(Path('/r'), apply, Path('/elsewhere'))

    def test_gc_dry_run_removes_nothing_and_warns_about_ignored_files(self):
        calls = []
        dry = self._gc(False, lambda argv, cwd: calls.append(argv))
        self.assertEqual(calls, [])
        self.assertIn('would remove worktree /r/.worktrees/pmo-a', dry)
        self.assertIn('would drop database nasq_scratch_pmo_a', dry)
        self.assertNotIn('nasq_scratch_old', dry)
        self.assertIn('ignored files', dry)

    def test_gc_apply_removes_worktree_branch_and_its_database(self):
        calls = []

        def fake(argv, cwd):
            calls.append(argv)
            return 'main'

        self._gc(True, fake)
        self.assertEqual(calls, [
            ['git', 'branch', '--show-current'], ['git', 'worktree', 'remove', '/r/.worktrees/pmo-a'],
            ['git', 'branch', '-d', 'codex/pmo-a'], ['dropdb', '--if-exists', 'nasq_scratch_pmo_a']])

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
        self.assertNotIn(['dropdb', '--if-exists', 'nasq_scratch_pmo_a'], calls)  # its worktree survived

    def test_gc_reports_when_nothing_qualifies(self):
        with mock.patch.object(wt, 'inspect_all', return_value=[worktree(dirty=True)]), \
                mock.patch.object(wt, 'busy_paths', return_value=set()):
            self.assertEqual(wt.gc(Path('/r'), True, Path('/x')), 'nothing to clean')


class TestCleanEnv(unittest.TestCase):
    def test_drops_npm_run_variables_and_keeps_the_rest(self):
        env = {
            'PATH': '/usr/bin', 'HOME': '/h', 'INIT_CWD': '/x', 'npm_command': 'run',
            'npm_config_local_prefix': '/x', 'npm_lifecycle_event': 'wt', 'NPM_TOKEN_NOT_NPM_PREFIX': '1',
        }
        self.assertEqual(clean_env(env), {'PATH': '/usr/bin', 'HOME': '/h', 'NPM_TOKEN_NOT_NPM_PREFIX': '1'})


if __name__ == '__main__':
    unittest.main()
