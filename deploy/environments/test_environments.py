# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Staging and production run one compose set; the env file is the only per-environment input.

Renders the shared stack and the control plane with each env template (`docker compose config`, nothing is started)
and fails when the two renderings differ anywhere but the allowlisted variables: names, domains, secret placeholders,
host paths and the edge publish address and ports, trusted proxy list and TLS mode. The staging template is also
checked on its own: it sits behind the Openship edge, so the stack publishes on loopback only and Caddy trusts that
edge's gateway and nothing else.
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

from deploy.test_edge_rate_limit import (
    RESERVED_PROXY, SHARED_CADDYFILE, _adapt_shared_caddyfile, _probe_config, _probe_requests)

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
# Variables whose value may differ between the two environments: names, domains, secrets, host paths, networks, and
# the edge in front of the stack (publish address and ports, the proxy Caddy trusts, who terminates TLS).
VALUE_ALLOWLIST = frozenset({
    'LIWAN_EDGE_BIND', 'LIWAN_EDGE_HTTP_PORT', 'LIWAN_EDGE_HTTPS_PORT', 'LIWAN_TRUSTED_PROXIES', 'LIWAN_AUTO_HTTPS',
    'LIWAN_SITE_SCHEME',
    'DOMAIN', 'LIWAN_PROSPECT_HOST', 'NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN', 'LIWAN_RESTORE_DOMAIN',
    'NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL', 'DB_NAME', 'DB_PASSWORD', 'LIWAN_SHARED_PROXY_TOKEN',
    'LIWAN_SESSION_KEYS', 'CUSTOMER_COMMERCIAL_SERVICE_KEY', 'LIWAN_SHARED_ODOO_CONFIG',
    'LIWAN_TENANT_REGISTRY_DIR', 'LIWAN_COMMERCIAL_CONTROL_NETWORK', 'LIWAN_ADMIN_EDGE_NETWORK',
    'LIWAN_CONTROL_CONFIG_DIR', 'LIWAN_CONTROL_STATE_DIR', 'LIWAN_CONTROL_PRIVATE_DIR', 'LIWAN_CONTROL_ENV_FILE',
    'LIWAN_VENDOR_ADMIN_ENV_FILE', 'LIWAN_SHARED_COMPOSE_FILE', 'LIWAN_SHARED_ENV_FILE',
})
MIN_SUBSTITUTION_LENGTH = 6  # shorter values (k1, ports) are never substituted inside other text
# The pinned `edge` network of docker-compose.shared.yml: its gateway is the peer Caddy sees for the host's edge.
EDGE_SUBNET, EDGE_GATEWAY = '172.29.50.0/24', '172.29.50.1'


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


def normalise(leaf: str, value: object, replacements: dict[str, str], exact: dict[str, str]) -> object:
    """Replace allowlisted values by their variable name: long ones anywhere in the text, short or empty ones only
    when they are the whole leaf (a port `18080`, an empty trusted list)."""
    if not isinstance(value, str):
        return value
    variable = leaf.rsplit('.', 1)[-1]
    if '.environment.' in leaf and variable in VALUE_ALLOWLIST:  # a passthrough of an allowlisted variable
        return f'<{variable}>'
    if value in exact:
        return exact[value]
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
            exact = {env: {} for env in TEMPLATES}
            for env, values in self.values.items():
                for variable in VALUE_ALLOWLIST:
                    if len(values[variable]) >= MIN_SUBSTITUTION_LENGTH:
                        replacements[env][values[variable]] = f'<{variable}>'
                    else:
                        exact[env][values[variable]] = f'<{variable}>'
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
                        self.assertEqual(normalise(leaf, staging[leaf], replacements['staging'], exact['staging']),
                                         normalise(leaf, production[leaf], replacements['production'], exact['production']),
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

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot render the compose set')
    def test_staging_publishes_on_loopback_only_and_trusts_the_edge_gateway(self):
        staging = self.values['staging']
        self.assertEqual('127.0.0.1', staging['LIWAN_EDGE_BIND'])
        with tempfile.TemporaryDirectory() as tmp:
            rendered = {stack: render(stack, TEMPLATES['staging'], Path(tmp)) for stack in STACKS}
        published = {(name, port['host_ip']) for stack in rendered.values()
                     for name, service in stack['services'].items() for port in service.get('ports', [])}
        # Nothing of either stack is reachable from outside the host: every published port is bound to loopback.
        self.assertEqual({('proxy', '127.0.0.1')} | {item for item in published if item[1] == '127.0.0.1'}, published)
        ports = {(port['published'], port['target']) for port in rendered['shared']['services']['proxy']['ports']}
        self.assertEqual({('18080', 80), ('18443', 443)}, ports)
        edge = rendered['shared']['networks']['edge']['ipam']['config']
        self.assertEqual([{'subnet': EDGE_SUBNET, 'gateway': EDGE_GATEWAY}], edge)
        environment = rendered['shared']['services']['proxy']['environment']
        self.assertEqual(f'{EDGE_GATEWAY}/32', environment['LIWAN_TRUSTED_PROXIES'])
        self.assertEqual('off', environment['LIWAN_AUTO_HTTPS'])

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot render the compose set')
    def test_production_trusts_no_proxy_until_it_sits_behind_one(self):
        self.assertEqual('', self.values['production']['LIWAN_TRUSTED_PROXIES'])
        with tempfile.TemporaryDirectory() as tmp:
            environment = render('shared', TEMPLATES['production'], Path(tmp))['services']['proxy']['environment']
        self.assertEqual(RESERVED_PROXY, environment['LIWAN_TRUSTED_PROXIES'])
        self.assertEqual('ignore_loaded_certs', environment['LIWAN_AUTO_HTTPS'])

    def test_staging_tenant_sites_are_plain_http_behind_the_edge(self):
        staging = self.values['staging']
        hosts = [host.strip() for host in staging['DOMAIN'].split(',')]
        self.assertEqual(2, len(hosts))
        self.assertTrue(all(host.startswith('http://') for host in hosts), hosts)

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot adapt the Caddyfile')
    def test_staging_caddyfile_trusts_only_the_edge_and_starts_no_certificate_issuance(self):
        staging = self.values['staging']
        adapted = _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'), domain=staging['DOMAIN'].replace(',', ''),
                                          env={name: staging[name] for name in ('LIWAN_TRUSTED_PROXIES', 'LIWAN_AUTO_HTTPS')})
        servers = adapted['apps']['http']['servers']
        self.assertEqual({'staging.example.test', '*.staging.example.test', '*.restore.invalid.invalid', 'hooks.example.test'},
                         {host for server in servers.values() for route in server['routes'] for host in route['match'][0]['host']})
        for name, server in servers.items():
            with self.subTest(server=name):
                self.assertEqual({'source': 'static', 'ranges': [f'{EDGE_GATEWAY}/32']}, server['trusted_proxies'])
                self.assertEqual(1, server['trusted_proxies_strict'])
                self.assertEqual(['X-Forwarded-For'], server['client_ip_headers'])
                self.assertEqual({'disable': True}, server['automatic_https'])
        self.assertNotIn('tls', adapted['apps'])

    def _adapt_staging(self, restore_allow=None):
        staging = self.values['staging']
        names = ('LIWAN_TRUSTED_PROXIES', 'LIWAN_AUTO_HTTPS', 'LIWAN_SITE_SCHEME')
        return _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'), restore_allow=restore_allow,
                                       domain=staging['DOMAIN'].replace(',', ''),
                                       env={name: staging[name] for name in names})

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot adapt the Caddyfile')
    def test_staging_serves_every_site_on_the_one_port_the_edge_forwards_to(self):
        servers = self._adapt_staging()['apps']['http']['servers']
        self.assertEqual([[':80']], [server['listen'] for server in servers.values()])

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot adapt the Caddyfile')
    def test_production_sites_are_unchanged_by_the_scheme_variable(self):
        production = self.values['production']
        text = SHARED_CADDYFILE.read_text(encoding='utf-8')
        unset = _adapt_shared_caddyfile(text, domain=production['DOMAIN'].replace(',', ''))
        empty = _adapt_shared_caddyfile(text, domain=production['DOMAIN'].replace(',', ''),
                                        env={'LIWAN_SITE_SCHEME': '', 'LIWAN_AUTO_HTTPS': production['LIWAN_AUTO_HTTPS']})
        self.assertEqual(unset['apps']['http']['servers'], {
            name: {**server, 'automatic_https': {'ignore_loaded_certificates': True}}
            for name, server in empty['apps']['http']['servers'].items()})
        self.assertEqual([[':443']], [server['listen'] for server in unset['apps']['http']['servers'].values()])

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot adapt the Caddyfile')
    def test_staging_restore_route_answers_404_on_the_forwarded_port(self):
        adapted = self._adapt_staging(restore_allow='')
        config = _probe_config(adapted, '*.restore.invalid.invalid')
        statuses = [status for status, _ in _probe_requests(config, [
            ('rabc.restore.invalid.invalid', {}),
            ('rabc.restore.invalid.invalid', {'X-Forwarded-For': '203.0.113.9'})])]
        self.assertEqual([404, 404], statuses)


if __name__ == '__main__':
    unittest.main()
