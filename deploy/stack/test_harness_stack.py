# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The acceptance harnesses run the one stack (deploy/stack/compose.yml), never a stack of their own.

A harness renders `deploy/environments/local.env.example` plus its own values; its compose files are add-only. These
tests refuse a harness compose file that redefines a stack service, a harness that mounts source files into a container
or keeps a Caddyfile of its own, and check that the render a harness uses is a valid stack and a valid Odoo config.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from deploy.shared import validate_odoo_config
from deploy.stack import render

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / 'tools/shared_acceptance_live'
FOUNDATION = ROOT / 'tools/foundation_acceptance'
HARNESS_COMPOSE_FILES = (LIVE / 'subnets.yml', FOUNDATION / 'control-db.yml')
HARNESS_SOURCES = tuple(path for directory in (LIVE, FOUNDATION) for path in sorted(directory.iterdir())
                        if path.suffix in {'.sh', '.mjs', '.py', '.yml', '.md'} and not path.name.endswith('.test.mjs'))
# Host paths of source files a harness must not mount into a container, and the removed per-harness layers.
FORBIDDEN = (
    re.compile(r'deploy/shared/(?:launch_odoo|validate_odoo_config)\.py:'),
    re.compile(r'\./shared/(?:launch_odoo|validate_odoo_config)\.py'),
    re.compile(r'acceptance\.(?:Caddyfile|override\.yml)|stack\.override\.yml|FOUNDATION_CADDYFILE|docker-compose[.a-z-]*\.yml'),
)
HARNESS_VALUES = {
    'LIWAN_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'abc', 'DB_PASSWORD': 'db-secret', 'DB_ADMIN_PASSWORD': 'admin-secret',
    'LIWAN_ODOO_ADMIN_PASSWD': "'$pbkdf2-sha512$1$c2FsdA$aGFzaA'",
}


def load_stack_render():
    spec = importlib.util.spec_from_file_location('stack_render', LIVE / 'stack_render.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stack_render = load_stack_render()


def stack_services() -> set[str]:
    names: set[str] = set()
    for toggle in ('true', 'false'):
        env = {'LIWAN_STACK_COMMERCIAL_EDGE': toggle, 'LIWAN_STACK_DB_HOST_LINK': toggle}
        names |= set(yaml.safe_load(render.render_stack(env))['services'])
    return names


def redefined_services(compose_text: str) -> set[str]:
    """Services a harness compose file names that the stack already defines."""
    return set((yaml.safe_load(compose_text) or {}).get('services') or {}) & stack_services()


def write_harness_env(directory: Path, extra: dict[str, str] | None = None) -> None:
    values = {**HARNESS_VALUES, **(extra or {})}
    (directory / stack_render.HARNESS_ENV).write_text(''.join(f'{key}={value}\n' for key, value in values.items()), encoding='utf-8')


class HarnessComposeFilesAreAddOnly(unittest.TestCase):
    def test_no_harness_compose_file_redefines_a_stack_service(self):
        for path in HARNESS_COMPOSE_FILES:
            with self.subTest(path.name):
                self.assertEqual(set(), redefined_services(path.read_text(encoding='utf-8')))

    def test_a_redefinition_is_refused(self):
        self.assertEqual({'odoo'}, redefined_services('services:\n  odoo:\n    volumes: []\n  control-db:\n    image: x\n'))

    def test_the_harness_only_services_are_not_stack_services(self):
        services = yaml.safe_load((FOUNDATION / 'control-db.yml').read_text(encoding='utf-8'))['services']
        self.assertEqual({'control-db'}, set(services))
        self.assertNotIn('control-db', stack_services())

    def test_the_subnet_file_pins_networks_the_stack_defines_and_no_service(self):
        pinned = yaml.safe_load((LIVE / 'subnets.yml').read_text(encoding='utf-8'))
        self.assertNotIn('services', pinned)
        stack_networks = set(yaml.safe_load(render.render_stack({'LIWAN_STACK_COMMERCIAL_EDGE': 'false', 'LIWAN_STACK_DB_HOST_LINK': 'false'}))['networks'])
        self.assertLessEqual(set(pinned['networks']), stack_networks)


class HarnessesRunTheStackAsBuilt(unittest.TestCase):
    def test_no_harness_mounts_source_files_or_keeps_a_stack_of_its_own(self):
        for path in HARNESS_SOURCES:
            text = path.read_text(encoding='utf-8')
            for pattern in FORBIDDEN:
                with self.subTest(path=path.name, pattern=pattern.pattern):
                    self.assertIsNone(pattern.search(text))

    def test_up_sets_every_subnet_the_subnet_file_requires(self):
        required = set(re.findall(r'\$\{(LIWAN_HARNESS_SUBNET_[A-Z_]+):\?', (LIVE / 'subnets.yml').read_text(encoding='utf-8')))
        provided = set(re.findall(r'^(LIWAN_HARNESS_SUBNET_[A-Z_]+)=', (LIVE / 'up.sh').read_text(encoding='utf-8'), re.MULTILINE))
        self.assertEqual(required, provided)
        foundation = (FOUNDATION / 'provision_two_tenants.mjs').read_text(encoding='utf-8')
        for name in required:
            self.assertIn(name.removeprefix('LIWAN_HARNESS_SUBNET_'), foundation)


class RenderedHarness(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.directory)

    def test_render_writes_a_valid_stack_sizing_and_a_valid_odoo_config(self):
        write_harness_env(self.directory)
        paths = stack_render.render_run(self.directory)
        self.assertIn('odoo', yaml.safe_load(paths['compose.yml'].read_text(encoding='utf-8'))['services'])
        self.assertRegex(paths['sizing.env'].read_text(encoding='utf-8'), r'(?m)^LIWAN_ODOO_MEM_LIMIT=')
        self.assertEqual(0o400, stat.S_IMODE(paths['odoo.conf'].stat().st_mode))
        conf = paths['odoo.conf'].read_text(encoding='utf-8')
        # The master-password hash is written without the env file's quotes.
        self.assertIn('admin_passwd = $pbkdf2-sha512$1$c2FsdA$aGFzaA\n', conf)
        self.assertIn('db_password = db-secret\n', conf)
        validate_odoo_config.validate_config(str(paths['odoo.conf']))

    def test_rendering_twice_replaces_the_read_only_config(self):
        write_harness_env(self.directory)
        stack_render.render_run(self.directory)
        write_harness_env(self.directory, {'DB_PASSWORD': 'changed-secret'})
        stack_render.render_run(self.directory)
        self.assertIn('db_password = changed-secret\n', (self.directory / 'odoo.conf').read_text(encoding='utf-8'))

    def test_a_missing_harness_env_file_stops_the_render(self):
        with self.assertRaises(FileNotFoundError):
            stack_render.render_run(self.directory)

    def test_the_commercial_edge_and_host_link_stay_off(self):
        write_harness_env(self.directory)
        stack = yaml.safe_load(stack_render.render_run(self.directory)['compose.yml'].read_text(encoding='utf-8'))
        self.assertNotIn('commercial_control', stack['networks'])
        self.assertNotIn('db_host', stack['networks'])

    def test_the_compose_command_runs_the_stack_from_its_own_directory_with_ordered_env_files(self):
        command = stack_render.compose_command(self.directory, 'liwan-accept-1')
        self.assertEqual(str(ROOT / 'deploy'), command[command.index('--project-directory') + 1])
        env_files = [command[index + 1] for index, part in enumerate(command) if part == '--env-file']
        self.assertEqual([str(stack_render.LOCAL_ENV), str(self.directory / 'harness.env'), str(self.directory / 'sizing.env')], env_files)

    def test_the_admin_password_hash_is_pbkdf2_sha512_of_the_password(self):
        _, scheme, rounds, salt, checksum = stack_render.odoo_admin_hash('correct horse').split('$')

        def decode(text):
            return base64.b64decode(text.replace('.', '+') + '=' * (-len(text) % 4))

        self.assertEqual('pbkdf2-sha512', scheme)
        self.assertEqual(decode(checksum), hashlib.pbkdf2_hmac('sha512', b'correct horse', decode(salt), int(rounds)))

    @unittest.skipUnless(shutil.which('docker'), 'needs the docker CLI to resolve the render with `docker compose config`')
    def test_docker_compose_resolves_the_render_with_the_subnet_and_control_database_files(self):
        subnets = {f'LIWAN_HARNESS_SUBNET_{role}': f'10.240.{index * 2 + 4}.0/24' for index, role in enumerate(
            ('GUARD_WEB', 'GUARD_ODOO', 'DATABASE', 'AI_INTERNAL', 'ODOO_EGRESS', 'ODOO_MAIL', 'RELAY_ODOO', 'GUARD_RESTORE', 'RESTORE_DATABASE', 'TENANT_STORAGE'))}
        write_harness_env(self.directory, {**subnets, 'FOUNDATION_CONTROL_DB_PORT': '15432', 'FOUNDATION_CONTROL_DB_PASSWORD': 'x',
                                           'FOUNDATION_NET_CONTROL': '10.240.40.0/24'})
        stack_render.render_run(self.directory)
        command = stack_render.compose_command(self.directory, 'liwan-accept-test', FOUNDATION / 'control-db.yml')
        result = subprocess.run([*command, '--profile', 'restore', 'config', '--format', 'json'], capture_output=True, text=True, check=False)
        self.assertEqual(0, result.returncode, result.stderr)
        config = json.loads(result.stdout)
        self.assertLessEqual({'proxy', 'guard', 'web', 'odoo', 'db', 'control-db', 'restore-odoo'}, set(config['services']))
        self.assertEqual('10.240.4.0/24', config['networks']['guard_web']['ipam']['config'][0]['subnet'])
        self.assertEqual('liwan-caddy:test', config['services']['proxy']['image'])


if __name__ == '__main__':
    unittest.main()
