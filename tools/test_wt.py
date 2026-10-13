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


if __name__ == '__main__':
    unittest.main()
