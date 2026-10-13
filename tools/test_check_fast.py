# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest

from check_fast import plan


def names(changed):
    return [name for name, _ in plan(changed, 'main')]


class TestCheckFast(unittest.TestCase):
    def test_policy_checks_always_run(self):
        base = names([])
        for name in ('secret_guard', 'docs_policy', 'arch_policy', 'git_policy', 'ui_policy'):
            self.assertIn(name, base)
        self.assertEqual(len(base), 6)

    def test_addon_change_adds_ruff_only(self):
        self.assertEqual(set(names(['odoo-addons/nasq_hr/a.py'])) - set(names([])), {'ruff'})

    def test_tools_change_adds_unittest(self):
        self.assertIn('tools_unittest', names(['tools/x.py']))

    def test_web_change_adds_web_checks_not_contracts(self):
        extra = set(names(['apps/web/app/a.vue'])) - set(names([]))
        self.assertEqual(extra, {'web_test_changed', 'web_typecheck'})

    def test_contracts_change_adds_contracts_and_web(self):
        extra = set(names(['packages/contracts/src/hr/a.ts'])) - set(names([]))
        self.assertEqual(extra, {'contracts_test', 'web_test_changed', 'web_typecheck'})

    def test_base_is_passed_to_diff_policies(self):
        steps = dict(plan([], 'origin/main'))
        self.assertEqual(steps['arch_policy'][-2:], ['--base', 'origin/main'])


if __name__ == '__main__':
    unittest.main()
