# Part of Odoo. See LICENSE file for full copyright and licensing details.
import unittest
from unittest import mock

import check_fast
from check_fast import plan


def names(changed):
    return [name for name, _ in plan(changed, 'main')]


WEB_EXTRA = {'ui_inventory', 'ui_catalog', 'ui_templates', 'web_test_changed', 'web_typecheck'}


def extra(changed):
    return set(names(changed)) - set(names([]))


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
        self.assertEqual(extra, WEB_EXTRA)

    def test_ui_layer_change_adds_layer_tests_and_web_checks(self):
        self.assertEqual(extra(['packages/ui/app/a.vue']), {'ui_layer_test'} | WEB_EXTRA)
        self.assertEqual(dict(plan(['packages/ui/app/a.vue'], 'main'))['ui_layer_test'], ['npm', '-w', 'packages/ui', 'run', 'test'])
        self.assertNotIn('ui_layer_test', extra(['apps/web/app/a.vue']))

    def test_contracts_change_adds_contracts_and_web(self):
        extra = set(names(['packages/contracts/src/hr/a.ts'])) - set(names([]))
        self.assertEqual(extra, {'contracts_test'} | WEB_EXTRA)

    def test_base_is_passed_to_diff_policies(self):
        steps = dict(plan([], 'origin/main'))
        self.assertEqual(steps['arch_policy'][-2:], ['--base', 'origin/main'])

    def test_web_adds_ui_generated_artifact_checks_with_exact_commands(self):
        steps = dict(plan(['apps/web/app/a.vue'], 'main'))
        self.assertEqual(steps['ui_inventory'], ['python3', '-B', 'tools/ui_inventory.py', '--check'])
        self.assertEqual(steps['ui_catalog'], ['node', 'tools/ui_catalog.mjs', '--check'])
        self.assertEqual(steps['ui_templates'], ['node', 'tools/ui_templates.mjs'])

    def test_mjs_tool_change_runs_the_e2e_runner_test(self):
        self.assertIn('e2e_isolated_test', extra(['tools/ui_catalog.mjs']))
        self.assertNotIn('e2e_isolated_test', extra(['tools/x.py']))
        self.assertEqual(dict(plan(['tools/e2e_isolated.mjs'], 'main'))['e2e_isolated_test'], ['node', '--test', 'tools/test_e2e_isolated.mjs'])

    def test_deploy_change_runs_catalog_and_deploy_tests(self):
        self.assertEqual(extra(['deploy/backup.py']), {'catalog_check', 'deploy_unittest'})
        steps = dict(plan(['deploy/backup.py'], 'main'))
        self.assertEqual(steps['catalog_check'], ['python3', '-B', 'tools/catalog_check.py'])
        self.assertEqual(steps['deploy_unittest'][-4:], ['-s', 'deploy', '-p', 'test_*.py'])

    def test_commercial_contracts_change_runs_its_tests(self):
        self.assertEqual(extra(['packages/commercial-contracts/src/a.ts']), {'commercial_contracts_test'})

    def test_root_manifests_and_ci_run_the_full_test(self):
        for path in ('package.json', 'package-lock.json', '.woodpecker.yml'):
            self.assertEqual(extra([path]), {'npm_test_full'})
            self.assertEqual(dict(plan([path], 'main'))['npm_test_full'], ['npm', 'test'])
        self.assertNotIn('npm_test_full', extra(['apps/web/package.json']))

    def test_no_control_plane_steps(self):
        every = names(['apps/control-plane/a.ts', 'deploy/a.py', 'package.json', 'apps/web/a.vue', 'tools/a.mjs'])
        self.assertFalse([name for name in every if 'control' in name])

    def test_missing_tool_returns_127_instead_of_raising(self):
        with mock.patch.object(check_fast.subprocess, 'run', side_effect=FileNotFoundError('ruff')):
            name, code, _, output = check_fast.run_step(('ruff', ['ruff', 'check']))
        self.assertEqual((name, code), ('ruff', 127))
        self.assertIn('tool not found: ruff', output)

    def test_unknown_base_exits_2(self):
        with mock.patch.object(check_fast, 'changed_paths', side_effect=check_fast.BaseError('unknown base')):
            self.assertEqual(check_fast.main(['--base', 'nope', '--dry-run']), 2)


if __name__ == '__main__':
    unittest.main()
