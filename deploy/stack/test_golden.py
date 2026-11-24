# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The rendered stack of each environment equals the golden capture of the five layered compose files it replaced.

`golden/<env>.json` is `docker compose config --format json` of the old five-file set with that environment's
template (captured before the files were removed, in the commit that removed them). The one stack definition must render to the same document,
except for the changes listed in `golden/deltas.json`. Nothing is started: compose only renders.
The old files are gone, so a golden file changes only by hand, with the matching entry in `golden/deltas.json`.
Both documents go through `compose_normalise.normalise` before the comparison, so a leaf the compose build itself decides
to print or omit is not what the capture fixes.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path

from deploy.stack import render as stack_render
from deploy.stack.compose_normalise import flatten, normalise

DEPLOY = Path(__file__).resolve().parents[1]
ROOT = DEPLOY.parent
GOLDEN = Path(__file__).resolve().parent / 'golden'
ENVIRONMENTS = ('staging', 'production')
PROJECT = 'golden'


def render(environment: str, extra_env: dict[str, str] | None = None) -> dict:
    """Render the environment's stack with its tracked template, as the release does (compose project directory deploy/)."""
    command = ['docker', 'compose', '-p', PROJECT, '--project-directory', str(DEPLOY)]
    template = DEPLOY / 'environments' / f'{environment}.env.example'
    with stack_render.rendered_stack(template) as stack_file:
        command += ['-f', str(stack_file), '--env-file', str(template),
                    '--env-file', str(stack_file.with_name(stack_render.SIZING_FILE)),
                    '--profile', '*', 'config', '--format', 'json']
        done = subprocess.run(command, capture_output=True, text=True, timeout=120, env={**os.environ, **(extra_env or {})})
    if done.returncode != 0:
        raise AssertionError(f'{environment} render failed: {done.stderr.strip()[:600]}')
    return normalise(json.loads(done.stdout), ROOT)


def apply_deltas(golden: dict, deltas: dict) -> dict:
    """The golden document with the declared deltas applied: leaves set (value) or removed (null path list)."""
    flat = flatten(golden)
    for path, value in deltas.get('set', {}).items():
        flat[path] = value
    return flat


class VersionDefaults(unittest.TestCase):
    """The leaves compose prints or omits by its own build are normalised away before anything is compared."""

    def test_the_default_create_host_path_normalises_equal_to_the_bind_that_names_no_option(self):
        # Compose 2.38 prints `bind: {create_host_path: true}` where Compose 5 prints `bind: {}` for the same mount.
        with_default = {'services': {'x': {'volumes': [
            {'type': 'bind', 'source': '/host/state', 'target': '/state', 'bind': {'create_host_path': True}},
            {'source': 'data', 'target': '/data', 'type': 'volume', 'volume': {}}]}}}
        without_leaf = {'services': {'x': {'volumes': [
            {'type': 'bind', 'source': '/host/state', 'target': '/state', 'bind': {}},
            {'source': 'data', 'target': '/data', 'type': 'volume', 'volume': {}}]}}}
        normalised = flatten(normalise(with_default, ROOT))
        self.assertEqual(normalised, flatten(normalise(without_leaf, ROOT)))
        self.assertEqual({'services.x.volumes[0].source': '/host/state', 'services.x.volumes[0].target': '/state',
                          'services.x.volumes[0].type': 'bind', 'services.x.volumes[1].source': 'data',
                          'services.x.volumes[1].target': '/data', 'services.x.volumes[1].type': 'volume'}, normalised)


class GoldenStack(unittest.TestCase):
    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot render the stack')
    def test_each_environment_renders_the_golden_document_plus_the_declared_deltas(self):
        deltas = json.loads((GOLDEN / 'deltas.json').read_text(encoding='utf-8'))
        for environment in ENVIRONMENTS:
            with self.subTest(environment=environment):
                expected = apply_deltas(normalise(json.loads((GOLDEN / f'{environment}.json').read_text(encoding='utf-8')), ROOT),
                                        deltas[environment])
                actual = flatten(render(environment))
                self.assertEqual(sorted(set(expected) - set(actual)), [], 'leaves the golden has and the stack lacks')
                self.assertEqual(sorted(set(actual) - set(expected)), [], 'leaves the stack has and the golden lacks')
                self.assertEqual({leaf: (expected[leaf], actual[leaf]) for leaf in expected if expected[leaf] != actual[leaf]}, {})

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot render the stack')
    def test_the_object_storage_compat_host_joins_odoos_egress_list_only_when_set(self):
        key = 'services.odoo-egress.environment.AI_EGRESS_HOSTS'
        base = flatten(render('staging'))[key]
        self.assertFalse(base.endswith(','))
        with_host = flatten(render('staging', {'LIWAN_OBJECT_STORAGE_COMPAT_HOST': 'ns.compat.objectstorage.me-jeddah-1.oraclecloud.com'}))[key]
        self.assertEqual(base + ',ns.compat.objectstorage.me-jeddah-1.oraclecloud.com', with_host)


if __name__ == '__main__':
    unittest.main()
