# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from git_policy import check_branch, check_subject


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
    def test_allowed_branches(self):
        for name in ('main', 'HEAD', 'codex/pmo-milestone-reorder', 'codex/tools-arch-policy', 'codex/meetings-split', 'spike/generic-app-layer'):
            self.assertIsNone(check_branch(name), name)

    def test_rejected_branches(self):
        for name in (
            'codex/saas-admin-fixes',
            'codex/pmo',
            'codex/pmo-',
            'codex/PMO-thing',
            'feature/pmo-thing',
            'customer/acme',
            'support/1.0',
            'spike/',
        ):
            self.assertIn('must be main', check_branch(name), name)


if __name__ == '__main__':
    unittest.main()
