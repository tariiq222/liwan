# Part of Odoo. See LICENSE file for full copyright and licensing details.
import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import hooks
from hooks import check_message, plan_pre_commit
from test_wt import LanePoolCase
from worktree_lanes import LaneError


def names(staged):
    return [name for name, _ in plan_pre_commit(staged)]


class TestHooks(unittest.TestCase):
    def test_policy_checks_always_run(self):
        self.assertEqual(names([]), ['secret_guard', 'docs_policy', 'arch_policy'])

    def test_web_files_add_ui_checks(self):
        self.assertEqual(names(['apps/web/app/a.vue'])[3:], ['ui_policy', 'no_external_refs'])

    def test_every_ui_source_root_adds_ui_checks(self):
        for path in ('apps/vendor-admin/app/a.vue', 'packages/ui/app/a.vue', 'packages/commercial-ui/app/a.vue'):
            with self.subTest(path=path):
                self.assertEqual(names([path])[3:], ['ui_policy', 'no_external_refs'])

    def test_root_dependency_files_add_ui_policy_only(self):
        for path in ('package.json', 'package-lock.json'):
            with self.subTest(path=path):
                self.assertEqual(names([path])[3:], ['ui_policy'])

    def test_addon_python_adds_ruff_on_those_files_only(self):
        steps = dict(plan_pre_commit(['odoo-addons/liwan_hr/a.py', 'tools/x.py', 'docs/a.md']))
        self.assertEqual(steps['ruff'], ['ruff', 'check', 'odoo-addons/liwan_hr/a.py'])

    def test_tools_python_alone_does_not_run_ruff(self):
        self.assertNotIn('ruff', names(['tools/x.py']))

    def test_message_rules(self):
        self.assertIsNone(check_message('feat(tools): add a thing\n\nbody'))
        self.assertIsNone(check_message('# comment\nfix(docs): correct a link\n'))
        self.assertIsNone(check_message("Merge branch 'codex/x'\n"))
        self.assertIsNotNone(check_message('wip stuff\n'))
        self.assertIsNotNone(check_message('feat(unknown): nope\n'))
        self.assertIsNotNone(check_message('\n'))

    def test_revert_is_validated_by_the_subject_policy(self):
        self.assertIsNone(check_message('Revert "feat(tools): add a thing"\n'))
        self.assertIsNotNone(check_message('Revert "wip stuff"\n'))
        self.assertIsNotNone(check_message('Revert "bad subject"\n'))

    def test_autosquash_subjects_ask_for_a_reword(self):
        for subject in (
            'fixup! feat(tools): x', 'squash! feat(tools): x', 'amend! feat(tools): x',
            'Squashed commit of the following:',
        ):
            self.assertIn('type(scope): subject', check_message(subject + '\n'))

    def test_missing_tool_is_a_failing_step_without_traceback(self):
        with mock.patch.object(hooks, 'lane_problem', return_value=None), \
                mock.patch.object(hooks, 'staged_paths', return_value=[]), \
                mock.patch.object(hooks.subprocess, 'run', side_effect=FileNotFoundError('python3')), \
                mock.patch.object(hooks.sys, 'stderr', io.StringIO()) as err:
            self.assertEqual(hooks.pre_commit(), 1)
        self.assertIn('tool not found: python3', err.getvalue())

    def test_passing_checks_run_only_the_planned_steps(self):
        ok = mock.Mock(returncode=0, stdout='', stderr='')
        with mock.patch.object(hooks, 'lane_problem', return_value=None), \
                mock.patch.object(hooks, 'staged_paths', return_value=[]), \
                mock.patch.object(hooks.subprocess, 'run', return_value=ok) as run:
            self.assertEqual(hooks.pre_commit(), 0)
        self.assertEqual(run.call_count, len(plan_pre_commit([])))
        self.assertFalse(hasattr(hooks, 'advisory_jev'))


class TestLaneGuard(LanePoolCase):
    """The pre-commit guard against real checkouts: the main checkout, lanes and a plain linked worktree."""

    def problem(self, path):
        with mock.patch.object(hooks, 'REPO', path):
            return hooks.lane_problem()

    def setUp(self):
        super().setUp()
        self.add('one')

    def test_a_resting_lane_refuses_a_commit(self):
        self.assertIn('resting', self.problem(self.lane_path('one')))

    def test_a_lane_allows_a_commit_on_its_recorded_branch_only(self):
        self.take('tools-a')
        self.assertIsNone(self.problem(self.lane_path('one')))
        self.git('switch', '-q', '-c', 'other', cwd=self.lane_path('one'))
        self.assertIn('holds tools-a but other is checked out', self.problem(self.lane_path('one')))
        self.git('switch', '-q', '--detach', cwd=self.lane_path('one'))
        self.assertIn('a detached HEAD', self.problem(self.lane_path('one')))

    def test_main_is_refused_in_every_checkout(self):
        self.assertIn('main', self.problem(self.root))
        self.git('switch', '-q', '-c', 'feature', cwd=self.root)
        self.assertIsNone(self.problem(self.root))
        self.git('switch', '-q', 'main', cwd=self.root)
        self.take('tools-a')
        self.git('switch', '-q', '--detach', 'main', cwd=self.root)
        self.assertIsNone(self.problem(self.root))

    def test_a_linked_worktree_that_is_not_a_lane_is_refused_with_the_way_out(self):
        self.git('worktree', 'add', '-q', '-b', 'plain', str(self.lane_path('plain')), 'main', cwd=self.root)
        problem = self.problem(self.lane_path('plain'))
        self.assertIn('npm run wt -- lane add <name>', problem)
        self.assertIn('npm run wt -- take <branch>', problem)

    def test_a_rebase_in_the_lane_counts_as_its_recorded_branch(self):
        self.take('tools-a')
        path = self.lane_path('one')
        git_dir = Path(self.git('rev-parse', '--absolute-git-dir', cwd=path))
        self.git('switch', '-q', '--detach', cwd=path)
        self.assertIn('a detached HEAD', self.problem(path))
        (git_dir / 'rebase-merge').mkdir()
        head_name = git_dir / 'rebase-merge' / 'head-name'
        head_name.write_text('refs/heads/tools-a\n', encoding='utf-8')
        self.assertIsNone(self.problem(path))
        head_name.write_text('refs/heads/other\n', encoding='utf-8')
        self.assertIn('holds tools-a but other is checked out', self.problem(path))

    def test_an_unreadable_record_is_a_refusal(self):
        with mock.patch.object(hooks, 'REPO', self.lane_path('one')), \
                mock.patch.object(hooks, 'read_take', side_effect=LaneError('unreadable lane record')):
            self.assertEqual(hooks.lane_problem(), 'unreadable lane record')

    def test_pre_commit_fails_fast_before_any_check(self):
        with mock.patch.object(hooks, 'lane_problem', return_value='this lane is resting'), \
                mock.patch.object(hooks, 'staged_paths', side_effect=AssertionError('checks must not run')), \
                mock.patch.object(hooks.sys, 'stderr', io.StringIO()) as err:
            self.assertEqual(hooks.pre_commit(), 1)
        self.assertEqual(err.getvalue(), 'pre-commit: lane guard: this lane is resting\n')


class TestCommitMsgSilentRevert(unittest.TestCase):
    """`commit-msg` on a real repository: a staged silent revert of `origin/main` is refused, and acknowledged."""

    ENV = {
        'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.com',
        'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.com',
    }

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repo = Path(directory.name).resolve()
        patches = [mock.patch.dict(os.environ, self.ENV), mock.patch.object(hooks, 'REPO', self.repo)]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.git('init', '-q', '-b', 'main')
        self.write('base.txt', 'base\n')
        self.write('modified.txt', 'one\n')
        self.commit('chore(tools): base')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.git('switch', '-q', '-c', 'pr911')
        self.write('modified.txt', 'pr911\n')
        self.write('added.txt', 'added\n')
        self.commit('feat(tools): pr 911')
        self.git('switch', '-q', 'main')
        self.git('merge', '-q', '--no-ff', 'pr911', '-m', 'Merge pull request #911 from x/pr911')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.git('switch', '-q', '-c', 'feature', self.base)
        self.write('feature.txt', 'feat\n')
        self.commit('feat(pmo): feature work')
        self.git('reset', '-q', '--soft', 'origin/main')
        self.merge_sha = self.git('rev-parse', 'origin/main').strip()

    def git(self, *argv):
        return subprocess.run(['git', *argv], cwd=self.repo, check=True, capture_output=True, text=True).stdout

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')

    def commit(self, subject):
        self.git('add', '-A')
        self.git('commit', '-q', '--allow-empty', '-m', subject)

    def run_hook(self, message):
        path = self.repo / 'COMMIT_EDITMSG'
        path.write_text(message, encoding='utf-8')
        with mock.patch.object(hooks.sys, 'stderr', io.StringIO()) as err:
            code = hooks.commit_msg(str(path))
        return code, err.getvalue()

    def test_a_staged_silent_revert_is_refused_and_names_the_clobbered_merge(self):
        code, error = self.run_hook('fix(cp): squash onto main\n')
        self.assertEqual(code, 1)
        self.assertIn('commit-msg: ', error)
        self.assertIn(self.merge_sha[:9], error)
        self.assertIn('Merge pull request #911', error)

    def test_a_reverts_trailer_acknowledges_it(self):
        code, error = self.run_hook(f'chore(cp): drop the change\n\nReverts: {self.merge_sha[:9]}\n')
        self.assertEqual(code, 0, error)


if __name__ == '__main__':
    unittest.main()
