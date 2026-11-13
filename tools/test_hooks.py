# Part of Odoo. See LICENSE file for full copyright and licensing details.
import io
import unittest
from pathlib import Path
from unittest import mock

import hooks
from hooks import check_message, plan_pre_commit
from worktree_claims import ClaimError, Lane, make_claim

OUTSIDE = Path('/r/checkout')  # not a fixed lane, so the lane guard does nothing
LANE_REPO = Path('/r/.worktrees/claude-1')
STARTED = Lane('tools-x', (make_claim('a', 'task', 'tools-x', ['tools'], 10),))


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
        with mock.patch.object(hooks, 'REPO', OUTSIDE), \
                mock.patch.object(hooks, 'staged_paths', return_value=[]), \
                mock.patch.object(hooks.subprocess, 'run', side_effect=FileNotFoundError('python3')), \
                mock.patch.object(hooks.sys, 'stderr', io.StringIO()) as err:
            self.assertEqual(hooks.pre_commit(), 1)
        self.assertIn('tool not found: python3', err.getvalue())

    def test_passing_checks_run_only_the_planned_steps(self):
        ok = mock.Mock(returncode=0, stdout='', stderr='')
        with mock.patch.object(hooks, 'REPO', OUTSIDE), \
                mock.patch.object(hooks, 'staged_paths', return_value=[]), \
                mock.patch.object(hooks.subprocess, 'run', return_value=ok) as run:
            self.assertEqual(hooks.pre_commit(), 0)
        self.assertEqual(run.call_count, len(plan_pre_commit([])))
        self.assertFalse(hasattr(hooks, 'advisory_jev'))


class TestLaneGuard(unittest.TestCase):
    def guard(self, repo=LANE_REPO, lane=STARTED, branch='tools-x', staged='tools/wt.py\0', session='a', merge_head=False):
        def fake_git(argv):
            if argv[:2] == ['rev-parse', '--absolute-git-dir']:
                return '/r/.git/worktrees/claude-1\n'
            if argv[:2] == ['branch', '--show-current']:
                return branch + '\n'
            return staged

        environ = {hooks.SESSION_ENV: session} if session else {}
        with mock.patch.object(hooks, 'REPO', repo), \
                mock.patch.object(hooks, 'git_output', side_effect=fake_git) as git, \
                mock.patch.object(hooks, 'read_lane', return_value=lane), \
                mock.patch.object(Path, 'exists', return_value=merge_head), \
                mock.patch.object(hooks.os, 'environ', environ):
            return hooks.lane_problem(), git

    def test_it_does_nothing_outside_a_fixed_lane(self):
        for repo in (OUTSIDE, Path('/r/claude-1'), Path('/r/.worktrees/pmo-a'), Path('/r/.worktrees/claude-3')):
            with self.subTest(repo=repo):
                problem, git = self.guard(repo=repo, lane=None)
                self.assertIsNone(problem)
                git.assert_not_called()

    def test_a_session_inside_its_claim_may_commit(self):
        self.assertIsNone(self.guard()[0])

    def test_every_staged_path_counts_including_deletions_and_both_rename_sides(self):
        problem, git = self.guard(staged='tools/wt.py\0docs/old name.md\0')
        self.assertIn('  docs/old name.md', problem)
        self.assertIn(mock.call(['diff', '--cached', '--name-only', '--no-renames', '-z']), git.call_args_list)

    def test_a_missing_session_or_a_moved_branch_is_refused(self):
        self.assertIn('LIWAN_SESSION', self.guard(session='')[0])
        self.assertIn('git switch tools-x', self.guard(branch='other')[0])

    def test_a_merge_in_progress_skips_the_scope_rule(self):
        self.assertIsNone(self.guard(staged='docs/a.md\0', merge_head=True)[0])

    def test_an_unreadable_lane_record_is_a_refusal(self):
        with mock.patch.object(hooks, 'REPO', LANE_REPO), \
                mock.patch.object(hooks, 'git_output', return_value='/r/.git/worktrees/claude-1\n'), \
                mock.patch.object(hooks, 'read_lane', side_effect=ClaimError('unreadable lane record')):
            self.assertEqual(hooks.lane_problem(), 'unreadable lane record')

    def test_pre_commit_fails_fast_before_any_check(self):
        with mock.patch.object(hooks, 'lane_problem', return_value='lane claude-1 is resting'), \
                mock.patch.object(hooks, 'staged_paths', side_effect=AssertionError('checks must not run')), \
                mock.patch.object(hooks.sys, 'stderr', io.StringIO()) as err:
            self.assertEqual(hooks.pre_commit(), 1)
        self.assertEqual(err.getvalue(), 'pre-commit: lane guard: lane claude-1 is resting\n')


if __name__ == '__main__':
    unittest.main()
