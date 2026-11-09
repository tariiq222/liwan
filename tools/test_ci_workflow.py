# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CI workflow's own supply chain: pinned actions and one Node version across CI and images."""
import re
import subprocess
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
    """`static` is one stage of parallel parts: ci-result and the stage cache still see a single job."""
    script = (ROOT / 'deploy/ci/static.sh').read_text()
    workflow = (ROOT / '.github/workflows/ci.yml').read_text()
    # Everything the single serial script ran before it was split; none of it may drop out of a part.
    COMMANDS = {
        'policies': ('ruff check odoo-addons', 'unittest deploy/test_*.py', 'discover -s deploy/staging',
                     'unittest tools/shared_saas_lifecycle/test_*.py', 'tools/catalog_check.py', 'tools/migration_guard.py',
                     'tools/git_policy.py', 'tools/arch_policy.py', 'tools/semgrep_gate.py', 'tools/forbidden_terms.py',
                     'deploy/image_pins.py', 'npm run check:audit', 'discover -s deploy/releases', 'node --test'),
        'tests': ('npm -w apps/web run postinstall', 'npm -w apps/vendor-admin run postinstall',
                  'npx playwright install chromium', 'npm test'),
        'types': ('npm -w apps/web run postinstall', 'max-old-space-size=8192 npm -w apps/web run lint'),
    }

    def parts(self):
        return re.search(r'(?m)^PARTS=\(([a-z ]+)\)$', self.script).group(1).split()

    def body(self, part):
        return re.search(rf'(?ms)^{part}\(\) \{{\n(.*?)^\}}$', self.script).group(1)

    def static_job(self):
        return re.search(r'(?ms)^  static:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n)', self.workflow).group(1)

    def test_the_parts_are_the_workflow_matrix(self):
        job = self.static_job()
        self.assertEqual(self.parts(), list(self.COMMANDS))
        self.assertIn('part: [' + ', '.join(self.parts()) + ']', job)
        self.assertIn('fail-fast: false', job)
        self.assertIn('name: static (${{ matrix.part }})', job)
        self.assertIn('run: deploy/ci/static.sh ${{ matrix.part }}', job)

    def test_each_part_keeps_the_commands_the_serial_script_ran(self):
        for part, commands in self.COMMANDS.items():
            for command in commands:
                with self.subTest(part=part, command=command):
                    self.assertIn(command, self.body(part))

    def test_every_command_sits_in_exactly_one_part(self):
        for part, commands in self.COMMANDS.items():
            for other in set(self.COMMANDS) - {part}:
                for command in commands:
                    if command == 'npm -w apps/web run postinstall':
                        continue  # the tests and the type check both need the generated Nuxt types
                    with self.subTest(part=part, other=other, command=command):
                        self.assertNotIn(command, self.body(other))

    def test_only_the_tests_part_installs_chromium(self):
        job = self.static_job()
        self.assertIn("playwright: ${{ matrix.part == 'tests' && 'true' || 'false' }}", job)
        self.assertEqual(self.script.count('playwright install'), 1)
        self.assertIn('playwright install', self.body('tests'))

    def test_the_stage_stays_one_job_for_the_aggregate_and_the_cache(self):
        self.assertNotIn('stage-pass', self.static_job())
        aggregate = re.search(r'(?ms)^  ci-result:\n(.*?)(?=^  [a-z][a-z0-9-]*:\n)', self.workflow).group(1)
        self.assertRegex(aggregate, r'needs: \[scope, static, ')
        self.assertIn('.static.result == "success"', aggregate)

    def test_the_documentation_profile_runs_in_one_part_only(self):
        job = self.static_job()
        self.assertIn("if: steps.profile.outputs.mode == 'docs' && matrix.part == 'policies'", job)
        self.assertEqual(job.count("steps.profile.outputs.mode != 'docs'"), 3)

    def test_the_script_runs_one_part_or_all_and_refuses_an_unknown_one(self):
        result = subprocess.run(['bash', str(ROOT / 'deploy/ci/static.sh'), 'unknown'], capture_output=True, text=True, check=False)
        self.assertEqual((result.returncode, result.stdout), (2, ''))
        self.assertIn('usage: static.sh', result.stderr)
        self.assertIn('all) for each in "${PARTS[@]}"; do "$each"; done', self.script)


if __name__ == '__main__':
    unittest.main()
