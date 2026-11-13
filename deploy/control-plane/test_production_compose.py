# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The production definition of the control plane and the vendor console (compose.production.yml and its env templates).

These tests read the files; no service is started. They pin the hardening properties, the single scheduler, the unpublished
database, the documentation of every environment variable the code reads, and the absence of secret defaults.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTROL = ROOT / 'deploy' / 'control-plane'
COMPOSE = CONTROL / 'compose.production.yml'
HOST_LINK = CONTROL / 'compose.host-link.yml'
UNIT = CONTROL / 'liwan-shared-worker.service'
SOURCE = ROOT / 'apps' / 'control-plane' / 'src'
ENV_TEMPLATES = (CONTROL / 'env.production.example', CONTROL / 'shared-worker.env.example', CONTROL / 'env.example',
                 ROOT / 'deploy' / 'vendor-admin' / 'env.example')
SECRET_NAME = re.compile(r'(?:KEY|SECRET|PASSWORD|TOKEN|DATABASE_URL)$')
# Names that look like secrets but are not: identifiers and public keys.
NOT_SECRET = {'LIWAN_SIGNUP_TURNSTILE_SITE_KEY', 'LIWAN_SIGNUP_PLAN_REVISION_ID', 'MOYASAR_ACCOUNT_NAME',
              'MOYASAR_PUBLISHABLE_KEY',
              # Paths of key files, not key material.
              'CONTROL_TLS_KEY', 'INTERNAL_EFFECT_TLS_KEY'}
LONG_RUNNING = ('control-db', 'control-api', 'vendor-console')

ENV_READS = (
    re.compile(r'(?:process\.env|\benv)\.([A-Z][A-Z0-9_]+)'),
    re.compile(r"\benv\[\s*['\"]([A-Z][A-Z0-9_]+)['\"]\s*\]"),
    re.compile(r"\b(?:required|need)\(\s*['\"]([A-Z][A-Z0-9_]+)['\"]"),
    re.compile(r"['\"]((?:LIWAN|CONTROL|MOYASAR|ADMIN|INTERNAL_EFFECT|CUSTOMER_COMMERCIAL)_[A-Z0-9_]*[A-Z0-9])['\"]"),
)
NOT_ENVIRONMENT = {'CONTROL_TEST_DATABASE_URL'}


def _source_files():
    for path in sorted(SOURCE.rglob('*.ts')):
        if '__tests__' in path.parts or path.name.endswith('.test.ts'):
            continue
        yield path


def variables_read_by_the_code() -> set[str]:
    found: set[str] = set()
    for path in _source_files():
        text = path.read_text(encoding='utf-8')
        for pattern in ENV_READS:
            found.update(pattern.findall(text))
    found = {name for name in found if '_' in name or name == 'NODE_ENV'} - NOT_ENVIRONMENT
    return {name for name in found if re.match(r'^(?:LIWAN|CONTROL|MOYASAR|ADMIN|INTERNAL_EFFECT|CUSTOMER_COMMERCIAL|NODE_ENV)', name)}


def assigned_names(path: Path) -> dict[str, str]:
    """Every `NAME=value` line, commented or not, with its value."""
    result: dict[str, str] = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        match = re.match(r'^#?\s*([A-Z][A-Z0-9_]+)=(.*)$', line)
        if match:
            result[match.group(1)] = match.group(2).strip()
    return result


class ProductionCompose(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = yaml.safe_load(COMPOSE.read_text(encoding='utf-8'))
        cls.services = cls.document['services']

    def test_expected_services_exist(self):
        self.assertEqual(set(self.services), {'control-db', 'control-migrate', 'control-api', 'control-worker', 'control-admin', 'vendor-console'})

    def test_every_service_is_hardened(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertEqual(service['cap_drop'], ['ALL'])
                self.assertNotIn('cap_add', service)
                self.assertIn('no-new-privileges:true', service['security_opt'])
                self.assertIs(service['read_only'], True)
                self.assertIn('/tmp', ' '.join(service['tmpfs']))
                self.assertIn('mem_limit', service)
                self.assertIn('pids_limit', service)
                self.assertEqual(service['logging']['options']['max-size'], '10m')
                self.assertIn('max-file', service['logging']['options'])
                self.assertNotIn('privileged', service)
                self.assertNotIn('network_mode', service)

    def test_no_service_runs_as_root(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                user = str(service['user'])
                self.assertFalse(user.startswith(('root', '0:', '0')), user)

    def test_long_running_services_restart_and_have_health_checks(self):
        for name in LONG_RUNNING:
            with self.subTest(service=name):
                self.assertEqual(self.services[name]['restart'], 'unless-stopped')
                self.assertIn('test', self.services[name]['healthcheck'])
        for name in ('control-migrate', 'control-admin'):
            self.assertEqual(self.services[name]['restart'], 'no')

    def test_images_are_pinned_or_built_here(self):
        self.assertRegex(self.services['control-db']['image'], r'@sha256:[0-9a-f]{64}$')
        for name in ('control-api', 'control-migrate', 'control-worker', 'control-admin'):
            self.assertRegex(self.services[name]['image'], r'^liwan-control-plane:\$\{LIWAN_IMAGE_TAG:\?')
        self.assertRegex(self.services['vendor-console']['image'], r'^liwan-vendor-admin:\$\{LIWAN_IMAGE_TAG:\?')

    def test_exactly_one_scheduler_runs_and_it_is_the_systemd_unit(self):
        text = COMPOSE.read_text(encoding='utf-8')
        self.assertNotIn('shared-worker-main', text)
        self.assertNotIn('worker:shared', text)
        self.assertNotIn('run-shared-worker', text)
        commands = {name: ' '.join(service.get('command') or service.get('entrypoint') or []) for name, service in self.services.items()}
        self.assertEqual({n for n, c in commands.items() if 'src/main.ts' in c}, {'control-api'})
        self.assertEqual({n for n, c in commands.items() if 'worker-main' in c}, {'control-worker'})
        unit = UNIT.read_text(encoding='utf-8')
        self.assertEqual(len(re.findall(r'(?m)^ExecStart=.*run-shared-worker\.sh$', unit)), 1)
        # The one unit file is the only definition of the scheduler's process.
        self.assertEqual([p.name for p in CONTROL.glob('*.service')], ['liwan-shared-worker.service'])

    def test_the_ordinary_worker_is_off_unless_asked_for(self):
        self.assertEqual(self.services['control-worker']['profiles'], ['operator-jobs'])
        self.assertEqual(self.services['control-migrate']['profiles'], ['migrate'])
        self.assertEqual(self.services['control-admin']['profiles'], ['admin'])
        for name in ('control-db', 'control-api', 'vendor-console'):
            self.assertNotIn('profiles', self.services[name])

    def test_no_container_gets_the_docker_socket(self):
        self.assertNotIn('docker.sock', COMPOSE.read_text(encoding='utf-8'))
        self.assertNotIn('docker.sock', HOST_LINK.read_text(encoding='utf-8'))

    def test_the_database_is_not_published_and_sits_on_internal_networks(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertNotIn('ports', service)
        networks = self.document['networks']
        self.assertEqual(self.services['control-db']['networks'], ['control_data'])
        self.assertIs(networks['control_data']['internal'], True)
        for name, service in self.services.items():
            for network in service['networks']:
                if network != 'control_egress':
                    self.assertIs(networks[network].get('internal'), True, f'{name}: {network}')

    def test_only_the_api_has_an_outbound_route(self):
        users = [n for n, s in self.services.items() if 'control_egress' in s['networks']]
        self.assertEqual(users, ['control-api'])

    def test_the_host_link_overlay_publishes_the_database_on_loopback_only(self):
        overlay = yaml.safe_load(HOST_LINK.read_text(encoding='utf-8'))
        self.assertEqual(list(overlay['services']), ['control-db'])
        ports = overlay['services']['control-db']['ports']
        self.assertEqual(len(ports), 1)
        self.assertTrue(ports[0].startswith('127.0.0.1:'), ports[0])
        self.assertNotIn('internal', overlay['networks']['control_db_host'] or {})

    def test_the_console_cannot_reach_the_database_or_the_web_tier_network(self):
        self.assertEqual(set(self.services['vendor-console']['networks']), {'control_api_admin', 'admin_edge'})
        self.assertNotIn('control_api_web', self.services['vendor-console']['networks'])
        self.assertIn('control_api_web', self.services['control-api']['networks'])

    def test_the_api_serves_https_only(self):
        environment = self.services['control-api']['environment']
        self.assertEqual(environment['CONTROL_HOST'], '0.0.0.0')
        self.assertIn('CONTROL_TLS_KEY', environment)
        self.assertIn('CONTROL_TLS_CERT', environment)
        self.assertEqual(environment['LIWAN_TENANCY_MODE'], 'shared')

    def test_no_secret_has_a_default_in_the_compose_files(self):
        for path in (COMPOSE, HOST_LINK):
            for name, default in re.findall(r'\$\{([A-Z0-9_]+):-([^}]*)\}', path.read_text(encoding='utf-8')):
                with self.subTest(file=path.name, name=name):
                    self.assertFalse(SECRET_NAME.search(name), f'{name} has default {default!r}')
        environment = {}
        for service in self.services.values():
            environment.update(service.get('environment') or {})
        for name, value in environment.items():
            if SECRET_NAME.search(name):
                self.assertTrue(str(value).startswith('/run/secrets/'), f'{name} must be a secret file path')


class Dockerfile(unittest.TestCase):
    def test_pinned_base_and_unprivileged_user(self):
        text = (CONTROL / 'Dockerfile').read_text(encoding='utf-8')
        for image in re.findall(r'(?m)^FROM\s+(\S+)', text):
            self.assertRegex(image, r'@sha256:[0-9a-f]{64}$')
        users = re.findall(r'(?m)^USER\s+(\S+)', text)
        self.assertEqual(users[-1], 'node')
        self.assertNotIn('shared-worker-main', text)


class EnvTemplates(unittest.TestCase):
    def test_every_variable_the_code_reads_is_documented(self):
        documented: set[str] = set()
        for template in ENV_TEMPLATES:
            documented.update(assigned_names(template))
        read = variables_read_by_the_code()
        self.assertIn('MOYASAR_WEBHOOK_SECRET', read, 'the scan lost its grip on the source')
        self.assertIn('CONTROL_DATABASE_URL', read)
        self.assertIn('LIWAN_ALERT_TELEGRAM_BOT_TOKEN', read)
        self.assertEqual(sorted(read - documented), [], 'document these variables in an env template')

    def test_no_secret_has_a_value(self):
        for template in ENV_TEMPLATES:
            if template.name == 'env.example' and template.parent == CONTROL:
                continue  # the local harness template carries only file paths and example hosts
            for name, value in assigned_names(template).items():
                if SECRET_NAME.search(name) and name not in NOT_SECRET:
                    with self.subTest(template=template.name, name=name):
                        self.assertEqual(value, '')

    def test_secrets_are_marked(self):
        for template in (CONTROL / 'env.production.example', CONTROL / 'shared-worker.env.example', ROOT / 'deploy' / 'vendor-admin' / 'env.example'):
            lines = template.read_text(encoding='utf-8').splitlines()
            for index, line in enumerate(lines):
                match = re.match(r'^#?\s*([A-Z][A-Z0-9_]+)=$', line)
                if match and SECRET_NAME.search(match.group(1)) and match.group(1) not in NOT_SECRET:
                    with self.subTest(template=template.name, name=match.group(1)):
                        self.assertIn('[SECRET]', lines[index - 1])

    def test_development_login_is_never_enabled(self):
        for template in ENV_TEMPLATES:
            for name, value in assigned_names(template).items():
                if name in ('ADMIN_DEV_LOGIN_EMAIL', 'NUXT_PUBLIC_DEV_LOGIN'):
                    self.assertTrue(template.read_text(encoding='utf-8').count(f'# {name}=') >= 1 or value in ('', 'false'))


class EdgeSnippets(unittest.TestCase):
    def test_the_control_api_exposes_only_the_payment_event_route(self):
        text = (CONTROL / 'Caddyfile.snippet').read_text(encoding='utf-8')
        self.assertEqual(re.findall(r'(?m)^\s*path\s+(\S+)', text), ['/v1/commercial/payment-events/moyasar'])
        self.assertIn('method POST', text)
        self.assertIn('reverse_proxy @moyasar control-api:4187', text)
        self.assertRegex(text, r'(?m)^\s*respond 404$')
        self.assertNotIn('tls_insecure_skip_verify', text)
        self.assertNotRegex(text, r'(?m)^\s*log\b')

    def test_the_payment_route_matches_the_code(self):
        routes = (SOURCE / 'commercial' / 'routes-b.ts').read_text(encoding='utf-8')
        self.assertIn(r'/^\/v1\/commercial\/payment-events\/([^/]+)$/', routes)

    def test_the_console_block_points_at_the_compose_service(self):
        text = (ROOT / 'deploy' / 'vendor-admin' / 'Caddyfile.snippet').read_text(encoding='utf-8')
        self.assertIn('reverse_proxy vendor-console:3100', text)
        self.assertIn('Cache-Control "no-store"', text)


if __name__ == '__main__':
    unittest.main()
