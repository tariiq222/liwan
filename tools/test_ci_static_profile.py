"""Exercise the static profile selector against committed Git diffs."""
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_static_profile as selector  # noqa: E402

SCRIPT = Path(__file__).with_name('ci_static_profile.py')
ROOT = Path(__file__).resolve().parents[1]
# The workspaces of the real repository: the selector computes the dependents from their package.json files.
MANIFESTS = ('package.json', *(f'{path}/package.json' for path in (
    'apps/web', 'apps/vendor-admin', 'apps/control-plane', 'packages/contracts', 'packages/ui',
    'packages/commercial-ui', 'packages/commercial-contracts')))
FULL = {'policies': ['gates', 'deploy-suites'], 'tests': ['repo', 'tools', *selector.TESTED_WORKSPACES], 'types': ['types']}
ALWAYS = {'policies': ['gates'], 'tests': ['repo', 'tools'], 'types': []}


class GitRepoCase(unittest.TestCase):
    """A temporary Git repository with the real workspace manifests, and a helper to run the selector on its commits."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repo = Path(directory.name)
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'CI profile test')
        self.git('config', 'user.email', 'ci@example.invalid')
        self.git('config', 'core.fileMode', 'true')
        self.write('docs/testing.md', b'original\n')
        self.write('apps/web/example.ts', b'export {}\n')
        for manifest in MANIFESTS:
            self.write(manifest, (ROOT / manifest).read_bytes())
        self.commit()
        self.base = self.git('rev-parse', 'HEAD').strip()

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo, text=True)

    def write(self, path, contents):
        file = self.repo / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(contents)
        return file

    def commit(self):
        self.git('add', '--all')
        self.git('commit', '-qm', 'change')

    def select(self, part, base=None):
        result = subprocess.run([sys.executable, '-B', str(SCRIPT), '--base', base or self.base, '--part', part],
                                cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = dict(line.split('=', 1) for line in result.stdout.splitlines())
        return values['mode'], values['units'].split(), values['playwright']

    def profile(self, base=None):
        """`docs` for a proven documentation-only diff, otherwise `full` (every part still runs something)."""
        mode, units, _ = self.select('policies', base)
        return 'docs' if mode == 'docs' else 'full'

    def units(self, *paths, base=None):
        """The units each part runs after one commit that writes `paths`."""
        for path in paths:
            self.write(path, b'changed\n')
        self.commit()
        return {part: self.select(part, base)[1] for part in FULL}

    def expected(self, **extra):
        return {part: [unit for unit in FULL[part] if unit in ALWAYS[part] or unit in extra.get(part, [])] for part in FULL}


class StaticProfileTest(GitRepoCase):
    def test_prose_additions_and_edits_use_docs_profile(self):
        self.write('docs/testing.md', b'updated\n')
        self.write('docs/guides/a file.md', b'# Guide\n')
        self.commit()
        self.assertEqual(self.profile(), 'docs')

    def test_root_instruction_documents_use_docs_profile(self):
        for path in ('AGENTS.md', 'CLAUDE.md', 'DESIGN.md', 'README.md', 'REVIEW.md'):
            with self.subTest(path=path):
                self.git('checkout', '--quiet', '--detach', self.base)
                self.write(path, b'# Rules\n')
                self.write('docs/testing.md', b'updated\n')
                self.commit()
                self.assertEqual(self.profile(), 'docs')

    def test_nested_instruction_document_uses_full_profile(self):
        self.write('apps/web/AGENTS.md', b'# Web rules\n')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_mixed_change_including_application_code_uses_full_profile(self):
        self.write('docs/testing.md', b'updated\n')
        self.write('apps/web/example.ts', b'export const value = 1\n')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_unrecognized_and_machine_consumed_paths_use_full_profile(self):
        for path in ('unknown.md', 'package-lock.json', '.github/workflows/ci.yml',
                     'docs/data.json', 'docs/design-system/components.md', 'docs/api/README.md'):
            with self.subTest(path=path):
                self.git('checkout', '--quiet', '--detach', self.base)
                self.write('docs/testing.md', b'updated\n')
                self.write(path, b'new\n')
                self.commit()
                self.assertEqual(self.profile(), 'full')

    def test_code_renamed_to_markdown_uses_full_profile(self):
        self.git('mv', 'apps/web/example.ts', 'docs/renamed.md')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_deletion_uses_full_profile(self):
        self.git('rm', 'docs/testing.md')
        self.commit()
        self.assertEqual(self.profile(), 'full')

    def test_symlink_executable_and_binary_are_not_prose(self):
        self.write('docs/testing.md', b'updated\n')
        for kind in ('symlink', 'executable', 'binary', 'late-binary', 'invalid-utf8'):
            with self.subTest(kind=kind):
                path = self.repo / 'docs/example.md'
                if kind == 'symlink':
                    path.symlink_to('testing.md')
                elif kind == 'executable':
                    self.write('docs/example.md', b'#!/bin/sh\n').chmod(0o755)
                elif kind == 'binary':
                    self.write('docs/example.md', b'abc\0xyz')
                elif kind == 'late-binary':
                    self.write('docs/example.md', b'a' * 9000 + b'\0xyz')
                else:
                    self.write('docs/example.md', b'not UTF-8: \xff\n')
                self.commit()
                self.assertEqual(self.profile(), 'full')
                self.git('checkout', '--quiet', '--detach', self.base)

    def test_empty_or_unreadable_diff_uses_full_profile(self):
        self.assertEqual(self.profile(), 'full')
        self.assertEqual(self.profile('no-such-ref'), 'full')
        self.assertEqual(self.select('policies', 'no-such-ref')[1], FULL['policies'])

    def test_documentation_only_diff_runs_only_the_light_checks_in_the_policies_part(self):
        self.write('docs/testing.md', b'updated\n')
        self.commit()
        self.assertEqual(self.select('policies'), ('docs', [], 'false'))
        self.assertEqual(self.select('tests'), ('skip', [], 'false'))
        self.assertEqual(self.select('types'), ('skip', [], 'false'))


class UnitSelectionTest(GitRepoCase):
    """The units a non-documentation diff runs in each part."""

    def test_a_gitignore_only_change_runs_the_always_units(self):
        self.assertEqual(self.units('.gitignore'), self.expected())

    def test_a_tools_script_runs_the_always_units(self):
        self.assertEqual(self.units('tools/example.py'), self.expected())

    def test_a_web_component_runs_the_web_tests_and_the_type_check(self):
        self.assertEqual(self.units('apps/web/app/components/Example.vue'),
                         self.expected(tests=['apps/web'], types=['types']))
        self.assertEqual(self.select('tests'), ('run', ['repo', 'tools', 'apps/web'], 'true'))

    def test_a_shared_ui_file_runs_the_workspaces_that_depend_on_it(self):
        self.assertEqual(self.units('packages/ui/app/example.ts'),
                         self.expected(tests=['packages/ui', 'packages/commercial-ui', 'apps/web', 'apps/vendor-admin'],
                                       types=['types']))

    def test_contracts_reach_the_web_tests_but_not_vendor_admin(self):
        self.assertEqual(self.units('packages/contracts/src/example.ts'),
                         self.expected(tests=['packages/contracts', 'apps/web'], types=['types']))

    def test_vendor_admin_runs_only_its_own_tests_and_no_browser(self):
        self.assertEqual(self.units('apps/vendor-admin/app/example.vue'), self.expected(tests=['apps/vendor-admin']))
        self.assertEqual(self.select('tests')[2], 'false')

    def test_an_addon_model_file_runs_only_the_always_units(self):
        self.assertEqual(self.units('odoo-addons/liwan_tasks/models/example.py'), self.expected())

    def test_an_addon_manifest_runs_the_deploy_suites(self):
        self.assertEqual(self.units('odoo-addons/liwan_tasks/__manifest__.py'), self.expected(policies=['deploy-suites']))

    def test_addons_a_workspace_test_reads_run_that_workspace_only(self):
        self.assertEqual(self.units('odoo-addons/liwan_api/models/example.py'), self.expected(tests=['packages/contracts']))

    def test_a_markdown_edit_under_docs_operations_is_not_documentation_only(self):
        self.write('docs/operations/odoo-sizing.md', b'updated\n')
        self.commit()
        self.assertEqual(self.select('policies'), ('run', ['gates', 'deploy-suites'], 'false'))

    def test_a_liwan_cli_change_runs_the_deploy_suites(self):
        self.assertEqual(self.units('tools/liwan_cli/operator.py'), self.expected(policies=['deploy-suites']))

    def test_a_deploy_file_runs_the_deploy_suites_only(self):
        self.assertEqual(self.units('deploy/example.py'), self.expected(policies=['deploy-suites']))

    def test_guard_modules_the_web_tests_import_run_the_web_tests_too(self):
        self.assertEqual(self.units('deploy/shared/guard.mjs'),
                         self.expected(policies=['deploy-suites'], tests=['apps/web'], types=['types']))

    def test_ci_machinery_and_dependency_files_run_every_unit(self):
        for path in ('.github/workflows/ci.yml', 'package.json', 'package-lock.json', 'deploy/ci/static.sh',
                     'tools/ci_static_profile.py', 'tools/test_slot.py', '.nvmrc'):
            with self.subTest(path=path):
                self.git('checkout', '--quiet', '--detach', self.base)
                self.assertEqual(self.units(path), FULL)

    def test_an_unmapped_path_runs_every_unit(self):
        for path in ('unknown.txt', 'apps/newapp/example.ts', 'packages/newpackage/example.ts'):
            with self.subTest(path=path):
                self.git('checkout', '--quiet', '--detach', self.base)
                self.assertEqual(self.units(path), FULL)

    def test_a_mixed_diff_runs_the_union(self):
        self.assertEqual(self.units('docs/testing.md', 'deploy/example.py', 'apps/web/app/Example.vue'),
                         self.expected(policies=['deploy-suites'], tests=['apps/web'], types=['types']))

    def test_a_deletion_is_selected_by_its_path(self):
        self.git('rm', '-q', 'apps/web/example.ts')
        self.commit()
        self.assertEqual({part: self.select(part)[1] for part in FULL},
                         self.expected(tests=['apps/web'], types=['types']))

    def test_an_empty_diff_or_an_unreadable_base_runs_every_unit(self):
        self.assertEqual({part: self.select(part)[1] for part in FULL}, FULL)
        self.assertEqual({part: self.select(part, 'no-such-ref')[1] for part in FULL}, FULL)

    def test_an_unreadable_workspace_manifest_runs_every_unit(self):
        self.write('apps/web/package.json', b'{')
        self.write('.gitignore', b'x\n')
        self.commit()
        self.assertEqual({part: self.select(part)[1] for part in FULL}, FULL)


class WorkspaceGraphTest(unittest.TestCase):
    def package(self, root, path, name, **dependencies):
        directory = Path(root, path)
        directory.mkdir(parents=True)
        (directory / 'package.json').write_text(json.dumps({'name': name, **dependencies}))

    def graph(self, build):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'package.json').write_text(json.dumps({'workspaces': ['apps/*', 'packages/*']}))
            build(directory)
            return selector.workspace_graph(Path(directory))

    def test_dependents_are_read_from_dependencies_dev_dependencies_and_peers(self):
        def build(root):
            self.package(root, 'packages/base', '@liwan/base')
            self.package(root, 'packages/mid', '@liwan/mid', dependencies={'@liwan/base': '1'})
            self.package(root, 'packages/dev', '@liwan/dev', devDependencies={'@liwan/mid': '1'})
            self.package(root, 'apps/peer', 'peer', peerDependencies={'@liwan/dev': '1', 'vue': '3'})
        graph = self.graph(build)
        self.assertEqual(graph['packages/mid'], {'packages/base'})
        self.assertEqual(graph['apps/peer'], {'packages/dev'})
        self.assertEqual(selector.reachable(graph, 'apps/peer'),
                         {'apps/peer', 'packages/dev', 'packages/mid', 'packages/base'})

    def test_a_dependency_on_an_unknown_workspace_is_an_error(self):
        def build(root):
            self.package(root, 'apps/lonely', 'lonely', dependencies={'@liwan/missing': '1'})
        with self.assertRaises(KeyError):
            self.graph(build)

    def test_the_real_workspaces_form_the_expected_graph(self):
        graph = selector.workspace_graph(ROOT)
        self.assertLessEqual({'packages/ui', 'packages/commercial-ui', 'packages/contracts', 'packages/commercial-contracts'},
                             selector.reachable(graph, 'apps/web'))
        self.assertNotIn('apps/web', selector.reachable(graph, 'apps/vendor-admin'))


class ScriptParityTest(unittest.TestCase):
    """The selector's units and the root package.json scripts cannot drift apart."""
    scripts = json.loads((ROOT / 'package.json').read_text())['scripts']

    def test_the_tested_workspaces_are_the_ones_the_workspaces_script_runs(self):
        run = re.findall(r'npm -w (\S+) run test(?: |$)', self.scripts['test:workspaces'])
        self.assertEqual(run, list(selector.TESTED_WORKSPACES))

    def test_npm_test_runs_every_unit_of_the_tests_part(self):
        for script in ('test:tools', 'test:repo', 'test:workspaces'):
            with self.subTest(script=script):
                self.assertIn(f'npm run {script}', self.scripts['test'])
        self.assertEqual(selector.UNITS_BY_PART['tests'], ('repo', 'tools', *selector.TESTED_WORKSPACES))

    def test_static_sh_accepts_exactly_the_selectors_fixed_units(self):
        script = (ROOT / 'deploy/ci/static.sh').read_text()
        accepted = re.search(r'(?m)^\s+((?:\w+:[\w-]+ \| )*\w+:[\w-]+)\) ;;$', script).group(1)
        pairs = {tuple(pair.split(':')) for pair in accepted.split(' | ')}
        fixed = {(part, unit) for part, units in selector.UNITS_BY_PART.items() for unit in units
                 if unit not in selector.TESTED_WORKSPACES}
        self.assertEqual(pairs, fixed)

    def test_every_unit_belongs_to_one_part(self):
        self.assertEqual(len(selector.ALL_UNITS), len(set(selector.ALL_UNITS)))
        self.assertTrue(set(selector.ALWAYS_UNITS) <= set(selector.ALL_UNITS))


class RuleCompletenessTest(unittest.TestCase):
    """The rules name every file the suites and workspace tests read outside their own tree (checked against the sources)."""
    graph = selector.workspace_graph(ROOT)

    def tracked(self, *prefixes):
        listing = subprocess.check_output(['git', 'ls-files', *prefixes], cwd=ROOT, text=True).split()
        return [ROOT / path for path in listing if path.endswith(('.py', '.mjs', '.ts')) and not path.startswith('deploy/ci/')]

    def tools_paths(self, files):
        """Repo paths of the tools modules the files import or run (`tools.x`, `tools/x`, `from tools import x`)."""
        found = set()
        for file in files:
            text = file.read_text(encoding='utf-8', errors='ignore')
            names = set(re.findall(r'tools[./]([A-Za-z_][A-Za-z0-9_]*)', text))
            for imported in re.findall(r'from tools import ([\w, ]+)', text):
                names |= {name.strip() for name in imported.split(',')}
            for name in names:
                if (ROOT / 'tools' / name).is_dir():
                    found.add(f'tools/{name}/module.py')
                found |= {f'tools/{name}{ext}' for ext in ('.py', '.mjs', '.json') if (ROOT / 'tools' / f'{name}{ext}').exists()}
        return found

    def test_every_tools_module_the_deploy_suites_import_selects_them(self):
        files = [*self.tracked('deploy', 'tools/shared_saas_lifecycle', 'tools/continuous_updates_acceptance',
                               'tools/documents_acceptance', 'tools/shared_isolation_acceptance'),
                 *self.tracked('tools/liwan_cli')]
        paths = self.tools_paths(files)
        self.assertIn('tools/liwan_cli/module.py', paths)  # the scan sees the import the suites depend on
        for path in sorted(paths):
            with self.subTest(path=path):
                self.assertIn('deploy-suites', selector.units_for(path, self.graph))

    def test_every_repo_file_a_workspace_test_reads_outside_it_selects_that_workspace(self):
        reads = re.compile(r"""['"`](?:(?:\.\./)+)?((?:deploy|odoo-addons|apps/ai-service|apps/control-plane)/[A-Za-z0-9_./-]+\.(?:py|mjs|json|sql|ts)|deploy/Caddyfile)""")
        for workspace in ('apps/web', 'packages/commercial-contracts', 'packages/contracts', 'apps/vendor-admin'):
            tests = [path for path in self.tracked(workspace) if re.search(r'\.test\.|/test/|__tests__', str(path))
                     and '/e2e' not in str(path)]
            for test in tests:
                for path in set(reads.findall(test.read_text(encoding='utf-8', errors='ignore'))):
                    if not (ROOT / path).exists():
                        continue  # a fixture name the test builds itself
                    with self.subTest(test=str(test.relative_to(ROOT)), path=path):
                        self.assertIn(workspace, selector.units_for(path, self.graph))


if __name__ == '__main__':
    unittest.main()
