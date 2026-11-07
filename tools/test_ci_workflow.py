# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The CI workflow's own supply chain: pinned actions and one Node version across CI and images."""
import re
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


if __name__ == '__main__':
    unittest.main()
