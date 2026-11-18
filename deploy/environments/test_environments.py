# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Staging and production run one compose set; the env file is the only per-environment input.

Renders the shared stack and the control plane with each env template (`docker compose config`, nothing is started)
and fails when the two renderings differ anywhere but the allowlisted variables: names, domains, secret placeholders,
host paths and the edge publish address and ports.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
ENVIRONMENTS = Path(__file__).resolve().parent
TEMPLATES = {name: ENVIRONMENTS / f'{name}.env.example' for name in ('staging', 'production')}
STACKS = {
    'shared': ('docker-compose.yml', 'docker-compose.shared.yml', 'docker-compose.shared-commercial.yml',
               'docker-compose.production.yml'),
    'control': ('control-plane/compose.production.yml', 'control-plane/compose.host-link.yml'),
}
# Files the control-plane compose reads at render time (`env_file`); the test points them at empty files.
RENDER_FILE_VARIABLES = ('LIWAN_CONTROL_ENV_FILE', 'LIWAN_VENDOR_ADMIN_ENV_FILE')
# Variables whose value may differ between the two environments: names, domains, secrets, host paths, networks.
VALUE_ALLOWLIST = frozenset({
    'DOMAIN', 'LIWAN_PROSPECT_HOST', 'NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN', 'LIWAN_RESTORE_DOMAIN',
    'NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL', 'DB_NAME', 'DB_PASSWORD', 'LIWAN_SHARED_PROXY_TOKEN',
    'LIWAN_SESSION_KEYS', 'CUSTOMER_COMMERCIAL_SERVICE_KEY', 'LIWAN_SHARED_ODOO_CONFIG',
    'LIWAN_TENANT_REGISTRY_DIR', 'LIWAN_COMMERCIAL_CONTROL_NETWORK', 'LIWAN_ADMIN_EDGE_NETWORK',
    'LIWAN_CONTROL_CONFIG_DIR', 'LIWAN_CONTROL_STATE_DIR', 'LIWAN_CONTROL_PRIVATE_DIR', 'LIWAN_CONTROL_ENV_FILE',
    'LIWAN_VENDOR_ADMIN_ENV_FILE', 'LIWAN_SHARED_COMPOSE_FILE', 'LIWAN_SHARED_ENV_FILE',
})
MIN_SUBSTITUTION_LENGTH = 6  # shorter values (k1, ports) are never substituted inside other text


def parse_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        if line.strip() and not line.startswith('#'):
            name, _, value = line.partition('=')
            values[name] = value
    return values


def flatten(node, path: str = '') -> dict[str, object]:
    """Map every leaf of a rendered compose document to its dotted path."""
    if isinstance(node, dict):
        return {leaf: value for key, child in node.items() for leaf, value in flatten(child, f'{path}.{key}' if path else key).items()}
    if isinstance(node, list):
        return {leaf: value for index, child in enumerate(node) for leaf, value in flatten(child, f'{path}[{index}]').items()}
    return {path: node}


def render(stack: str, template: Path, workdir: Path) -> dict:
    command = ['docker', 'compose']
    for name in STACKS[stack]:
        command += ['-f', name]
    command += ['--env-file', str(template), 'config', '--format', 'json']
    env = dict(os.environ)
    for variable in RENDER_FILE_VARIABLES:
        empty = workdir / f'{variable}.env'
        empty.write_text('')
        env[variable] = str(empty)
    done = subprocess.run(command, cwd=DEPLOY, env=env, capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise AssertionError(f'{stack} render failed for {template.name}: {done.stderr.strip()[:600]}')
    return json.loads(done.stdout)


def normalise(value: object, replacements: dict[str, str]) -> object:
    if not isinstance(value, str):
        return value
    for text, token in replacements.items():
        value = value.replace(text, token)
    return value


class EnvironmentTemplates(unittest.TestCase):
    def setUp(self):
        self.values = {name: parse_env(path) for name, path in TEMPLATES.items()}

    def test_templates_declare_the_same_variables(self):
        self.assertEqual(set(self.values['staging']), set(self.values['production']))

    def test_only_allowlisted_variables_differ(self):
        staging, production = self.values['staging'], self.values['production']
        differing = {name for name in staging if staging[name] != production[name]}
        self.assertEqual(set(), differing - VALUE_ALLOWLIST)

    def test_every_variable_the_compose_set_requires_is_declared(self):
        required = set()
        for names in STACKS.values():
            for name in names:
                required |= set(re.findall(r'\$\{([A-Z0-9_]+):\?', (DEPLOY / name).read_text()))
        self.assertEqual(set(), required - set(self.values['staging']))

    def test_no_value_looks_like_a_real_secret_or_domain(self):
        for name, values in self.values.items():
            for variable, value in values.items():
                with self.subTest(template=name, variable=variable):
                    for host in re.findall(r'[a-z0-9.-]+\.[a-z]{2,}', value):
                        self.assertTrue(host.endswith('example.test') or host.endswith('.json') or host.endswith('.env')
                                        or host.endswith('.conf'), host)
                    self.assertFalse(re.search(r'[A-Za-z0-9+/]{32,}', value), 'long token-like value')

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot render the compose set')
    def test_compose_set_renders_and_differs_only_by_allowlist(self):
        with tempfile.TemporaryDirectory() as tmp:
            workdir = Path(tmp)
            replacements = {env: {} for env in TEMPLATES}
            for env, values in self.values.items():
                for variable in VALUE_ALLOWLIST:
                    if len(values[variable]) >= MIN_SUBSTITUTION_LENGTH:
                        replacements[env][values[variable]] = f'<{variable}>'
                # Longest first: a path must be replaced before the shorter directory prefix inside it.
                replacements[env] = dict(sorted(replacements[env].items(), key=lambda item: -len(item[0])))
            for stack in STACKS:
                rendered = {env: flatten(render(stack, path, workdir)) for env, path in TEMPLATES.items()}
                staging, production = rendered['staging'], rendered['production']
                self.assertEqual(set(staging), set(production), f'{stack}: the two renderings have different shapes')
                for leaf in staging:
                    if staging[leaf] == production[leaf]:
                        continue
                    with self.subTest(stack=stack, leaf=leaf):
                        self.assertEqual(normalise(staging[leaf], replacements['staging']),
                                         normalise(production[leaf], replacements['production']),
                                         f'{leaf} differs outside the allowlist')

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot render the compose set')
    def test_edge_publishes_the_env_values(self):
        with tempfile.TemporaryDirectory() as tmp:
            for env, path in TEMPLATES.items():
                ports = render('shared', path, Path(tmp))['services']['proxy']['ports']
                values = self.values[env]
                self.assertEqual(
                    {(values['LIWAN_EDGE_BIND'], values['LIWAN_EDGE_HTTP_PORT'], 80),
                     (values['LIWAN_EDGE_BIND'], values['LIWAN_EDGE_HTTPS_PORT'], 443)},
                    {(port['host_ip'], port['published'], port['target']) for port in ports})


if __name__ == '__main__':
    unittest.main()
