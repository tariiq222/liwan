"""The path-to-stage map, the diff reader and the preview command."""
import contextlib
import io
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_scope

ALL = ci_scope.STAGES
REPO = Path(ci_scope.__file__).resolve().parents[1]
SHARED = ('static', 'control-plane', 'vendor-admin', 'image', 'e2e-mock', 'e2e-odoo', 'rtl-stories')
WEB = ('static', 'control-plane', 'image', 'e2e-mock', 'e2e-odoo', 'rtl-stories')


class StagesForTest(unittest.TestCase):
    def assert_stages(self, path, expected):
        with self.subTest(path=path):
            self.assertEqual(ci_scope.stages_for([path]), tuple(expected))

    def test_every_rule_selects_its_stages(self):
        for path in ('.github/workflows/ci.yml', '.github/actions/setup/action.yml', 'tools/ci_scope.py',
                     'tools/catalog_check.py', 'tools/upgrade_baseline.py', 'tools/upgrade_log_guard.py',
                     'deploy/ci/odoo.sh',
                     'deploy/odoo/Dockerfile', 'odoo-addons/liwan_pmo/models/project.py',
                     'odoo-addons/liwan_pmo/README.md', 'packages/contracts/src/task.ts', 'package.json',
                     'package-lock.json', '.npmrc', '.nvmrc', '.dockerignore'):
            self.assert_stages(path, ALL)
        self.assert_stages('tools/odoo_shards.py', ('static', 'odoo'))
        for path in ('tools/app_isolation.py', 'tools/arch_layers.json'):
            self.assert_stages(path, ('static', 'odoo-app-standalone', 'odoo-bridge'))
        for path in ('README.md', 'apps/web/PRODUCT.md', 'docs/testing.md', 'docs/reports/x.png',
                     'e2e/tests/smoke.e2e.ts', 'e2e.config.ts', '.gitignore',
                     '.claude/settings.json', '.claude/agents/odoo-reviewer.md',
                     '.claude/scripts/session-start.sh'):
            self.assert_stages(path, ('static',))
        self.assert_stages('ruff.toml', ('static', 'ai-service'))
        for path in ('deploy/ci/static.sh', 'deploy/ci/lib/docs-static.sh'):
            self.assert_stages(path, ('static',))
        self.assert_stages('apps/web/app/pages/index.vue', WEB)
        self.assert_stages('apps/web/server/api/auth/login.post.ts', tuple(s for s in WEB if s != 'rtl-stories'))
        self.assert_stages('apps/vendor-admin/pages/index.vue', ('static', 'vendor-admin', 'image'))
        self.assert_stages('apps/control-plane/src/http.ts', ('static', 'control-plane'))
        self.assert_stages('apps/ai-service/src/app.py', ('static', 'ai-service', 'image'))
        for path in ('packages/ui/app/a.vue', 'packages/commercial-ui/app/a.vue',
                     'packages/commercial-contracts/src/a.ts'):
            self.assert_stages(path, SHARED)

    def test_listed_static_only_tools_select_static(self):
        for pattern in ci_scope.STATIC_ONLY_TOOLS:
            self.assert_stages(pattern.replace('*', 'x'), ('static',))
        self.assert_stages('tools/test_ci_scope.py', ('static',))

    def test_tools_that_steps_or_apps_run_select_all_thirteen(self):
        for path in ('tools/liwan_cli/module_closure.py', 'tools/liwan_cli/managed_policy.py',
                     'tools/shared_saas_lifecycle/run.py', 'tools/shared_saas_lifecycle/test_run.py',
                     'tools/brand_new_tool.py', 'tools/vendor_admin_local_check.mjs'):
            self.assert_stages(path, ALL)
            self.assertEqual(ci_scope.matching_rule(path)[0], ci_scope.UNMAPPED)

    def test_root_only_patterns_do_not_match_nested_files(self):
        self.assert_stages('apps/web/package.json', WEB)
        self.assert_stages('apps/web/.npmrc', WEB)
        self.assert_stages('apps/web/.gitignore', WEB)

    def test_unmapped_path_runs_all_thirteen(self):
        for path in ('plans/roadmap.txt', 'scripts/verify.py', 'packages/new-pkg/a.ts',
                     'something-new.cfg'):
            self.assert_stages(path, ALL)
            self.assertEqual(ci_scope.matching_rule(path)[0], ci_scope.UNMAPPED)

    def test_mixed_paths_take_the_union_in_pipeline_order(self):
        self.assertEqual(ci_scope.stages_for(['apps/vendor-admin/a.ts', 'apps/ai-service/a.py', 'docs/a.md']),
                         ('static', 'ai-service', 'vendor-admin', 'image'))

    def test_one_full_path_makes_the_whole_change_full(self):
        self.assertEqual(ci_scope.stages_for(['docs/a.md', 'odoo-addons/x/a.py']), ALL)

    def test_empty_change_still_runs_static(self):
        self.assertEqual(ci_scope.stages_for([]), ('static',))

    def test_every_stage_has_a_script_and_a_workflow_job(self):
        root = Path(ci_scope.__file__).resolve().parents[1]
        scripts = sorted(path.stem for path in (root / 'deploy/ci').glob('*.sh') if path.stem != 'main-alert')
        self.assertEqual(scripts, sorted(ALL))
        workflow = (root / '.github/workflows/ci.yml').read_text()
        for stage in ALL:
            with self.subTest(stage=stage):
                self.assertIn("contains(fromJSON(needs.scope.outputs.stages), '" + stage + "')", workflow)

    def test_every_rule_names_only_real_stages(self):
        for pattern, stages in ci_scope.RULES:
            with self.subTest(pattern=pattern):
                self.assertLessEqual(set(stages), set(ALL))


class PullRequestTest(unittest.TestCase):
    """Deferred stages, the affected modules and the Odoo stages a pull request still runs."""
    DEFERRED = ('upgrade', 'restore-drill', 'image', 'e2e-odoo')
    ODOO = ('odoo', 'odoo-app-standalone', 'odoo-bridge')
    RELEASE = ['base_mod', 'app_a', 'app_b', 'a_b', 'solo']
    DEPENDS = {'base_mod': [], 'app_a': ['base_mod'], 'app_b': ['base_mod'], 'a_b': ['app_a', 'app_b'], 'solo': ['mail']}

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.addons = Path(tmp.name)
        for module, depends in self.DEPENDS.items():
            (self.addons / module).mkdir()
            (self.addons / module / '__manifest__.py').write_text(repr({'depends': depends}))

    def affected(self, *paths):
        return ci_scope.affected_modules(list(paths), self.RELEASE, self.addons)

    def test_push_selection_is_unchanged_and_keeps_the_deferred_stages(self):
        self.assertEqual(ci_scope.stages_for(['odoo-addons/liwan_hr/models/a.py']), ALL)

    def test_the_deferred_stages_never_run_on_a_pull_request(self):
        for paths in (['odoo-addons/liwan_crm/models/a.py'], ['.github/workflows/ci.yml'], ['deploy/ci/odoo.sh'],
                      ['apps/web/app/a.vue'], ['apps/ai-service/a.py'], ['plans/unmapped.txt']):
            with self.subTest(paths=paths):
                stages = ci_scope.pull_request_stages(paths, self.affected(*paths))
                self.assertFalse(set(stages) & set(self.DEFERRED))

    def test_a_pull_request_keeps_the_other_stages_of_a_path(self):
        stages = ci_scope.pull_request_stages(['apps/web/app/a.vue'], None)
        self.assertEqual(stages, ('static', 'control-plane', 'e2e-mock', 'rtl-stories'))

    def test_a_change_reaching_the_journey_surfaces_keeps_e2e_odoo(self):
        for path in ('apps/web/e2e/real-odoo-acceptance.spec.ts', 'apps/web/e2e/real-odoo-services.spec.ts',
                     'deploy/ci/e2e-odoo.sh', 'tools/e2e_seed.py', 'apps/web/server/api/auth/login.post.ts',
                     'apps/web/app/middleware/auth.global.ts', 'apps/web/app/pages/login.vue',
                     'apps/web/app/pages/projects/[id]/index.vue', 'apps/web/app/pages/tasks/[id].vue',
                     'apps/web/app/pages/account/index.vue',
                     'apps/web/app/pages/hr/leave/index.vue', 'apps/web/app/pages/settings/team/users/index.vue',
                     'apps/web/app/components/pmo/projects/tabs/Workspace.vue',
                     'apps/web/app/components/access/roles/RoleForm.vue',
                     'apps/web/app/composables/useTasks.ts', 'apps/web/app/composables/useProjectFinance.ts',
                     'apps/web/app/composables/useAdminUsers.ts', 'apps/web/app/composables/useHrEmployees.ts',
                     'apps/web/app/composables/useBus.ts', 'apps/web/app/composables/taskSort.ts',
                     'odoo-addons/liwan_pmo/models/project_tools.py', 'odoo-addons/liwan_chat/models/chat_service.py',
                     'odoo-addons/liwan_hr/models/hr_employee.py', 'odoo-addons/liwan_api/controllers/main.py',
                     'odoo-addons/liwan_core/models/access.py'):
            with self.subTest(path=path):
                self.assertTrue(ci_scope.keeps_e2e_odoo([path]))
                stages = ci_scope.pull_request_stages([path], self.affected(path))
                self.assertIn('e2e-odoo', stages)
                self.assertFalse(set(stages) & set(self.DEFERRED) - {'e2e-odoo'})

    def test_every_other_change_still_defers_e2e_odoo(self):
        for path in ('apps/web/app/pages/crm/index.vue', 'apps/web/app/pages/documents/index.vue',
                     'apps/web/app/components/inbox/List.vue', 'apps/web/app/composables/useDocuments.ts',
                     'apps/web/app/composables/useHrPayslips.ts', 'apps/web/app/composables/useMeetings.ts',
                     'apps/web/app/composables/useNotifications.ts', 'odoo-addons/liwan_notify/models/a.py',
                     'apps/web/app/pages/meetings.vue', 'odoo-addons/liwan_crm/models/a.py',
                     'odoo-addons/liwan_finance/models/a.py', 'odoo-addons/liwan_hr_ai/models/a.py',
                     'apps/ai-service/a.py', '.github/workflows/ci.yml', 'deploy/ci/odoo.sh',
                     'tools/ci_scope.py', 'docs/testing.md', 'docs/verification/a.md', 'plans/unmapped.txt'):
            with self.subTest(path=path):
                self.assertFalse(ci_scope.keeps_e2e_odoo([path]))
                self.assertNotIn('e2e-odoo', ci_scope.pull_request_stages([path], self.affected(path)))

    def test_a_documentation_or_tooling_change_never_runs_the_browser_stage(self):
        paths = ['docs/testing.md', 'REVIEW.md', 'tools/test_ci_scope.py', 'tools/ci_scope.py', 'tools/wt.py']
        self.assertNotIn('e2e-odoo', ci_scope.pull_request_stages(paths, self.affected(*paths)))

    def test_every_e2e_odoo_trigger_still_names_a_path_in_the_tree(self):
        root = Path(ci_scope.__file__).resolve().parents[1]
        for pattern in ci_scope.E2E_ODOO_TRIGGERS:
            with self.subTest(pattern=pattern):
                # A renamed page or composable would silently stop selecting the stage.
                self.assertTrue(any(root.glob(pattern)), f'{pattern} names no path in the tree')

    def test_a_changed_addon_reaches_its_dependents_transitively(self):
        self.assertEqual(self.affected('odoo-addons/base_mod/models/a.py'), ['a_b', 'app_a', 'app_b', 'base_mod'])
        self.assertEqual(self.affected('odoo-addons/app_a/README.md'), ['a_b', 'app_a'])
        self.assertEqual(self.affected('odoo-addons/solo/a.py', 'odoo-addons/app_b/b.py'), ['a_b', 'app_b', 'solo'])

    def test_a_path_that_feeds_an_odoo_stage_outside_an_addon_affects_every_module(self):
        for path in ('.github/workflows/ci.yml', 'deploy/ci/odoo.sh', 'tools/catalog_check.py', 'tools/odoo_shards.py',
                     'tools/app_isolation.py', 'tools/arch_layers.json', 'packages/contracts/src/a.ts', 'package.json',
                     'odoo-addons/README.txt', 'plans/unmapped.txt'):
            with self.subTest(path=path):
                self.assertIsNone(self.affected('odoo-addons/app_a/a.py', path))

    def test_a_path_no_odoo_stage_reads_does_not_widen_the_set(self):
        self.assertEqual(self.affected('odoo-addons/app_a/a.py', 'apps/web/app/a.vue', 'docs/a.md'), ['a_b', 'app_a'])
        self.assertEqual(self.affected('docs/a.md', 'apps/web/app/a.vue'), [])

    def test_every_odoo_stage_runs_when_every_module_is_affected(self):
        stages = ci_scope.pull_request_stages(['.github/workflows/ci.yml'], None)
        self.assertEqual(stages, tuple(s for s in ALL if s not in self.DEFERRED))

    def test_a_change_without_odoo_work_selects_no_odoo_stage(self):
        stages = ci_scope.pull_request_stages(['odoo-addons/m/old.py'], [])
        self.assertFalse(set(stages) & set(self.ODOO))
        self.assertEqual(ci_scope.pull_request_stages(['docs/a.md'], []), ('static',))

    def test_an_application_change_selects_the_application_and_its_bridges(self):
        stages = ci_scope.pull_request_stages(['odoo-addons/liwan_hr/a.py'], ['liwan_hr', 'liwan_hr_finance'])
        self.assertTrue(set(self.ODOO) <= set(stages))

    def test_an_addon_change_selects_only_static_and_the_odoo_stages(self):
        stages = ci_scope.pull_request_stages(['odoo-addons/liwan_crm/a.py'], ['liwan_crm', 'liwan_crm_ai'])
        self.assertEqual(set(stages), {'static', *self.ODOO})
        web = ci_scope.pull_request_stages(['odoo-addons/liwan_crm/a.py', 'apps/web/app/a.vue'], ['liwan_crm'])
        self.assertIn('e2e-mock', web)

    def test_an_odoo_only_change_never_selects_a_ui_stage(self):
        ui = {'e2e-mock', 'rtl-stories', 'vendor-admin', 'control-plane', 'ai-service'}
        for paths in (['odoo-addons/liwan_crm/models/a.py'],
                      ['odoo-addons/liwan_crm/models/a.py', 'odoo-addons/liwan_crm/README.md', 'docs/a.md', 'tools/test_x.py'],
                      ['odoo-addons/liwan_hr/models/a.py', 'odoo-addons/liwan_hr_finance/views/a.xml']):
            with self.subTest(paths=paths):
                stages = ci_scope.pull_request_stages(paths, ['liwan_hr', 'liwan_hr_finance'])
                self.assertFalse(set(stages) & ui)

    def test_a_server_only_web_change_skips_the_storybook_stage(self):
        stages = ci_scope.pull_request_stages(['apps/web/server/api/v1/a.ts'], None)
        self.assertNotIn('rtl-stories', stages)
        self.assertIn('e2e-mock', stages)
        self.assertIn('rtl-stories', ci_scope.pull_request_stages(['apps/web/server/api/v1/a.ts', 'apps/web/app/a.vue'], None))

    def test_a_change_selection_without_pull_request_still_covers_every_stage_an_addon_reaches(self):
        self.assertEqual(ci_scope.stages_for(['apps/web/server/api/v1/a.ts', 'odoo-addons/liwan_hr/a.py', 'packages/contracts/a.ts']), ALL)

    def test_a_bridge_only_change_selects_no_application_run(self):
        stages = ci_scope.pull_request_stages(['odoo-addons/liwan_hr_finance/a.py'], ['liwan_hr_finance'])
        self.assertIn('odoo', stages)
        self.assertIn('odoo-bridge', stages)
        self.assertNotIn('odoo-app-standalone', stages)

    def test_a_shared_service_change_selects_no_isolation_run_without_dependents(self):
        stages = ci_scope.pull_request_stages(['odoo-addons/x/a.py'], ['liwan_notify'])
        self.assertIn('odoo', stages)
        self.assertNotIn('odoo-app-standalone', stages)
        self.assertNotIn('odoo-bridge', stages)


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
        self.assertIn('3 of 13 stages: static, ai-service, image', text)

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
        self.assertIn('1 of 13 stages: static', out.getvalue())
        self.assertNotIn('odoo-addons', out.getvalue())

    def test_stages_mode_prints_only_the_json_array(self):
        self.write('apps/ai-service/a.py', 'x\n')
        head = self.commit()
        self.assertEqual(self.run_main('--base', self.base, '--commit', head, '--stages'),
                         '["static", "ai-service", "image"]\n')

    def test_full_selects_every_stage_without_a_base(self):
        self.assertEqual(json.loads(self.run_main('--full', '--stages')), list(ALL))
        self.assertIn('13 of 13 stages', self.run_main('--full'))

    def test_pull_request_defers_stages_and_narrows_the_odoo_stages(self):
        self.write('odoo-addons/liwan_hr/a.py', 'x\n')
        head = self.commit()
        stages = json.loads(self.run_main('--base', self.base, '--commit', head, '--pull-request', '--stages'))
        self.assertNotIn('upgrade', stages)
        self.assertNotIn('image', stages)
        self.assertIn('odoo-app-standalone', stages)
        modules = self.run_main('--base', self.base, '--commit', head, '--pull-request', '--modules').strip().split(',')
        self.assertIn('liwan_hr', modules)
        self.assertIn('liwan_hr_finance', modules)
        self.assertNotIn('liwan_pmo', modules)
        self.assertIn('affected modules: ', self.run_main('--base', self.base, '--commit', head, '--pull-request'))

    def test_pull_request_modules_are_empty_when_every_module_is_affected(self):
        self.write('.github/workflows/ci.yml', 'x\n')
        head = self.commit()
        self.assertEqual(self.run_main('--base', self.base, '--commit', head, '--pull-request', '--modules'), '\n')
        self.assertIn('affected modules: all', self.run_main('--base', self.base, '--commit', head, '--pull-request'))

    def test_without_pull_request_the_push_selection_stays_full(self):
        self.write('odoo-addons/liwan_hr/a.py', 'x\n')
        head = self.commit()
        self.assertEqual(json.loads(self.run_main('--base', self.base, '--commit', head, '--stages')), list(ALL))

    def test_pull_request_flag_conflicts_are_refused(self):
        for argv in (['--full', '--pull-request'], ['--base', 'main', '--modules']):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                ci_scope.main(argv)

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


    def test_every_real_odoo_spec_is_either_run_or_named_as_excluded(self):
        """A new `E2E_REAL_ODOO` spec cannot be silently skipped.

        The stage runs `REAL_ODOO_SPECS` and records the ones it cannot yet run in `EXCLUDED_REAL_ODOO_SPECS`. Both are
        read from the script itself, so the two lists cannot drift from it, and a spec guarded by the flag but present in
        neither list fails here instead of never running anywhere.
        """
        script = (REPO / 'deploy' / 'ci' / 'e2e-odoo.sh').read_text(encoding='utf-8')

        def listed(name):
            block = re.search(rf'^{name}=\((.*?)^\)', script, re.S | re.M)
            self.assertIsNotNone(block, f'{name} is missing from deploy/ci/e2e-odoo.sh')
            return set(re.findall(r'^\s*(e2e/\S+\.spec\.ts)\s*$', block.group(1), re.M))

        run, excluded = listed('REAL_ODOO_SPECS'), listed('EXCLUDED_REAL_ODOO_SPECS')
        self.assertTrue(run, 'REAL_ODOO_SPECS must run at least one journey')
        self.assertEqual(run & excluded, set(), 'a spec cannot be both run and excluded')
        guarded = {
            path.name for path in (REPO / 'apps' / 'web' / 'e2e').glob('*.spec.ts')
            if 'E2E_REAL_ODOO' in path.read_text(encoding='utf-8')
        }
        self.assertEqual(guarded - {Path(p).name for p in run | excluded}, set(),
                         'every spec guarded by E2E_REAL_ODOO must be run or named as excluded in the stage')


if __name__ == '__main__':
    unittest.main()
