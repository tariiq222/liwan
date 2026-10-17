"""Real Git regression tests for the local main merge gate."""
from __future__ import annotations

import json
import signal
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import merge_main


class MergeMainTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.repo = root / 'main'
        self.repo.mkdir()
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Gate Test')
        self.git('config', 'user.email', 'gate@example.invalid')
        self.write(self.repo, '.gitignore', '.superpowers/\nignored.txt\n')
        self.write(self.repo, 'shared.txt', 'base\n')
        self.commit(self.repo, 'chore(ci): create baseline')
        self.task = root / 'task'
        self.branch = 'codex/ci-example'
        self.git('worktree', 'add', '-b', self.branch, str(self.task))
        self.write(self.task, 'feature.txt', 'feature\n')
        self.commit(self.task, 'feat(ci): add feature')
        self.source = self.git('rev-parse', self.branch)
        self.write(self.repo, 'main-only.txt', 'approved\n')
        self.commit(self.repo, 'fix(ci): preserve approved work')
        self.base = self.git('rev-parse', 'HEAD')

    def git(self, *args, cwd=None):
        result = subprocess.run(['git', *args], cwd=cwd or self.repo,
                                text=True, capture_output=True, check=True)
        return result.stdout.strip()

    @staticmethod
    def write(repo, name, text):
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self, repo, subject):
        self.git('add', '.', cwd=repo)
        self.git('commit', '-m', subject, cwd=repo)

    def run_gate(self, verifier=None):
        def success(candidate, base, commit, report_dir):
            self.assertEqual(base, self.base)
            self.assertEqual(self.git('rev-parse', 'HEAD', cwd=candidate), commit)
            self.assertEqual((candidate / 'main-only.txt').read_text(), 'approved\n')
            self.assertEqual((candidate / 'feature.txt').read_text(), 'feature\n')
        with patch.object(merge_main, 'verify_candidate', side_effect=verifier or success):
            return merge_main.merge_branch(self.repo, self.branch)

    def assert_main_unchanged(self):
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.base)
        self.assertEqual(self.git('diff', '--cached'), '')
        self.assertFalse((self.repo / 'feature.txt').exists())

    def test_success_promotes_exact_tested_merge_and_preserves_untracked(self):
        self.write(self.repo, 'notes.txt', 'private notes\n')
        result = self.run_gate()
        self.assertEqual(result['status'], 'merged')
        self.assertEqual(self.git('rev-parse', 'HEAD'), result['commit'])
        self.assertEqual(self.git('show', '-s', '--format=%P', 'HEAD').split(),
                         [self.base, self.source])
        self.assertEqual(self.git('rev-parse', 'HEAD^{tree}'), result['tree'])
        self.assertEqual((self.repo / 'notes.txt').read_text(), 'private notes\n')
        self.assertTrue(result['candidate_removed'])
        self.assertFalse(Path(result['candidate']).exists())
        self.assertNotIn(result['candidate'], self.git('worktree', 'list', '--porcelain'))
        self.assertTrue(Path(result['report']).is_file())

    def test_failed_checks_leave_main_untouched(self):
        def fail(*args):
            raise merge_main.GateError('checks failed')
        with self.assertRaisesRegex(merge_main.GateError, 'checks failed'):
            self.run_gate(fail)
        self.assert_main_unchanged()

    def test_failed_checks_preserve_the_candidate_for_diagnosis(self):
        def fail(*args):
            raise merge_main.GateError('checks failed')
        with self.assertRaises(merge_main.GateError):
            self.run_gate(fail)
        report = json.loads(next((self.repo / '.superpowers/merge-main').glob('*/merge.json')).read_text())
        self.assertEqual(report['status'], 'failed')
        self.assertTrue(Path(report['candidate']).is_dir())
        self.assertNotIn('candidate_removed', report)

    def test_interrupt_while_removing_the_candidate_keeps_the_merged_report(self):
        with patch.object(merge_main, 'remove_candidate', side_effect=KeyboardInterrupt), \
                self.assertRaises(KeyboardInterrupt):
            self.run_gate()
        report = json.loads(next((self.repo / '.superpowers/merge-main').glob('*/merge.json')).read_text())
        self.assertEqual(report['status'], 'merged')
        self.assertEqual(self.git('rev-parse', 'HEAD'), report['commit'])

    def test_report_records_the_candidate_removal(self):
        result = self.run_gate()
        self.assertTrue(json.loads(Path(result['report']).read_text())['candidate_removed'])

    def test_sigterm_becomes_keyboard_interrupt_and_is_restored(self):
        before = signal.getsignal(signal.SIGTERM)
        with merge_main.terminate_as_interrupt():
            with self.assertRaisesRegex(KeyboardInterrupt, 'signal'):
                signal.raise_signal(signal.SIGTERM)
        self.assertEqual(signal.getsignal(signal.SIGTERM), before)

    def test_conflict_is_confined_to_candidate(self):
        self.write(self.task, 'shared.txt', 'feature conflict\n')
        self.commit(self.task, 'fix(ci): change shared')
        self.write(self.repo, 'shared.txt', 'main conflict\n')
        self.commit(self.repo, 'fix(ci): change shared differently')
        self.base = self.git('rev-parse', 'HEAD')
        with self.assertRaises(merge_main.GateError):
            self.run_gate()
        self.assert_main_unchanged()
        self.assertEqual((self.repo / 'shared.txt').read_text(), 'main conflict\n')

    def test_dirty_main_and_dirty_source_are_rejected(self):
        for repo in (self.repo, self.task):
            with self.subTest(repo=repo):
                self.write(repo, 'shared.txt', 'uncommitted\n')
                with self.assertRaisesRegex(merge_main.GateError, 'clean'):
                    self.run_gate()
                self.assert_main_unchanged()
                self.git('restore', 'shared.txt', cwd=repo)
        self.write(self.task, 'new-note.txt', 'untracked\n')
        with self.assertRaisesRegex(merge_main.GateError, 'clean'):
            self.run_gate()
        self.assert_main_unchanged()

    def test_untracked_ignored_and_symlink_collisions_are_preserved(self):
        for name in ('feature.txt', 'ignored.txt', 'dir/file.txt'):
            with self.subTest(name=name):
                if name != 'feature.txt':
                    self.write(self.task, name, 'tracked feature\n')
                    self.git('add', '-f', name, cwd=self.task)
                    self.git('commit', '-m', 'feat(ci): add collision', cwd=self.task)
                target = self.repo / name
                if name.startswith('dir/'):
                    outside = Path(self.tmp.name) / 'outside'
                    outside.mkdir()
                    (self.repo / 'dir').symlink_to(outside, target_is_directory=True)
                    target = outside / 'file.txt'
                target.write_text('user file\n')
                with self.assertRaisesRegex(merge_main.GateError, 'collis|symlink'):
                    self.run_gate()
                self.assertEqual(self.git('rev-parse', 'HEAD'), self.base)
                self.assertEqual(self.git('diff', '--cached'), '')
                self.assertEqual(target.read_text(), 'user file\n')
                target.unlink()
                if name.startswith('dir/'):
                    (self.repo / 'dir').unlink()

    def test_ignored_file_as_incoming_parent_is_preserved(self):
        with (self.repo / '.gitignore').open('a') as ignore:
            ignore.write('ignored-parent\n')
        self.commit(self.repo, 'chore(ci): ignore local data')
        self.base = self.git('rev-parse', 'HEAD')
        self.write(self.repo, 'ignored-parent', 'important local data\n')
        self.write(self.task, 'ignored-parent/child.txt', 'feature\n')
        self.commit(self.task, 'feat(ci): add nested path')
        with self.assertRaisesRegex(merge_main.GateError, 'collision'):
            self.run_gate()
        self.assert_main_unchanged()
        self.assertEqual((self.repo / 'ignored-parent').read_text(), 'important local data\n')

    def test_clean_tracked_file_can_be_replaced_with_directory(self):
        (self.task / 'shared.txt').unlink()
        self.write(self.task, 'shared.txt/child.txt', 'new shape\n')
        self.commit(self.task, 'refactor(ci): replace file with directory')
        result = self.run_gate()
        self.assertEqual(result['status'], 'merged')
        self.assertEqual((self.repo / 'shared.txt/child.txt').read_text(), 'new shape\n')

    def prepare_directory_replacement(self):
        self.write(self.repo, 'folder/child.txt', 'old shape\n')
        self.commit(self.repo, 'feat(ci): add tracked directory')
        self.base = self.git('rev-parse', 'HEAD')
        self.git('merge', '--no-edit', 'main', cwd=self.task)
        (self.task / 'folder/child.txt').unlink()
        (self.task / 'folder').rmdir()
        self.write(self.task, 'folder', 'new file\n')
        self.commit(self.task, 'refactor(ci): replace directory with file')

    def test_clean_tracked_directory_can_be_replaced_with_file(self):
        self.prepare_directory_replacement()
        result = self.run_gate()
        self.assertEqual(result['status'], 'merged')
        self.assertEqual((self.repo / 'folder').read_text(), 'new file\n')

    def test_directory_replacement_preserves_untracked_descendants(self):
        self.prepare_directory_replacement()
        self.write(self.repo, 'folder/ignored.txt', 'local data\n')
        with self.assertRaisesRegex(merge_main.GateError, 'collision'):
            self.run_gate()
        self.assert_main_unchanged()
        self.assertEqual((self.repo / 'folder/ignored.txt').read_text(), 'local data\n')

    def test_directory_replacement_preserves_untracked_empty_directory(self):
        self.prepare_directory_replacement()
        (self.repo / 'folder/local-empty').mkdir()
        with self.assertRaisesRegex(merge_main.GateError, 'collision'):
            self.run_gate()
        self.assert_main_unchanged()
        self.assertTrue((self.repo / 'folder/local-empty').is_dir())

    def test_main_movement_during_checks_is_preserved(self):
        def advance(*args):
            self.write(self.repo, 'concurrent.txt', 'another owner\n')
            self.commit(self.repo, 'fix(ci): concurrent approval')
        with self.assertRaisesRegex(merge_main.GateError, 'main.*moved'):
            self.run_gate(advance)
        self.assertNotEqual(self.git('rev-parse', 'HEAD'), self.base)
        self.assertEqual((self.repo / 'concurrent.txt').read_text(), 'another owner\n')
        self.assertFalse((self.repo / 'feature.txt').exists())

    def test_source_movement_during_checks_is_rejected(self):
        def advance(*args):
            self.write(self.task, 'later.txt', 'later\n')
            self.commit(self.task, 'fix(ci): advance source')
        with self.assertRaisesRegex(merge_main.GateError, 'source.*moved'):
            self.run_gate(advance)
        self.assert_main_unchanged()

    def test_dirty_main_during_checks_is_preserved(self):
        def dirty(*args):
            self.write(self.repo, 'shared.txt', 'active writer\n')
        with self.assertRaisesRegex(merge_main.GateError, 'clean'):
            self.run_gate(dirty)
        self.assert_main_unchanged()
        self.assertEqual((self.repo / 'shared.txt').read_text(), 'active writer\n')

    def test_candidate_changed_during_checks_is_rejected(self):
        def dirty(candidate, *args):
            self.write(candidate, 'shared.txt', 'test mutated source\n')
        with self.assertRaisesRegex(merge_main.GateError, 'candidate.*clean'):
            self.run_gate(dirty)
        self.assert_main_unchanged()

    def test_remote_main_ahead_is_rejected(self):
        remote = Path(self.tmp.name) / 'origin.git'
        self.git('init', '--bare', str(remote))
        self.git('remote', 'add', 'origin', str(remote))
        self.git('push', 'origin', 'main')
        peer = Path(self.tmp.name) / 'peer'
        self.git('worktree', 'add', '-b', 'peer', str(peer), 'main')
        self.write(peer, 'remote.txt', 'remote\n')
        self.commit(peer, 'fix(ci): advance remote')
        self.git('push', 'origin', 'peer:main')
        with self.assertRaisesRegex(merge_main.GateError, 'origin/main'):
            self.run_gate()
        self.assert_main_unchanged()

    def test_already_merged_is_truthful_noop(self):
        self.run_gate()
        with patch.object(merge_main, 'verify_candidate') as verifier:
            result = merge_main.merge_branch(self.repo, self.branch)
        self.assertEqual(result['status'], 'already_merged')
        verifier.assert_not_called()

    def test_invalid_branch_is_rejected_without_git_interpretation(self):
        for source in ('main', 'HEAD', 'spike/test', '--help', 'codex/ci-x;touch pwn'):
            with self.subTest(source=source), self.assertRaises(merge_main.GateError):
                merge_main.merge_branch(self.repo, source)
        self.assert_main_unchanged()

    def test_post_promotion_hook_edit_is_reported_without_reset(self):
        hook = self.repo / '.git/hooks/post-merge'
        hook.write_text('#!/bin/sh\n'
                        'if [ "$(git symbolic-ref --short -q HEAD)" = main ]; then\n'
                        '  printf "hook edit\\n" > shared.txt\n'
                        'fi\n')
        hook.chmod(0o755)
        with self.assertRaisesRegex(merge_main.GateError, 'main after promotion'):
            self.run_gate()
        report = next((self.repo / '.superpowers/merge-main').glob('*/merge.json'))
        receipt = json.loads(report.read_text())
        self.assertEqual(receipt['status'], 'promotion_interrupted')
        self.assertEqual(receipt['actual_main'], self.git('rev-parse', 'HEAD'))
        self.assertEqual(receipt['commit'], receipt['actual_main'])
        self.assertEqual((self.repo / 'shared.txt').read_text(), 'hook edit\n')

    def test_parallel_gate_is_rejected(self):
        with merge_main.merge_lock(self.repo):
            with self.assertRaisesRegex(merge_main.GateError, 'another'):
                self.run_gate()
        self.assert_main_unchanged()

    def test_interruption_preserves_main(self):
        def interrupt(*args):
            raise KeyboardInterrupt('owner interrupted checks')
        with self.assertRaises(KeyboardInterrupt):
            self.run_gate(interrupt)
        self.assert_main_unchanged()
        reports = list((self.repo / '.superpowers/merge-main').glob('*/merge.json'))
        self.assertEqual(len(reports), 1)
        self.assertIn('failed', reports[0].read_text())

    def test_runner_must_certify_exact_commit_and_success(self):
        runner = self.repo / 'tools/local_ci.py'
        runner.parent.mkdir()
        for label, code, receipt in (
            ('missing', 0, None),
            ('stale', 0, {'base': self.base, 'commit': 'stale', 'status': 'passed'}),
            ('failed', 1, {'base': self.base, 'commit': self.source, 'status': 'passed'}),
            ('passed', 0, {'base': self.base, 'commit': self.source, 'status': 'passed'}),
        ):
            with self.subTest(label=label):
                runner.write_text(
                    'import json, pathlib, sys\n'
                    'p = pathlib.Path(sys.argv[sys.argv.index("--report-dir") + 1])\n'
                    + (f'(p / "report.json").write_text({json.dumps(receipt)!r})\n'
                       if receipt is not None else '')
                    + f'sys.exit({code})\n')
                report = Path(self.tmp.name) / ('report-' + label)
                if label == 'passed':
                    merge_main.verify_candidate(self.repo, self.base, self.source, report)
                else:
                    with self.assertRaises(merge_main.GateError):
                        merge_main.verify_candidate(self.repo, self.base, self.source, report)
        self.assert_main_unchanged()

    def test_missing_runner_is_a_failure(self):
        with self.assertRaisesRegex(merge_main.GateError, 'runner'):
            merge_main.merge_branch(self.repo, self.branch)
        self.assert_main_unchanged()


if __name__ == '__main__':
    unittest.main()
