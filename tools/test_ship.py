"""Real Git regression tests for the ship command (merge gate, cleanup, guarded push)."""
from __future__ import annotations

import contextlib
import io
import signal
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import merge_main
import ship
import wt


class ShipTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.origin = root / 'origin.git'
        self.git('init', '--bare', '-b', 'main', str(self.origin), cwd=root)
        self.repo = root / 'main'
        self.repo.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Ship Test')
        self.git('config', 'user.email', 'ship@example.invalid')
        self.write(self.repo, '.gitignore', '.superpowers/\n')
        self.commit(self.repo, 'chore(tools): create baseline')
        self.git('remote', 'add', 'origin', str(self.origin))
        self.git('push', 'origin', 'main')
        self.task = root / 'task'
        self.branch = 'codex/tools-example'
        self.git('worktree', 'add', '-b', self.branch, str(self.task))
        self.write(self.task, 'feature.txt', 'feature\n')
        self.commit(self.task, 'feat(tools): add feature')
        self.origin_before = self.origin_main()

    def git(self, *args, cwd=None):
        result = subprocess.run(['git', *args], cwd=cwd or self.repo,
                                text=True, capture_output=True, check=True)
        return result.stdout.strip()

    @staticmethod
    def write(repo, name, text):
        (repo / name).write_text(text)

    def commit(self, repo, subject):
        self.git('add', '.', cwd=repo)
        self.git('commit', '-m', subject, cwd=repo)

    def origin_main(self):
        return self.git('rev-parse', 'refs/heads/main', cwd=self.origin)

    def branch_exists(self):
        return bool(self.git('branch', '--list', self.branch))

    def ship(self, *flags, tty=True, answer='y', verifier=None):
        """``(exit code, stdout)``; the CI runner, process and database lookups are stubbed."""
        out = io.StringIO()
        self.stderr = io.StringIO()
        asked = Mock(side_effect=lambda prompt: answer)
        with patch.object(merge_main, 'verify_candidate', side_effect=verifier), \
                patch.object(wt, 'busy_paths', return_value=set()), \
                patch.object(wt, 'scratch_databases', return_value={}), \
                patch.object(wt, 'repo_root', return_value=self.repo), \
                patch('sys.stdin', new=Mock(isatty=Mock(return_value=tty))), \
                patch('builtins.input', new=asked), \
                contextlib.redirect_stdout(out), contextlib.redirect_stderr(self.stderr):
            code = ship.ship_branch(self.repo, self.branch, clean='--no-clean' not in flags, push='--no-push' not in flags)
        self.asked = asked
        return code, out.getvalue()

    def assert_cleaned(self):
        self.assertFalse(self.task.exists())
        self.assertFalse(self.branch_exists())

    def test_merge_clean_and_push_after_yes(self):
        code, output = self.ship()
        self.assertEqual(code, 0)
        self.assert_cleaned()
        self.assertEqual(self.origin_main(), self.git('rev-parse', 'main'))
        self.assertIn(f"pushed {self.git('rev-parse', 'main')}", output)
        self.assertEqual(list((self.repo / '.superpowers/merge-main').glob('*/candidate')), [])

    def test_answering_no_pushes_nothing(self):
        code, output = self.ship(answer='n')
        self.assertEqual(code, 0)
        self.assertEqual(self.origin_main(), self.origin_before)
        self.assertIn('nothing was pushed', output)
        self.assert_cleaned()

    def test_only_an_exact_yes_confirms(self):
        for answer, expected in (('y', True), ('Yes', True), ('', False), ('yep', False), ('n', False), ('yy', False)):
            with self.subTest(answer=answer), patch('builtins.input', return_value=answer):
                self.assertIs(ship.confirm(1), expected)
        with patch('builtins.input', side_effect=EOFError):
            self.assertFalse(ship.confirm(1))

    def test_yes_is_case_insensitive(self):
        code, _ = self.ship(answer=' YES ')
        self.assertEqual(code, 0)
        self.assertEqual(self.origin_main(), self.git('rev-parse', 'main'))

    def test_not_a_terminal_never_asks_or_pushes(self):
        code, output = self.ship(tty=False)
        self.assertEqual(code, 0)
        self.asked.assert_not_called()
        self.assertEqual(self.origin_main(), self.origin_before)
        self.assertIn('not a terminal: push skipped; run  git push origin main  yourself', output)
        self.assert_cleaned()

    def test_gate_failure_neither_cleans_nor_pushes(self):
        def fail(*args):
            raise merge_main.GateError('checks failed')
        with patch.object(wt, 'gc', side_effect=AssertionError('must not clean')):
            code, _ = self.ship(verifier=fail)
        self.assertEqual(code, 1)
        self.assertTrue(self.task.is_dir())
        self.assertTrue(self.branch_exists())
        self.assertEqual(self.origin_main(), self.origin_before)
        self.asked.assert_not_called()

    def test_no_push_still_cleans(self):
        code, output = self.ship('--no-push')
        self.assertEqual(code, 0)
        self.assert_cleaned()
        self.assertEqual(self.origin_main(), self.origin_before)
        self.asked.assert_not_called()
        self.assertNotIn('commit(s)', output)

    def test_no_clean_keeps_the_task(self):
        code, _ = self.ship('--no-clean')
        self.assertEqual(code, 0)
        self.assertTrue(self.task.is_dir())
        self.assertTrue(self.branch_exists())
        self.assertEqual(self.origin_main(), self.git('rev-parse', 'main'))

    def test_already_merged_branch_continues_to_clean_and_push(self):
        with patch.object(merge_main, 'verify_candidate'):
            merge_main.merge_branch(self.repo, self.branch)
        code, output = self.ship()
        self.assertEqual(code, 0)
        self.assertIn('already_merged', output)
        self.assert_cleaned()
        self.assertEqual(self.origin_main(), self.git('rev-parse', 'main'))

    def test_cleanup_failure_still_offers_the_push_and_exits_1(self):
        with patch.object(wt, 'gc', side_effect=wt.WorktreeError('locked')):
            code, output = self.ship()
        self.assertEqual(code, 1)
        self.assertEqual(self.origin_main(), self.git('rev-parse', 'main'))
        self.assertIn('pushed', output)

    def test_nothing_ahead_of_origin_is_reported(self):
        self.git('merge', '--no-ff', '-m', "Merge branch 'x'", self.branch)
        self.git('push', 'origin', 'main')
        code, output = self.ship('--no-clean')
        self.assertEqual(code, 0)
        self.assertIn('main already matches origin/main', output)
        self.asked.assert_not_called()

    def test_diverged_origin_is_refused_without_pushing(self):
        other = Path(self.tmp.name) / 'other'
        self.git('clone', str(self.origin), str(other), cwd=Path(self.tmp.name))
        self.write(other, 'remote.txt', 'remote\n')
        self.git('config', 'user.name', 'Other', cwd=other)
        self.git('config', 'user.email', 'other@example.invalid', cwd=other)
        self.commit(other, 'fix(tools): remote change')
        self.git('push', 'origin', 'main', cwd=other)
        remote_tip = self.origin_main()
        self.write(self.repo, 'local.txt', 'local\n')
        self.commit(self.repo, 'fix(tools): local change')
        with patch('sys.stdin', new=Mock(isatty=Mock(return_value=True))), \
                patch('builtins.input', side_effect=AssertionError('must not ask')):
            with self.assertRaisesRegex(ship.ShipError, 'fast-forward'):
                ship.push_main(self.repo)
        self.assertEqual(self.origin_main(), remote_tip)

    def test_interrupt_exits_130_with_a_neutral_message(self):
        with patch.object(ship, 'ship_branch', side_effect=KeyboardInterrupt), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(ship.main([self.branch]), 130)
        self.assertIn('interrupted; check git status and npm run wt -- status', err.getvalue())

    def test_sigterm_is_handled_like_an_interrupt(self):
        def terminate(*args, **kwargs):
            signal.raise_signal(signal.SIGTERM)
        with patch.object(ship, 'ship_branch', side_effect=terminate), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(ship.main([self.branch]), 130)

    def test_os_error_exits_1(self):
        with patch.object(ship, 'ship_branch', side_effect=OSError('disk gone')), \
                contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(ship.main([self.branch]), 1)
        self.assertIn('disk gone', err.getvalue())

    def test_gc_keeping_the_task_is_a_failure(self):
        kept = wt.WorktreeKept('kept: worktree x: it is the current directory; run this from the main checkout')
        with patch.object(wt, 'gc', side_effect=kept), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertFalse(ship.clean_task(self.branch))
        self.assertIn('run this from the main checkout', err.getvalue())

    def test_kept_task_exits_1_but_the_push_step_still_runs(self):
        kept = wt.WorktreeKept('kept: worktree x: a process is running in it')
        with patch.object(wt, 'gc', side_effect=kept):
            code, output = self.ship()
        self.assertEqual(code, 1)
        self.assertIn('not cleaned up', self.stderr.getvalue())
        self.assertEqual(self.origin_main(), self.git('rev-parse', 'main'))

    def test_failed_candidate_removal_is_warned_about(self):
        def failing(main, candidate, result):
            result.update(candidate_removed=False, candidate_error='locked')
        with patch.object(merge_main, 'remove_candidate', side_effect=failing):
            code, _ = self.ship('--no-clean', '--no-push')
        self.assertEqual(code, 0)
        self.assertIn('was not removed: locked', self.stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
