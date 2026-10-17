"""The path-to-stage map, the diff reader and the preview command."""
import contextlib
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_scope

ALL = ci_scope.STAGES
SHARED = ('static', 'control-plane', 'vendor-admin', 'e2e-mock', 'rtl-stories')


class StagesForTest(unittest.TestCase):
    def assert_stages(self, path, expected):
        with self.subTest(path=path):
            self.assertEqual(ci_scope.stages_for([path]), tuple(expected))

    def test_every_rule_selects_its_stages(self):
        for path in ('.github/workflows/ci.yml', '.github/actions/setup/action.yml', 'tools/ci_scope.py',
                     'tools/catalog_check.py', 'tools/upgrade_baseline.py', 'tools/upgrade_log_guard.py',
                     'deploy/ci/static.sh',
                     'deploy/odoo/Dockerfile', 'odoo-addons/webvue_pmo/models/project.py',
                     'odoo-addons/webvue_pmo/README.md', 'packages/contracts/src/task.ts', 'package.json',
                     'package-lock.json', '.npmrc', '.nvmrc', '.dockerignore'):
            self.assert_stages(path, ALL)
        for path in ('README.md', 'apps/web/PRODUCT.md', 'docs/testing.md', 'docs/reports/x.png',
                     'e2e/tests/smoke.e2e.ts', 'e2e.config.ts'):
            self.assert_stages(path, ('static',))
        self.assert_stages('ruff.toml', ('static', 'ai-service'))
        self.assert_stages('apps/web/app/pages/index.vue', ('static', 'control-plane', 'e2e-mock', 'rtl-stories'))
        self.assert_stages('apps/vendor-admin/pages/index.vue', ('static', 'vendor-admin'))
        self.assert_stages('apps/control-plane/src/http.ts', ('static', 'control-plane'))
        self.assert_stages('apps/ai-service/src/app.py', ('static', 'ai-service'))
        for path in ('packages/ui/app/a.vue', 'packages/commercial-ui/app/a.vue',
                     'packages/commercial-contracts/src/a.ts'):
            self.assert_stages(path, SHARED)

    def test_listed_static_only_tools_select_static(self):
        for pattern in ci_scope.STATIC_ONLY_TOOLS:
            self.assert_stages(pattern.replace('*', 'x'), ('static',))
        self.assert_stages('tools/test_ci_scope.py', ('static',))

    def test_tools_that_steps_or_apps_run_select_all_twelve(self):
        for path in ('tools/webvue_cli/module_closure.py', 'tools/webvue_cli/managed_policy.py',
                     'tools/shared_saas_lifecycle/run.py', 'tools/shared_saas_lifecycle/test_run.py',
                     'tools/brand_new_tool.py', 'tools/vendor_admin_local_check.mjs'):
            self.assert_stages(path, ALL)
            self.assertEqual(ci_scope.matching_rule(path)[0], ci_scope.UNMAPPED)

    def test_root_only_patterns_do_not_match_nested_files(self):
        self.assert_stages('apps/web/package.json', ('static', 'control-plane', 'e2e-mock', 'rtl-stories'))
        self.assert_stages('apps/web/.npmrc', ('static', 'control-plane', 'e2e-mock', 'rtl-stories'))

    def test_unmapped_path_runs_all_twelve(self):
        for path in ('plans/roadmap.txt', 'scripts/verify.py', 'packages/new-pkg/a.ts',
                     'something-new.cfg'):
            self.assert_stages(path, ALL)
            self.assertEqual(ci_scope.matching_rule(path)[0], ci_scope.UNMAPPED)

    def test_mixed_paths_take_the_union_in_pipeline_order(self):
        self.assertEqual(ci_scope.stages_for(['apps/vendor-admin/a.ts', 'apps/ai-service/a.py', 'docs/a.md']),
                         ('static', 'ai-service', 'vendor-admin'))

    def test_one_full_path_makes_the_whole_change_full(self):
        self.assertEqual(ci_scope.stages_for(['docs/a.md', 'odoo-addons/x/a.py']), ALL)

    def test_empty_change_still_runs_static(self):
        self.assertEqual(ci_scope.stages_for([]), ('static',))

    def test_every_stage_has_a_script_and_a_workflow_job(self):
        root = Path(ci_scope.__file__).resolve().parents[1]
        scripts = sorted(path.stem for path in (root / 'deploy/ci').glob('*.sh'))
        self.assertEqual(scripts, sorted(ALL))
        workflow = (root / '.github/workflows/ci.yml').read_text()
        for stage in ALL:
            with self.subTest(stage=stage):
                self.assertIn("contains(fromJSON(needs.scope.outputs.stages), '" + stage + "')", workflow)

    def test_every_rule_names_only_real_stages(self):
        for pattern, stages in ci_scope.RULES:
            with self.subTest(pattern=pattern):
                self.assertLessEqual(set(stages), set(ALL))


class ChangedPathsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = Path(self.tmp.name)
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Scope test')
        self.git('config', 'user.email', 'scope@example.invalid')
        self.write('docs/keep.md', 'a\n' * 20)
        self.write('odoo-addons/m/old.py', 'b\n' * 20)
        self.write('gone.txt', 'c\n')
        self.commit()
        self.base = self.git('rev-parse', 'HEAD')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()

    def write(self, name, text):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)

    def commit(self):
        self.git('add', '-A')
        self.git('commit', '-qm', 'change')
        return self.git('rev-parse', 'HEAD')

    def test_lists_adds_edits_and_deletions(self):
        self.write('docs/keep.md', 'changed\n')
        self.write('new.txt', 'x\n')
        (self.repo / 'gone.txt').unlink()
        head = self.commit()
        self.assertEqual(ci_scope.changed_paths(self.repo, self.base, head), ['docs/keep.md', 'gone.txt', 'new.txt'])

    def test_rename_across_areas_lists_both_sides(self):
        (self.repo / 'odoo-addons/m/old.py').rename(self.repo / 'docs/moved.py')
        head = self.commit()
        paths = ci_scope.changed_paths(self.repo, self.base, head)
        self.assertEqual(paths, ['docs/moved.py', 'odoo-addons/m/old.py'])
        self.assertEqual(ci_scope.stages_for(paths), ALL)

    def test_empty_diff(self):
        self.assertEqual(ci_scope.changed_paths(self.repo, self.base, self.base), [])

    def test_unknown_ref_is_an_explicit_error(self):
        with self.assertRaisesRegex(ci_scope.ScopeError, 'cannot list'):
            ci_scope.changed_paths(self.repo, 'no-such-ref', self.base)

    def test_preview_prints_the_matched_rule_and_the_selection(self):
        self.write('docs/keep.md', 'changed\n')
        self.write('apps/ai-service/a.py', 'x\n')
        head = self.commit()
        out = io.StringIO()
        previous = Path.cwd()
        try:
            os.chdir(self.repo)
            with contextlib.redirect_stdout(out):
                self.assertEqual(ci_scope.main(['--base', self.base, '--commit', head]), 0)
        finally:
            os.chdir(previous)
        text = out.getvalue()
        self.assertIn('docs/keep.md  <-  *.md', text)
        self.assertIn('apps/ai-service/a.py  <-  apps/ai-service/*', text)
        self.assertIn('2 of 12 stages: static, ai-service', text)

    def test_preview_ignores_changes_base_made_after_the_branch_left_it(self):
        self.git('switch', '-qc', 'task')
        self.write('docs/keep.md', 'task\n')
        task = self.commit()
        self.git('switch', '-q', 'main')
        self.write('odoo-addons/m/old.py', 'main moved on\n')
        main = self.commit()
        out = io.StringIO()
        previous = Path.cwd()
        try:
            os.chdir(self.repo)
            with contextlib.redirect_stdout(out):
                self.assertEqual(ci_scope.main(['--base', main, '--commit', task]), 0)
        finally:
            os.chdir(previous)
        self.assertIn('1 of 12 stages: static', out.getvalue())
        self.assertNotIn('odoo-addons', out.getvalue())

    def test_stages_mode_prints_only_the_json_array(self):
        self.write('apps/ai-service/a.py', 'x\n')
        head = self.commit()
        self.assertEqual(self.run_main('--base', self.base, '--commit', head, '--stages'),
                         '["static", "ai-service"]\n')

    def test_full_selects_every_stage_without_a_base(self):
        self.assertEqual(json.loads(self.run_main('--full', '--stages')), list(ALL))
        self.assertIn('12 of 12 stages', self.run_main('--full'))

    def test_base_is_required_without_full(self):
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            ci_scope.main([])

    def run_main(self, *argv):
        out = io.StringIO()
        previous = Path.cwd()
        try:
            os.chdir(self.repo)
            with contextlib.redirect_stdout(out):
                self.assertEqual(ci_scope.main(list(argv)), 0)
        finally:
            os.chdir(previous)
        return out.getvalue()


if __name__ == '__main__':
    unittest.main()
