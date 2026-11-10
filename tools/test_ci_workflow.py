# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CI workflow's own supply chain: pinned actions and one Node version across CI and images."""
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / '.github'
DOCKERFILES = sorted(p for base in ('apps', 'deploy') for p in (ROOT / base).rglob('Dockerfile')
                     if 'node_modules' not in p.parts)
# `uses: actions/x@<40 hex>` or a local composite action (`./.github/actions/...`).
PINNED_ACTION = re.compile(r'^\s*(?:-\s*)?uses:\s+(\S+)')
COMMIT_SHA = re.compile(r'^[^@]+@[0-9a-f]{40}$')
NODE_IMAGE = re.compile(r'^FROM\s+node:([0-9]+\.[0-9]+\.[0-9]+)-')


def workflow_files():
    return sorted(WORKFLOW_DIR.rglob('*.yml'))


class ActionPinningTest(unittest.TestCase):
    """A floating tag would let a third party change what runs with this repository's token."""

    def test_every_external_action_is_pinned_to_a_commit(self):
        for workflow in workflow_files():
            for line in workflow.read_text().splitlines():
                match = PINNED_ACTION.match(line)
                if not match or match.group(1).startswith('./'):
                    continue
                with self.subTest(workflow=workflow.name, action=match.group(1)):
                    self.assertRegex(match.group(1), COMMIT_SHA,
                                     'pin the action to a commit SHA with a `# vX.Y.Z` comment')

    def test_the_pin_carries_the_readable_version(self):
        for workflow in workflow_files():
            for line in workflow.read_text().splitlines():
                match = PINNED_ACTION.match(line)
                if not match or match.group(1).startswith('./') or not COMMIT_SHA.match(match.group(1)):
                    continue
                with self.subTest(workflow=workflow.name, action=match.group(1)):
                    self.assertRegex(line, r'#\s*v\d+\.\d+\.\d+$')

    def test_dependabot_keeps_the_actions_moving(self):
        config = (WORKFLOW_DIR / 'dependabot.yml').read_text()
        self.assertIn('package-ecosystem: github-actions', config)


class NodeVersionTest(unittest.TestCase):
    """A different Node in the image than in CI would hide a difference the stages never exercise."""

    def test_every_node_image_uses_the_nvmrc_version(self):
        expected = (ROOT / '.nvmrc').read_text().strip()
        versions = {}
        for dockerfile in DOCKERFILES:
            for line in dockerfile.read_text().splitlines():
                match = NODE_IMAGE.match(line.strip())
                if match:
                    versions.setdefault(match.group(1), []).append(dockerfile.relative_to(ROOT).as_posix())
        self.assertTrue(versions, 'no Node image found to compare with .nvmrc')
        for version, owners in versions.items():
            with self.subTest(version=version):
                self.assertEqual(version, expected, f'.nvmrc is {expected}; {owners} use {version}')


class StaticStageTest(unittest.TestCase):
    """`static` is one stage of parallel parts made of units: ci-result and the stage cache still see a single job."""
    script = (ROOT / 'deploy/ci/static.sh').read_text()
    workflow = (ROOT / '.github/workflows/ci.yml').read_text()
    PARTS = ('policies', 'tests', 'types')
    # Everything the single serial script ran before it was split; none of it may drop out of a unit.
    COMMANDS = {
        'unit_gates': ('ruff check odoo-addons', 'tools/catalog_check.py', 'tools/migration_guard.py', 'tools/git_policy.py',
                       'tools/arch_policy.py', 'tools/semgrep_gate.py', 'tools/forbidden_terms.py', 'deploy/image_pins.py',
                       'npm run check:audit'),
        'unit_deploy_suites': ('unittest deploy/test_*.py', 'discover -s deploy/staging',
                               'unittest tools/shared_saas_lifecycle/test_*.py', 'discover -s deploy/releases', 'node --test'),
        'tests': ('npm -w apps/web run postinstall', 'npm -w apps/vendor-admin run postinstall',
                  'npx playwright install chromium', 'npm run test:repo', 'npm run test:tools', 'npm run test:workspaces'),
        'types': ('npm -w apps/web run postinstall', 'max-old-space-size=8192 npm -w apps/web run lint'),
    }
    NARROWED = 'steps.profile.outputs.mode != \'docs\' && steps.profile.outputs.mode != \'skip\''

    def parts(self):
        return re.search(r'(?m)^PARTS=\(([a-z ]+)\)$', self.script).group(1).split()

    def body(self, function):
        return re.search(rf'(?ms)^{function}\(\) \{{\n(.*?)^\}}$', self.script).group(1)

    def static_job(self):
        return re.search(r'(?ms)^  static:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n)', self.workflow).group(1)

    def test_the_parts_are_the_workflow_matrix(self):
        job = self.static_job()
        self.assertEqual(self.parts(), list(self.PARTS))
        self.assertIn('part: [' + ', '.join(self.parts()) + ']', job)
        self.assertIn('fail-fast: false', job)
        self.assertIn('name: static (${{ matrix.part }})', job)
        self.assertIn('run: deploy/ci/static.sh ${{ matrix.part }}', job)

    def test_each_unit_keeps_the_commands_the_serial_script_ran(self):
        for function, commands in self.COMMANDS.items():
            for command in commands:
                with self.subTest(function=function, command=command):
                    self.assertIn(command, self.body(function))

    def test_every_command_sits_in_exactly_one_unit(self):
        for function, commands in self.COMMANDS.items():
            for other in set(self.COMMANDS) - {function}:
                for command in commands:
                    if command == 'npm -w apps/web run postinstall':
                        continue  # the tests and the type check both need the generated Nuxt types
                    with self.subTest(function=function, other=other, command=command):
                        self.assertNotIn(command, self.body(other))

    def test_each_part_runs_its_units_only_when_selected(self):
        policies = self.body('policies')
        for function, unit in (('unit_gates', 'gates'), ('unit_deploy_suites', 'deploy-suites')):
            self.assertIn(f'if unit_selected {unit}; then {function}; fi', policies)
        tests = self.body('tests')
        for unit in ('repo', 'tools'):
            self.assertIn(f'if unit_selected {unit}; then heavy npm run test:{unit}; fi', tests)

    def test_only_a_run_of_the_web_tests_installs_chromium(self):
        job = self.static_job()
        self.assertIn("playwright: ${{ matrix.part == 'tests' && steps.profile.outputs.playwright != 'false' && 'true' || 'false' }}", job)
        self.assertEqual(self.script.count('playwright install'), 1)
        self.assertIn('if unit_selected apps/web; then npx playwright install chromium; fi', self.body('tests'))

    def test_the_selection_comes_from_the_selector_on_pull_requests_only(self):
        job = self.static_job()
        self.assertRegex(job, r"(?s)id: profile\n\s+if: github.event_name == 'pull_request'\n.*"
                              r'tools/ci_static_profile.py --base "\$PR_BASE" --part "\$STATIC_PART"')
        self.assertIn('CI_STATIC_UNITS: ${{ steps.profile.outputs.units }}', job)
        self.assertEqual(job.count('github.event_name'), 1)

    def test_the_stage_stays_one_job_for_the_aggregate_and_the_cache(self):
        self.assertNotIn('stage-pass', self.static_job())
        aggregate = re.search(r'(?ms)^  ci-result:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n)', self.workflow).group(1)
        self.assertRegex(aggregate, r'needs: \[scope, static, ')
        self.assertIn('.static.result == "success"', aggregate)

    def test_the_documentation_profile_runs_in_one_part_only(self):
        job = self.static_job()
        self.assertIn("if: steps.profile.outputs.mode == 'docs'", job)
        # The setup, the Python tools and the script each skip a part with the documentation profile or no unit.
        self.assertEqual(job.count(self.NARROWED), 3)

    def test_the_script_runs_one_part_or_all_and_refuses_an_unknown_one(self):
        result = subprocess.run(['bash', str(ROOT / 'deploy/ci/static.sh'), 'unknown'], capture_output=True, text=True, check=False)
        self.assertEqual((result.returncode, result.stdout), (2, ''))
        self.assertIn('usage: static.sh', result.stderr)
        self.assertIn('for each in "${PARTS[@]}"; do "$each"; done', self.script)

    def run_script(self, part, units):
        """Run static.sh in a scratch checkout whose tools only log their command line; returns (exit code, stderr, log)."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'deploy/ci').mkdir(parents=True)
            shutil.copy(ROOT / 'deploy/ci/static.sh', root / 'deploy/ci/static.sh')
            shutil.copy(ROOT / 'package.json', root / 'package.json')
            bin_dir, log = root / 'bin', root / 'calls.log'
            bin_dir.mkdir()
            for name in ('python3', 'npm', 'npx', 'node', 'ruff'):
                tool = bin_dir / name
                # python3 also stands in for tools/test_slot.py: it runs the command after `--` like the real queue.
                slot = 'case "$*" in *test_slot.py*) while [ "$1" != -- ]; do shift; done; shift; exec "$@" ;; esac\n' if name == 'python3' else ''
                tool.write_text(f'#!/bin/sh\necho "{name} $*" >> "{log}"\n{slot}')
                tool.chmod(0o755)
            for command in (('init', '-q'), ('add', '--all'), ('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'x')):
                subprocess.run(['git', *command], cwd=root, check=True, capture_output=True)
            environment = {key: value for key, value in os.environ.items() if key not in ('GITHUB_ACTIONS', 'CI_STATIC_UNITS')}
            environment.update(PATH=f'{bin_dir}:{os.environ["PATH"]}', CI_BASE_REF='HEAD', **({'CI_STATIC_UNITS': units} if units else {}))
            result = subprocess.run(['bash', 'deploy/ci/static.sh', *part], cwd=root, env=environment, capture_output=True, text=True)
            return result.returncode, result.stderr, log.read_text().splitlines() if log.exists() else []

    def test_a_unit_the_part_does_not_own_is_refused_before_anything_runs(self):
        for part, units in (('tests', 'bogus'), ('tests', 'apps/we'), ('tests', 'gates'), ('policies', 'repo'),
                            ('types', 'tools'), ('policies', 'gates repo')):
            with self.subTest(part=part, units=units):
                code, stderr, calls = self.run_script([part], units)
                self.assertEqual((code, calls), (2, []))
                self.assertIn('unknown static unit', stderr)
        code, stderr, calls = self.run_script([], 'gates')
        self.assertEqual((code, calls), (2, []))
        self.assertIn('name the part', stderr)

    def test_selected_test_units_run_only_their_commands(self):
        code, stderr, calls = self.run_script(['tests'], 'repo apps/web')
        self.assertEqual(code, 0, stderr)
        self.assertIn('npm run test:repo', calls)
        self.assertIn('npm -w apps/web run test', calls)
        self.assertIn('python3 -B tools/test_slot.py -- npm run test:repo', calls)  # a local run queues in the test slots
        self.assertIn('npx playwright install chromium', calls)
        self.assertNotIn('npm run test:tools', calls)
        self.assertNotIn('npm run test:workspaces', calls)
        self.assertFalse([call for call in calls if 'vendor-admin' in call])

    def test_a_workspace_without_the_web_tests_installs_no_browser(self):
        code, stderr, calls = self.run_script(['tests'], 'tools apps/vendor-admin')
        self.assertEqual(code, 0, stderr)
        self.assertIn('npm -w apps/vendor-admin run test', calls)
        self.assertIn('npm -w apps/vendor-admin run postinstall', calls)
        self.assertFalse([call for call in calls if 'playwright' in call])

    def test_selected_policy_units_run_only_their_commands(self):
        code, stderr, calls = self.run_script(['policies'], 'gates')
        self.assertEqual(code, 0, stderr)
        self.assertTrue([call for call in calls if 'tools/catalog_check.py' in call])
        self.assertFalse([call for call in calls if 'unittest' in call or '--test' in call])

    def test_without_a_selection_a_part_runs_every_unit(self):
        code, stderr, calls = self.run_script(['tests'], '')
        self.assertEqual(code, 0, stderr)
        for call in ('npm run test:repo', 'npm run test:tools', 'npm run test:workspaces', 'npx playwright install chromium',
                     'npm -w apps/vendor-admin run postinstall'):
            self.assertIn(call, calls)


if __name__ == '__main__':
    unittest.main()
