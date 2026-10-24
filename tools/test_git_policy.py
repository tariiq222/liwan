# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from unittest import mock

import git_policy
from git_policy import check_branch, check_generated_commits, check_subject


class TestSubject(unittest.TestCase):
    def test_conventional_subject_passes(self):
        self.assertIsNone(check_subject('feat(pmo): add milestone reorder endpoint'))
        self.assertIsNone(check_subject('ci(tools): run arch_policy in the static step'))
        self.assertIsNone(check_subject('test(meetings): pin meeting grants'))

    def test_merge_subjects_are_no_longer_exempt(self):
        self.assertIn("expected 'type(scope): subject'", check_subject('Merge stuff'))
        self.assertIn("expected 'type(scope): subject'", check_subject("Merge branch 'codex/pmo-reorder'"))

    def test_revert_passes_only_when_the_inner_subject_passes(self):
        self.assertIsNone(check_subject('Revert "feat(pmo): add x"'))
        self.assertIn('wip commits', check_subject('Revert "wip"'))
        self.assertIn("expected 'type(scope): subject'", check_subject('Revert "random text"'))

    def test_wip_is_rejected_in_any_form(self):
        for subject in ('wip', 'WIP: stuff', 'wip(pmo): task updates', 'fix(pmo): wip on tasks', 'fix(pmo): tasks WIP'):
            self.assertIn('wip commits', check_subject(subject), subject)

    def test_words_containing_wip_are_allowed(self):
        self.assertIsNone(check_subject('fix(pmo): wipe stale cache'))

    def test_unknown_type_scope_or_missing_scope_is_rejected(self):
        for subject in (
            'feature(pmo): add thing',
            'feat(vendor): add thing',
            'feat: add thing',
            'feat(pmo) add thing',
            'feat(pmo):add thing',
            'feat(pmo): ',
            'Record completed local workspace consolidation',
            '',
        ):
            self.assertIn("expected 'type(scope): subject'", check_subject(subject), subject)

    def test_subject_length_limit(self):
        self.assertIsNone(check_subject('fix(hr): ' + 'x' * 63))
        self.assertIn('limit is 72', check_subject('fix(hr): ' + 'x' * 64))

    def test_arabic_subject_text_is_allowed(self):
        self.assertIsNone(check_subject('docs(docs): توثيق قواعد المعمارية'))


class TestBranch(unittest.TestCase):
    def test_any_normal_branch_is_allowed(self):
        for name in (
            'main', 'HEAD', 'codex/pmo-milestone-reorder', 'claude/ci-revert-44',
            'feature/pmo-thing', 'customer/acme', 'support/1.0', 'spike/generic-app-layer',
            'owner/anything-goes', 'codex/saas-admin-fixes',
        ):
            self.assertIsNone(check_branch(name), name)

    def test_malformed_branch_names_are_rejected(self):
        for name in ('', '-leading-dash', 'bad..dots', 'double//slash', 'trailing/', 'space name'):
            self.assertIn('not a valid branch name', check_branch(name), name)

    def test_git_invalid_components_are_rejected(self):
        for name in ('feature/.hidden', 'feature/topic.lock', 'topic.lock/child',
                     'feature/trailing.', '@{-1}', 'feature/name\n'):
            with self.subTest(name=name):
                problem = check_branch(name)
                self.assertIsNotNone(problem, name)
                self.assertIn('not a valid branch name', problem, name)

    def test_git_valid_names_do_not_need_an_agent_prefix(self):
        for name in ('release/v1+qa', 'feature/a@b', 'موضوع/تصحيح', '_owner/task'):
            with self.subTest(name=name):
                self.assertIsNone(check_branch(name), name)


if __name__ == '__main__':
    unittest.main()


class TestGeneratedFiles(unittest.TestCase):
    def test_task_branch_commit_touching_a_generated_file_is_refused_with_a_clear_message(self):
        problems = check_generated_commits('codex/pmo-reorder', {'docs/api/openapi.json': ['abc1234'], 'docs/api/route-capabilities.json': ['def5678']})
        self.assertEqual(len(problems), 2)
        self.assertIn('abc1234', problems[0])
        self.assertIn('docs/api/openapi.json', problems[0])
        self.assertIn('docs/api/route-capabilities.json', problems[1])
        self.assertIn('orchestrator regenerates it at integration', problems[0])

    def test_integration_and_main_branches_may_change_them(self):
        touching = {'docs/api/openapi.json': ['abc1234']}
        self.assertEqual(check_generated_commits('codex/tools-integrate-finance', touching), [])
        self.assertEqual(check_generated_commits('main', touching), [])

    def test_detached_ci_checkout_can_verify_regenerated_api_files(self):
        self.assertEqual(check_generated_commits('HEAD', {'docs/api/openapi.json': ['abc1234']}), [])

    def test_other_tools_task_branch_is_still_a_task_branch(self):
        self.assertEqual(len(check_generated_commits('codex/tools-capability-gate', {'docs/api/openapi.json': ['abc1234']})), 1)

    def test_no_touching_commit_is_fine(self):
        self.assertEqual(check_generated_commits('codex/pmo-reorder', {'docs/api/openapi.json': []}), [])

    def test_commits_come_from_a_path_limited_git_log_per_generated_file(self):
        with mock.patch.object(git_policy, '_git', return_value='abc1234\ndef5678\n') as git:
            found = git_policy.generated_commits('main')
        self.assertEqual(set(found), set(git_policy.GENERATED))
        self.assertEqual(found['docs/api/openapi.json'], ['abc1234', 'def5678'])
        self.assertEqual([call.args[-2:] for call in git.call_args_list],
                         [('--', path) for path in git_policy.GENERATED])
