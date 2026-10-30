# Part of Odoo. See LICENSE file for full copyright and licensing details.
import io
import unittest
from unittest import mock

import hooks
from hooks import check_message, plan_pre_commit


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
        with mock.patch.object(hooks, 'staged_paths', return_value=[]), \
                mock.patch.object(hooks.subprocess, 'run', side_effect=FileNotFoundError('python3')), \
                mock.patch.object(hooks.sys, 'stderr', io.StringIO()) as err:
            self.assertEqual(hooks.pre_commit(), 1)
        self.assertIn('tool not found: python3', err.getvalue())

    def test_jev_runs_after_passing_checks_and_never_fails_the_commit(self):
        ok = mock.Mock(returncode=0, stdout='', stderr='')
        with mock.patch.object(hooks, 'staged_paths', return_value=[]), \
                mock.patch.object(hooks.subprocess, 'run', return_value=ok), \
                mock.patch.object(hooks, 'advisory_jev') as jev:
            self.assertEqual(hooks.pre_commit(), 0)
        jev.assert_called_once()

    def test_jev_failure_is_reported_without_blocking(self):
        diff = mock.Mock(returncode=0, stdout='diff --git a/x b/x\n', stderr='')
        calls = [diff, hooks.subprocess.TimeoutExpired('node', 1)]
        with mock.patch.object(hooks.subprocess, 'run', side_effect=calls), \
                mock.patch.dict(hooks.os.environ, {}, clear=False), \
                mock.patch.object(hooks.sys, 'stderr', io.StringIO()) as err:
            hooks.os.environ.pop('LIWAN_SKIP_JEV', None)
            hooks.advisory_jev()
        self.assertIn('jev review skipped', err.getvalue())

    def test_jev_can_be_skipped(self):
        with mock.patch.dict(hooks.os.environ, {'LIWAN_SKIP_JEV': '1'}), \
                mock.patch.object(hooks.subprocess, 'run') as run:
            hooks.advisory_jev()
        run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
