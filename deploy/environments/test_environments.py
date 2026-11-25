# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Staging and production run one compose set; the env file is the only per-environment input.

Renders the shared stack and the control plane with each env template (`docker compose config`, nothing is started)
and fails when the staging rendering differs from production anywhere but the allowlisted variables:
names, domains, secret placeholders, host paths and the edge publish address and ports, trusted proxy list and TLS
mode. The staging template is also checked on its own: it sits behind an Openship edge, so the
stack publishes on loopback only and Caddy trusts that edge's gateway and nothing else.
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

from deploy.stack import render as stack_render
from deploy.stack.compose_normalise import flatten
from deploy.test_edge_rate_limit import (
    RESERVED_PROXY, SHARED_CADDYFILE, _adapt_shared_caddyfile, _probe_config, _probe_requests)

DEPLOY = Path(__file__).resolve().parents[1]
ENVIRONMENTS = Path(__file__).resolve().parent
TEMPLATES = {name: ENVIRONMENTS / f'{name}.env.example' for name in ('staging', 'production')}
# The environment that sits behind an Openship edge; production decides its own edge at bring-up.
EDGE_ENVIRONMENTS = ('staging',)
# Hostname label of each edge environment's base domain (`<label>.example.test`).
BASE_LABELS = {'staging': 'staging'}
# The shared stack is the one definition, rendered from the env file; the control plane is its own compose set.
STACK_TEMPLATE = 'stack/compose.yml'
STACKS = {
    'shared': (STACK_TEMPLATE,),
    'control': ('control-plane/compose.production.yml', 'control-plane/compose.host-link.yml'),
}
# Files the control-plane compose reads at render time (`env_file`); the test points them at empty files.
RENDER_FILE_VARIABLES = ('LIWAN_CONTROL_ENV_FILE', 'LIWAN_VENDOR_ADMIN_ENV_FILE')
# Variables whose value may differ between environments: names, domains, secrets, host paths, networks, and
# the edge in front of the stack (publish address and ports, the proxy Caddy trusts, who terminates TLS).
VALUE_ALLOWLIST = frozenset({
    'LIWAN_EDGE_BIND', 'LIWAN_EDGE_HTTP_PORT', 'LIWAN_EDGE_HTTPS_PORT', 'LIWAN_TRUSTED_PROXIES', 'LIWAN_AUTO_HTTPS',
    'LIWAN_SITE_SCHEME',
    'DOMAIN', 'LIWAN_PROSPECT_HOST', 'NUXT_CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN', 'LIWAN_RESTORE_DOMAIN',
    'DB_NAME', 'DB_PASSWORD', 'DB_ADMIN_PASSWORD', 'LIWAN_SHARED_PROXY_TOKEN',
    'LIWAN_SESSION_KEYS', 'CUSTOMER_COMMERCIAL_SERVICE_KEY', 'LIWAN_SHARED_ODOO_CONFIG',
    'LIWAN_TENANT_REGISTRY_DIR', 'LIWAN_COMMERCIAL_CONTROL_NETWORK', 'LIWAN_ADMIN_EDGE_NETWORK',
    'LIWAN_CONTROL_EDGE_NETWORK',
    'LIWAN_CONTROL_CONFIG_DIR', 'LIWAN_CONTROL_STATE_DIR', 'LIWAN_CONTROL_PRIVATE_DIR', 'LIWAN_CONTROL_ENV_FILE',
    'LIWAN_VENDOR_ADMIN_ENV_FILE', 'LIWAN_SHARED_COMPOSE_FILE', 'LIWAN_SHARED_ENV_FILE', 'LIWAN_AI_PLATFORM_DIR',
    'LIWAN_RELEASE_TAG_POLICY', 'LIWAN_TENANT_STORAGE_FILES_DIR', 'LIWAN_RELEASE_PROOF_DIR',
})
MIN_SUBSTITUTION_LENGTH = 6  # shorter values (k1, ports) are never substituted inside other text
# The pinned `edge` network of deploy/stack/compose.yml: its gateway is the peer Caddy sees for the host's edge.
EDGE_SUBNET, EDGE_GATEWAY = '172.29.50.0/24', '172.29.50.1'


def parse_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        if line.strip() and not line.startswith('#'):
            name, _, value = line.partition('=')
            values[name] = value
    return values


def render(stack: str, template: Path, workdir: Path) -> dict:
    env = dict(os.environ)
    for variable in RENDER_FILE_VARIABLES:
        empty = workdir / f'{variable}.env'
        empty.write_text('')
        env[variable] = str(empty)
    if stack == 'shared':
        with stack_render.rendered_stack(template) as stack_file:
            command = ['docker', 'compose', '--project-directory', str(DEPLOY), '-f', str(stack_file),
                       '--env-file', str(template), '--env-file', str(stack_file.with_name(stack_render.SIZING_FILE)),
                       'config', '--format', 'json']
            done = subprocess.run(command, cwd=DEPLOY, env=env, capture_output=True, text=True, timeout=120)
    else:
        command = ['docker', 'compose']
        for name in STACKS[stack]:
            command += ['-f', name]
        command += ['--env-file', str(template), 'config', '--format', 'json']
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
        for name in EDGE_ENVIRONMENTS:
            with self.subTest(template=name):
                self.assertEqual(set(self.values[name]), set(self.values['production']))

    def test_only_allowlisted_variables_differ(self):
        production = self.values['production']
        for name in EDGE_ENVIRONMENTS:
            with self.subTest(template=name):
                values = self.values[name]
                differing = {variable for variable in values if values[variable] != production[variable]}
                self.assertEqual(set(), differing - VALUE_ALLOWLIST)

    def test_each_environment_names_only_its_own_database_hosts_and_paths(self):
        self.assertEqual('liwan_staging', self.values['staging']['DB_NAME'])
        self.assertIn('http://staging.example.test', self.values['staging']['DOMAIN'])
        for variable, value in self.values['production'].items():
            with self.subTest(template='production', variable=variable):
                self.assertNotIn('staging', value)
        for variable, value in self.values['staging'].items():
            with self.subTest(template='staging', variable=variable):
                if value.startswith('/srv/'):
                    self.assertTrue(value.startswith('/srv/liwan-staging/'), value)
                if value.startswith('liwan_') and variable.endswith('_NETWORK'):
                    self.assertTrue(value.startswith('liwan_staging_'), value)

    def test_the_web_tier_reaches_the_control_api_by_the_name_in_its_certificate(self):
        for name, values in self.values.items():
            with self.subTest(template=name):
                self.assertEqual('https://control-api:4187', values['NUXT_CUSTOMER_COMMERCIAL_CONTROL_URL'])

    def test_the_ai_platform_directory_is_under_the_control_state_directory(self):
        for name, values in self.values.items():
            with self.subTest(template=name):
                self.assertEqual(f"{values['LIWAN_CONTROL_STATE_DIR']}/ai-platform", values['LIWAN_AI_PLATFORM_DIR'])

    def test_the_control_template_example_provider_path_is_inside_its_state_directory(self):
        text = (DEPLOY / 'control-plane' / 'env.production.example').read_text()
        state = re.search(r'(?m)^#?\s*LIWAN_CLI_STATE_DIR=(\S+)', text).group(1)
        path = re.search(r'(?m)^#?\s*LIWAN_AI_PLATFORM_PROVIDER_PATH=(\S+)', text).group(1)
        self.assertEqual(f'{state}/ai-platform/platform-provider.json', path)

    def test_the_restore_domain_is_the_base_domain_of_the_tenant_sites(self):
        for name, values in self.values.items():
            with self.subTest(template=name):
                domain = values['LIWAN_RESTORE_DOMAIN']
                self.assertFalse(domain.startswith('restore.'), 'Caddy serves *.restore.<value>; the value is the base domain')
                hosts = [host.removeprefix('http://').removeprefix('*.') for host in re.split(r',\s*', values['DOMAIN'])]
                self.assertTrue(any(host.endswith(domain) for host in hosts), hosts)

    def test_session_keys_are_a_json_object_and_encryption_keys_are_id_secret_pairs(self):
        for name, values in self.values.items():
            with self.subTest(template=name):
                keys = json.loads(values['LIWAN_SESSION_KEYS'].strip("'"))
                self.assertEqual({values['LIWAN_SESSION_ACTIVE_KID']}, set(keys))
                for pair in values['AI_KEY_ENCRYPTION_KEYS'].split(','):
                    self.assertRegex(pair, r'^[a-z0-9_-]+:\S+$')
                self.assertIn(values['AI_KEY_ENCRYPTION_KEY_ID'], {pair.split(':')[0] for pair in values['AI_KEY_ENCRYPTION_KEYS'].split(',')})

    def test_every_variable_the_compose_set_requires_is_declared(self):
        required = set()
        for names in STACKS.values():
            for name in names:
                required |= set(re.findall(r'\$\{([A-Z0-9_]+):\?', (DEPLOY / name).read_text()))
        # The sizing values are exported by the renderer from deploy/odoo_sizing.py, not set in an env file.
        required -= set(stack_render.sizing_variables())
        for name in TEMPLATES:
            with self.subTest(template=name):
                self.assertEqual(set(), required - set(self.values[name]))

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
                production = rendered['production']
                for name in EDGE_ENVIRONMENTS:
                    candidate = rendered[name]
                    self.assertEqual(set(candidate), set(production),
                                     f'{stack}: {name} and production render different shapes')
                    for leaf in candidate:
                        if candidate[leaf] == production[leaf]:
                            continue
                        with self.subTest(stack=stack, template=name, leaf=leaf):
                            self.assertEqual(normalise(leaf, candidate[leaf], replacements[name], exact[name]),
                                             normalise(leaf, production[leaf], replacements['production'],
                                                       exact['production']),
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
    def test_edge_environments_publish_on_loopback_only_and_trust_the_edge_gateway(self):
        for name in EDGE_ENVIRONMENTS:
            with self.subTest(template=name):
                self.assertEqual('127.0.0.1', self.values[name]['LIWAN_EDGE_BIND'])
                with tempfile.TemporaryDirectory() as tmp:
                    rendered = {stack: render(stack, TEMPLATES[name], Path(tmp)) for stack in STACKS}
                published = {(service_name, port['host_ip']) for stack in rendered.values()
                             for service_name, service in stack['services'].items() for port in service.get('ports', [])}
                # Nothing of either stack is reachable from outside the host: every published port is bound to loopback.
                self.assertEqual({('proxy', '127.0.0.1')} | {item for item in published if item[1] == '127.0.0.1'},
                                 published)
                ports = {(port['published'], port['target']) for port in rendered['shared']['services']['proxy']['ports']}
                self.assertEqual({('18080', 80), ('18443', 443)}, ports)
                edge = rendered['shared']['networks']['edge']['ipam']['config']
                self.assertEqual([{'subnet': EDGE_SUBNET}], edge)
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


    def test_edge_environment_tenant_sites_are_plain_http_behind_the_edge(self):
        for name in EDGE_ENVIRONMENTS:
            with self.subTest(template=name):
                hosts = [host.strip() for host in self.values[name]['DOMAIN'].split(',')]
                self.assertEqual(2, len(hosts))
                self.assertTrue(all(host.startswith('http://') for host in hosts), hosts)

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot adapt the Caddyfile')
    def test_edge_environment_caddyfile_trusts_only_the_edge_and_starts_no_certificate_issuance(self):
        for name in EDGE_ENVIRONMENTS:
            with self.subTest(template=name):
                values, label = self.values[name], BASE_LABELS[name]
                adapted = _adapt_shared_caddyfile(
                    SHARED_CADDYFILE.read_text(encoding='utf-8'), domain=values['DOMAIN'].replace(',', ''),
                    env={variable: values[variable] for variable in ('LIWAN_TRUSTED_PROXIES', 'LIWAN_AUTO_HTTPS')})
                servers = adapted['apps']['http']['servers']
                self.assertEqual({f'{label}.example.test', f'*.{label}.example.test', '*.restore.invalid.invalid',
                                  'hooks.example.test'},
                                 {host for server in servers.values() for route in server['routes']
                                  for host in route['match'][0]['host']})
                for server_name, server in servers.items():
                    with self.subTest(server=server_name):
                        self.assertEqual({'source': 'static', 'ranges': [f'{EDGE_GATEWAY}/32']}, server['trusted_proxies'])
                        self.assertEqual(1, server['trusted_proxies_strict'])
                        self.assertEqual(['X-Forwarded-For'], server['client_ip_headers'])
                        self.assertEqual({'disable': True}, server['automatic_https'])
                self.assertNotIn('tls', adapted['apps'])

    def _adapt_edge_environment(self, name, restore_allow=None):
        values = self.values[name]
        names = ('LIWAN_TRUSTED_PROXIES', 'LIWAN_AUTO_HTTPS', 'LIWAN_SITE_SCHEME')
        return _adapt_shared_caddyfile(SHARED_CADDYFILE.read_text(encoding='utf-8'), restore_allow=restore_allow,
                                       domain=values['DOMAIN'].replace(',', ''),
                                       env={variable: values[variable] for variable in names})

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot adapt the Caddyfile')
    def test_edge_environments_serve_every_site_on_the_one_port_the_edge_forwards_to(self):
        for name in EDGE_ENVIRONMENTS:
            with self.subTest(template=name):
                servers = self._adapt_edge_environment(name)['apps']['http']['servers']
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
    def test_edge_environment_restore_route_answers_404_on_the_forwarded_port(self):
        for name in EDGE_ENVIRONMENTS:
            with self.subTest(template=name):
                config = _probe_config(self._adapt_edge_environment(name, restore_allow=''), '*.restore.invalid.invalid')
                statuses = [status for status, _ in _probe_requests(config, [
                    ('rabc.restore.invalid.invalid', {}),
                    ('rabc.restore.invalid.invalid', {'X-Forwarded-For': '203.0.113.9'})])]
                self.assertEqual([404, 404], statuses)


    def test_control_plane_hosts_and_operator_allowlist_are_closed_in_every_template(self):
        # Empty means the reserved name (nothing exposed) for both hosts and closed (404 for everyone) for the console.
        for name, values in self.values.items():
            for variable in ('CONTROL_WEBHOOK_DOMAIN', 'ADMIN_DOMAIN', 'LIWAN_ADMIN_ALLOW'):
                with self.subTest(template=name, variable=variable):
                    self.assertIn(variable, values)
                    self.assertEqual('', values[variable])

    def test_the_control_edge_network_is_named_per_environment_and_apart_from_the_other_networks(self):
        expected = {'staging': 'liwan_staging_control_edge', 'production': 'liwan_control_edge'}
        for name, values in self.values.items():
            with self.subTest(template=name):
                self.assertEqual(expected[name], values['LIWAN_CONTROL_EDGE_NETWORK'])
                self.assertEqual(3, len({values['LIWAN_CONTROL_EDGE_NETWORK'], values['LIWAN_COMMERCIAL_CONTROL_NETWORK'],
                                         values['LIWAN_ADMIN_EDGE_NETWORK']}))

    def test_the_readme_documents_the_control_plane_edge_variables(self):
        rows = {line.split('|')[1].strip() for line in (ENVIRONMENTS / 'README.md').read_text(encoding='utf-8').splitlines()
                if line.startswith('| `')}
        for variable in ('CONTROL_WEBHOOK_DOMAIN', 'ADMIN_DOMAIN', 'LIWAN_ADMIN_ALLOW', 'LIWAN_CONTROL_EDGE_NETWORK'):
            with self.subTest(variable=variable):
                self.assertIn(f'`{variable}`', rows)

    def test_the_ai_egress_hosts_key_is_declared_empty_and_documented(self):
        rows = {line.split('|')[1].strip() for line in (ENVIRONMENTS / 'README.md').read_text(encoding='utf-8').splitlines()
                if line.startswith('| `')}
        self.assertIn('`AI_EGRESS_HOSTS`', rows)
        for name, values in self.values.items():
            with self.subTest(template=name):
                self.assertEqual('', values.get('AI_EGRESS_HOSTS'))


    def test_the_database_admin_password_is_declared_apart_from_the_runtime_password_and_documented(self):
        rows = {line.split('|')[1].strip() for line in (ENVIRONMENTS / 'README.md').read_text(encoding='utf-8').splitlines()
                if line.startswith('| `')}
        self.assertIn('`DB_ADMIN_PASSWORD`', rows)
        for name, values in self.values.items():
            with self.subTest(template=name):
                self.assertIn('DB_ADMIN_PASSWORD', values)
                self.assertNotEqual(values['DB_PASSWORD'], values['DB_ADMIN_PASSWORD'])

    def test_release_credentials_are_documented_and_never_set_in_a_template(self):
        readme = (ENVIRONMENTS / 'README.md').read_text(encoding='utf-8')
        for variable in ('LIWAN_GHCR_READ_USER', 'LIWAN_GHCR_READ_TOKEN', 'LIWAN_GITHUB_READ_TOKEN'):
            self.assertIn(variable, readme)
            for template in ENVIRONMENTS.glob('*.env.example'):
                self.assertNotIn(variable, template.read_text(encoding='utf-8'), template.name)
        self.assertIn('Production holds its own', readme)


if __name__ == '__main__':
    unittest.main()
