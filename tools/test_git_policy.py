# Part of Odoo. See LICENSE file for full copyright and licensing details.
from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from git_policy import (
    acknowledged_reverts,
    check_branch,
    check_branch_silent_reverts,
    check_staged_silent_reverts,
    check_subject,
    find_silent_reverts,
    parse_first_parent_history,
    parse_raw_diff,
)


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


ENV = {
    'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@example.com',
    'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@example.com',
}


class GitRepoCase(unittest.TestCase):
    """A real repository with an `origin/main` branch, so the detector runs its actual git commands."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repo = Path(directory.name).resolve()
        for key, value in ENV.items():
            patcher = mock.patch.dict(os.environ, {key: value})
            patcher.start()
            self.addCleanup(patcher.stop)
        self.git('init', '-q', '-b', 'main')

    def git(self, *argv):
        return subprocess.run(['git', *argv], cwd=self.repo, check=True, capture_output=True, text=True).stdout

    def write(self, path, text):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding='utf-8')

    def commit(self, subject):
        self.git('add', '-A')
        self.git('commit', '-q', '--allow-empty', '-m', subject)
        return self.git('rev-parse', 'HEAD').strip()

    def start_main(self):
        """A base commit plus the `origin/main` remote-tracking ref the checks compare against."""
        self.write('base.txt', 'base\n')
        self.write('modified.txt', 'one\n')
        self.base = self.commit('chore(tools): base commit')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')

    def merge_pr(self, branch, subject):
        self.git('switch', '-q', 'main')
        self.git('merge', '-q', '--no-ff', branch, '-m', subject)
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        return self.git('rev-parse', 'HEAD').strip()

    def stale_branch(self, start: str | None = None):
        """A feature branch that started before the PR merged, then `git reset --soft origin/main`."""
        self.git('switch', '-q', '-c', 'feature', start or self.base)
        self.write('feature.txt', 'feat\n')
        self.commit('feat(pmo): feature work')
        self.git('reset', '-q', '--soft', 'origin/main')


class TestSilentRevertParsers(unittest.TestCase):
    def test_raw_diff_reads_blobs_and_paths(self):
        out = (':100644 100644 aaaa bbbb M\tdocs/a.md\n'
               ':000000 100644 ' + '0' * 40 + ' cccc A\tapps/web/e2e/عربي.spec.ts\n'
               ':100644 000000 dddd ' + '0' * 40 + ' D\told.txt\n')
        self.assertEqual(parse_raw_diff(out), {
            'docs/a.md': ('aaaa', 'bbbb'),
            'apps/web/e2e/عربي.spec.ts': ('0' * 40, 'cccc'),
            'old.txt': ('dddd', '0' * 40),
        })

    def test_history_keeps_the_first_section_of_a_commit(self):
        out = ('COMMIT\t' + 'a' * 40 + '\t' + 'b' * 40 + ' ' + 'c' * 40 + '\tMerge pull request #1\n'
               ':100644 100644 1111 2222 M\tx.txt\n'
               'COMMIT\t' + 'a' * 40 + '\t' + 'b' * 40 + '\tMerge pull request #1\n'
               ':100644 100644 3333 4444 M\ty.txt\n'
               'COMMIT\t' + 'b' * 40 + '\t\tfeat(tools): x\n'
               ':000000 100644 ' + '0' * 40 + ' 5555 A\tz.txt\n')
        history = parse_first_parent_history(out)
        self.assertEqual([entry['sha'][:1] for entry in history], ['a', 'b'])
        self.assertEqual(history[0]['parents'], ['b' * 40, 'c' * 40])
        self.assertEqual(history[0]['changes'], {'x.txt': ('1111', '2222')})
        self.assertEqual(history[1]['subject'], 'feat(tools): x')

    def test_acknowledgements(self):
        self.assertEqual(acknowledged_reverts(['Revert "feat(tools): x"\n\nbody']), ({'feat(tools): x'}, set()))
        self.assertEqual(acknowledged_reverts(['feat(tools): x\n\nReverts: ABCDEF1\n']), (set(), {'abcdef1'}))
        self.assertEqual(acknowledged_reverts(['Revert "feat(tools): x"\n\nThis reverts commit ABCDEF1234.\n']),
                         ({'feat(tools): x'}, {'abcdef1234'}))
        self.assertEqual(acknowledged_reverts(['# comment\n\nfeat(tools): x']), (set(), set()))

    def test_a_revert_subject_acknowledges_only_its_own_commit(self):
        history = [
            {'sha': 'a' * 40, 'parents': [], 'subject': 'feat(tools): x', 'changes': {'x': ('1111', '2222')}},
            {'sha': 'b' * 40, 'parents': [], 'subject': 'feat(tools): y', 'changes': {'y': ('3333', '4444')}},
        ]
        self.assertEqual(find_silent_reverts({'x': ('2222', '1111')}, history, ['Revert "feat(tools): x"']), [])
        problems = find_silent_reverts({'y': ('4444', '3333')}, history, ['Revert "feat(tools): x"'])
        self.assertEqual(len(problems), 1, problems)
        self.assertIn('feat(tools): y', problems[0])

    def test_the_previous_main_commit_is_never_an_acknowledgement(self):
        """A merge's first parent is the older `main` commit itself, so naming it must not cover the merge."""
        history = [{'sha': 'a' * 40, 'parents': ['b' * 40, 'c' * 40], 'subject': 'Merge pull request #1',
                    'changes': {'x': ('1111', '2222')}}]
        message = 'chore(tools): drop a change\n\nReverts: ' + 'b' * 40
        self.assertEqual(len(find_silent_reverts({'x': ('2222', '1111')}, history, [message])), 1)
        for sha in ('a' * 40, 'c' * 40):
            with self.subTest(sha=sha[:9]):
                self.assertEqual(find_silent_reverts(
                    {'x': ('2222', '1111')}, history, [f'chore(tools): drop a change\n\nReverts: {sha[:9]}']), [])


class TestSilentReverts(GitRepoCase):
    def test_reset_soft_onto_origin_main_restores_the_pre_merge_tree(self):
        """The #912 shape: a branch started before #911, then squashed with `git reset --soft origin/main`."""
        self.start_main()
        self.git('switch', '-q', '-c', 'pr911')
        self.write('modified.txt', 'pr911\n')
        self.write('added.txt', 'added\n')
        self.commit('feat(tools): land pr 911 changes')
        merge = self.merge_pr('pr911', 'Merge pull request #911 from x/pr911')
        self.stale_branch()
        staged = check_staged_silent_reverts('fix(cp): squash onto main', cwd=self.repo)
        self.assertEqual(len(staged), 1, staged)
        self.assertIn(merge[:9], staged[0])
        self.assertIn('Merge pull request #911', staged[0])
        self.assertIn('2/2', staged[0])
        self.assertIn('added.txt', staged[0])
        self.assertIn('git reset --soft origin/main', staged[0])
        self.git('commit', '-q', '-m', 'fix(cp): squash onto main')
        branch = check_branch_silent_reverts('origin/main', cwd=self.repo)
        self.assertEqual(len(branch), 1, branch)
        self.assertIn(merge[:9], branch[0])

    def test_a_pure_add_pr_is_caught_by_undoing_every_file(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'pr-add')
        self.write('new-one.txt', 'one\n')
        self.write('new-two.txt', 'two\n')
        self.commit('feat(tools): add two files')
        merge = self.merge_pr('pr-add', 'Merge pull request #910 from x/pr-add')
        self.git('switch', '-q', 'main')
        self.git('switch', '-q', '-c', 'feature', 'origin/main~1')
        self.commit('chore(tools): nothing yet')
        self.git('reset', '-q', '--soft', 'origin/main')
        problems = check_staged_silent_reverts('feat(pmo): unrelated work', cwd=self.repo)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn(merge[:9], problems[0])
        self.assertIn('2/2', problems[0])

    def test_a_multi_pr_clobber_is_caught(self):
        """Two PRs touch the same file; the stale branch restores the blob from before both."""
        self.start_main()
        self.git('switch', '-q', '-c', 'pr1')
        self.write('modified.txt', 'pr1\n')
        self.commit('feat(tools): pr1')
        merge1 = self.merge_pr('pr1', 'Merge pull request #901 from x/pr1')
        self.git('switch', '-q', '-c', 'pr2', 'origin/main')
        self.write('modified.txt', 'pr2\n')
        self.commit('feat(tools): pr2')
        self.git('switch', '-q', 'main')
        self.git('merge', '-q', '--no-ff', 'pr2', '-m', 'Merge pull request #902 from x/pr2')
        self.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
        self.git('switch', '-q', '-c', 'feature', self.base)
        self.commit('chore(tools): start')
        self.git('reset', '-q', '--soft', 'origin/main')
        problems = check_staged_silent_reverts('feat(pmo): feature work', cwd=self.repo)
        self.assertTrue(problems, 'the restore to the pre-PR1 blob must be reported')
        self.assertIn(merge1[:9], ' '.join(problems))

    def test_deleting_one_file_of_a_larger_pr_is_not_a_revert(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'pr-big')
        self.write('keep-one.txt', 'one\n')
        self.write('keep-two.txt', 'two\n')
        self.write('drop-me.txt', 'drop\n')
        self.commit('feat(tools): add three files')
        self.merge_pr('pr-big', 'Merge pull request #903 from x/pr-big')
        self.git('switch', '-q', '-c', 'cleanup')
        self.git('rm', '-q', 'drop-me.txt')
        self.commit('chore(tools): drop an unused file')
        self.assertEqual(check_branch_silent_reverts('origin/main', cwd=self.repo), [])

    def test_a_rebase_onto_origin_main_passes(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'pr-rebased')
        self.write('modified.txt', 'pr-rebased\n')
        self.commit('feat(tools): rebased work')
        self.merge_pr('pr-rebased', 'Merge pull request #904 from x/pr-rebased')
        self.git('switch', '-q', '-c', 'feature', 'origin/main~1')
        self.commit('chore(tools): start')
        self.git('rebase', '-q', 'origin/main')
        self.assertEqual(check_branch_silent_reverts('origin/main', cwd=self.repo), [])

    def test_git_revert_of_the_merge_passes(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'pr-reverted')
        self.write('modified.txt', 'pr-reverted\n')
        self.commit('feat(tools): reverted work')
        merge = self.merge_pr('pr-reverted', 'Merge pull request #905 from x/pr-reverted')
        self.git('switch', '-q', '-c', 'revert', 'origin/main~1')
        self.git('revert', '--no-commit', '-m', '1', 'origin/main')
        subject = 'Revert "Merge pull request #905 from x/pr-reverted"'
        self.assertEqual(check_staged_silent_reverts(f'{subject}\n\nThis reverts commit {merge}.\n', cwd=self.repo), [])
        self.commit(subject)
        self.assertEqual(check_branch_silent_reverts('origin/main', cwd=self.repo), [])

    def test_an_unrelated_revert_commit_covers_only_its_own_subject(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'pr-other')
        self.write('modified.txt', 'pr-other\n')
        self.commit('feat(tools): merged elsewhere')
        merge = self.merge_pr('pr-other', 'Merge pull request #907 from x/pr-other')
        self.git('switch', '-q', '-c', 'feature', 'origin/main~1')
        self.write('own.txt', 'own\n')
        self.commit('feat(pmo): own work')
        self.git('revert', '--no-edit', 'HEAD')
        self.git('reset', '-q', '--soft', 'origin/main')
        self.commit('feat(pmo): own work landed')
        problems = check_branch_silent_reverts('origin/main', cwd=self.repo)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn(merge[:9], problems[0])

    def test_a_reverts_trailer_acknowledges_the_merge_or_the_pr_commit(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'pr-acked')
        self.write('modified.txt', 'pr-acked\n')
        self.commit('feat(tools): acknowledged work')
        merge = self.merge_pr('pr-acked', 'Merge pull request #906 from x/pr-acked')
        pr_commit = self.git('rev-parse', 'origin/main^2').strip()
        for sha in (merge, pr_commit):
            with self.subTest(sha=sha[:9]):
                self.git('switch', '-q', '-c', 'ack-' + sha[:7], 'origin/main~1')
                self.commit('chore(tools): start')
                self.git('reset', '-q', '--soft', 'origin/main')
                message = f'chore(tools): drop a change\n\nReverts: {sha[:9]}\n'
                self.assertEqual(check_staged_silent_reverts(message, cwd=self.repo), [])
                self.git('reset', '-q', '--hard')

    def test_a_reverts_trailer_naming_the_previous_main_commit_covers_nothing(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'pr-prev')
        self.write('modified.txt', 'pr-prev\n')
        self.commit('feat(tools): previous main work')
        merge = self.merge_pr('pr-prev', 'Merge pull request #908 from x/pr-prev')
        previous = self.git('rev-parse', 'origin/main^1').strip()
        self.git('switch', '-q', '-c', 'prev-ack', 'origin/main~1')
        self.commit('chore(tools): start')
        self.git('reset', '-q', '--soft', 'origin/main')
        problems = check_staged_silent_reverts(f'chore(tools): drop a change\n\nReverts: {previous[:9]}\n',
                                               cwd=self.repo)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn(merge[:9], problems[0])

    def test_editing_a_file_the_branch_owns_is_not_a_revert(self):
        self.start_main()
        self.git('switch', '-q', '-c', 'owned')
        self.write('modified.txt', 'owned\n')
        self.commit('feat(tools): own the file')
        self.write('modified.txt', 'owned twice\n')
        self.git('add', 'modified.txt')
        self.assertEqual(check_staged_silent_reverts('feat(tools): rework the file', cwd=self.repo), [])

    def test_an_unknown_base_ref_is_skipped(self):
        self.start_main()
        self.write('base.txt', 'changed\n')
        self.git('add', '-A')
        self.assertEqual(check_staged_silent_reverts('feat(tools): x', base_ref='origin/missing', cwd=self.repo), [])

    def test_a_merge_commit_message_is_skipped(self):
        self.start_main()
        self.assertEqual(check_staged_silent_reverts("Merge branch 'main' into feature", cwd=self.repo), [])


if __name__ == '__main__':
    unittest.main()

