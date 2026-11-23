# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Host preparation for a production-style environment: the tenant database host link and `init-host.sh`.

The overlay and the script are read or run in a temporary directory; no service is started and no real host is touched.
"""
from __future__ import annotations

import json
import os
import pwd
import re
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

from deploy.release.release import SHARED_COMPOSE_FILES

DEPLOY = Path(__file__).resolve().parent
HOST_LINK = DEPLOY / 'docker-compose.host-link.yml'
INIT_HOST = DEPLOY / 'control-plane' / 'init-host.sh'
TEMPLATE = DEPLOY / 'environments' / 'staging.env.example'
BASE_STACK = tuple(name for name in SHARED_COMPOSE_FILES if name != HOST_LINK.name)
BRIDGE = 'liwan-dbhost'  # the interface name the host firewall rule in the runbook matches
PROJECT = 'liwan-shared-staging'
RESTORE_DOMAIN = 'staging.example.test'
PRIVATE_FILES = ('control-ca.key', 'control-ca.pem', 'control-tls.key', 'control-tls.crt', 'effect-tls.key',
                 'effect-tls.crt', 'control-db-password')


def _render(workdir: Path, files: tuple[str, ...]) -> dict:
    """The rendered shared stack as docker compose resolves it (the control-plane env files are empty stand-ins)."""
    env = dict(os.environ)
    for variable in ('LIWAN_CONTROL_ENV_FILE', 'LIWAN_VENDOR_ADMIN_ENV_FILE'):
        empty = workdir / f'{variable}.env'
        empty.write_text('')
        env[variable] = str(empty)
    command = ['docker', 'compose']
    for name in files:
        command += ['-f', name]
    command += ['--env-file', str(TEMPLATE), 'config', '--format', 'json']
    done = subprocess.run(command, cwd=DEPLOY, env=env, capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise AssertionError(f'render failed: {done.stderr.strip()[:600]}')
    return json.loads(done.stdout)


def _ports(rendered: dict) -> dict[str, list[dict]]:
    return {name: service['ports'] for name, service in rendered['services'].items() if 'ports' in service}


class HostLinkOverlay(unittest.TestCase):
    def test_it_publishes_only_the_tenant_database_on_loopback_on_its_own_network(self):
        overlay = yaml.safe_load(HOST_LINK.read_text(encoding='utf-8'))
        self.assertEqual(['db'], list(overlay['services']))
        self.assertEqual(['127.0.0.1:${LIWAN_DB_HOST_PORT:-15433}:5432'], overlay['services']['db']['ports'])
        self.assertEqual(['db_host'], overlay['services']['db']['networks'])
        self.assertEqual(['db_host'], list(overlay['networks']))
        self.assertNotIn('internal', overlay['networks']['db_host'])
        self.assertEqual({'com.docker.network.bridge.name': BRIDGE, 'com.docker.network.bridge.enable_ip_masquerade': 'false'},
                         overlay['networks']['db_host']['driver_opts'])

    @unittest.skipIf(shutil.which('docker') is None, 'docker CLI not installed: cannot render the compose set')
    def test_merged_stack_gains_one_loopback_port_and_keeps_the_internal_network(self):
        with tempfile.TemporaryDirectory() as tmp:
            before = _render(Path(tmp), BASE_STACK)
            after = _render(Path(tmp), SHARED_COMPOSE_FILES)
        self.assertNotIn('db', _ports(before))
        self.assertEqual(_ports(before), {name: ports for name, ports in _ports(after).items() if name != 'db'})
        self.assertEqual([('127.0.0.1', '15433', 5432)],
                         [(port['host_ip'], port['published'], port['target']) for port in _ports(after)['db']])
        self.assertEqual({'database', 'db_host'}, set(after['services']['db']['networks']))
        self.assertTrue(after['networks']['database']['internal'])
        self.assertEqual(BRIDGE, after['networks']['db_host']['driver_opts']['com.docker.network.bridge.name'])
        self.assertEqual('false', after['networks']['db_host']['driver_opts']['com.docker.network.bridge.enable_ip_masquerade'])


@unittest.skipIf(shutil.which('openssl') is None, 'openssl not installed: cannot create the host certificates')
class InitHost(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve() / 'liwan-staging'
        self.config, self.state = self.root / 'control/config', self.root / 'control/state'
        self.private, self.registry = self.root / 'control/private', self.root / 'state/registry'
        self.ai_platform = self.state / 'ai-platform'
        self.env_file = Path(self.tmp.name) / 'staging.env'
        self.env_file.write_text('\n'.join([
            f'LIWAN_CONTROL_CONFIG_DIR={self.config}', f'LIWAN_CONTROL_STATE_DIR={self.state}',
            f'LIWAN_CONTROL_PRIVATE_DIR={self.private}', f'LIWAN_TENANT_REGISTRY_DIR={self.registry}',
            f'LIWAN_AI_PLATFORM_DIR={self.ai_platform}',
            f'LIWAN_SHARED_COMPOSE_FILE={self.root}/shared.compose.json', f'LIWAN_SHARED_ENV_FILE={self.root}/shared.env',
            f'LIWAN_RESTORE_DOMAIN={RESTORE_DOMAIN}', f'LIWAN_CONTROL_UID={os.getuid()}',
            f'LIWAN_CONTROL_GID={pwd.getpwuid(os.getuid()).pw_gid}', '']))

    def run_script(self, *args: str, check: bool = True, env: dict | None = None) -> subprocess.CompletedProcess:
        account = pwd.getpwuid(os.getuid())
        env = {**os.environ, 'LIWAN_WORKER_USER': account.pw_name, 'LIWAN_AI_GID': str(account.pw_gid), **(env or {})}
        done = subprocess.run(['bash', str(INIT_HOST), *(args or (str(self.env_file), PROJECT))], env=env,
                              capture_output=True, text=True, timeout=60)
        if check:
            self.assertEqual(0, done.returncode, done.stderr)
        return done

    def certificate_text(self, name: str) -> str:
        return subprocess.run(['openssl', 'x509', '-in', str(self.private / name), '-noout', '-text'],
                              capture_output=True, text=True, check=True).stdout

    def test_creates_the_config_files_with_the_keys_the_control_plane_reads(self):
        self.run_script()
        runtime = json.loads((self.config / 'shared-runtime.json').read_text())
        self.assertEqual({'schemaVersion': 1, 'projectName': PROJECT, 'composeFile': f'{self.root}/shared.compose.json',
                          'envFile': f'{self.root}/shared.env', 'stateDir': str(self.state),
                          'domainSuffix': RESTORE_DOMAIN}, runtime)
        self.assertEqual({'version': 2, 'targets': {}}, json.loads((self.config / 'inventory-v2.json').read_text()))
        self.assertTrue(self.registry.is_dir() and self.state.is_dir())

    @unittest.skipIf(shutil.which('node') is None, 'node not installed: cannot run the registry reader')
    def test_a_bootstrap_registry_is_created_that_the_real_reader_accepts_and_is_kept_afterwards(self):
        # The guard refuses to start without a registry file and the control plane writes one only on the first tenant
        # change, so a fresh host needs the deny-all snapshot. Mode 0644 is REGISTRY_FILE_MODE in registry-publisher.ts.
        path = self.registry / 'registry.json'
        first = self.run_script()
        self.assertIn(f'created {path}', first.stdout)
        self.assertEqual({'schemaVersion': 1, 'snapshotRevision': 0, 'targets': []}, json.loads(path.read_text()))
        self.assertEqual(0o644, stat.S_IMODE(path.stat().st_mode))
        reader = "import { readTenantRegistry } from './apps/web/server/utils/tenantRegistry.ts'; process.stdout.write(JSON.stringify(readTenantRegistry(process.argv[1])))"
        read = subprocess.run(['node', '--input-type=module', '-e', reader, str(path)], cwd=DEPLOY.parent,
                              capture_output=True, text=True, timeout=60)
        self.assertEqual(0, read.returncode, read.stderr)
        self.assertEqual([], json.loads(read.stdout)['targets'])
        path.write_text('{"schemaVersion":1,"snapshotRevision":3,"targets":[]}\n')
        second = self.run_script()
        self.assertIn(f'kept    {path}', second.stdout)
        self.assertEqual(3, json.loads(path.read_text())['snapshotRevision'])

    def test_the_ai_platform_directory_is_created_empty_setgid_and_kept_afterwards(self):
        # 2750: the control plane writes platform-provider.json 0640 as the worker (store.ts FILE_MODE); the setgid bit gives
        # it the directory's group, which is the `ai` container user's gid (10001; the test passes the account's own gid).
        self.run_script()
        self.assertEqual(0o2750, stat.S_IMODE(self.ai_platform.stat().st_mode))
        self.assertEqual(os.getgid(), self.ai_platform.stat().st_gid)
        self.assertEqual([], list(self.ai_platform.iterdir()))
        second = self.run_script()
        self.assertIn(f'kept    {self.ai_platform}', second.stdout)
        self.assertEqual(0o2750, stat.S_IMODE(self.ai_platform.stat().st_mode))
        self.assertEqual([], list(self.ai_platform.iterdir()))

    def test_an_existing_ai_platform_directory_of_the_wrong_mode_is_refused_with_the_fix(self):
        # Docker makes a missing bind-mount source root:root 0755; a hand-made one is often 0755 or 2770 too
        for mode in (0o755, 0o750, 0o2770, 0o2755):
            with self.subTest(mode=oct(mode)):
                self.ai_platform.mkdir(parents=True, exist_ok=True)
                self.ai_platform.chmod(mode)
                done = self.run_script(check=False)
                self.assertEqual(2, done.returncode)
                self.assertIn(f'Refusing: {self.ai_platform} is owner:group:mode', done.stderr)
                self.assertIn(f'chown {pwd.getpwuid(os.getuid()).pw_name}:{os.getgid()} {self.ai_platform} && chmod 2750 {self.ai_platform}',
                              done.stderr)
                self.assertEqual(mode, stat.S_IMODE(self.ai_platform.stat().st_mode))  # never changed

    def test_an_existing_ai_platform_directory_of_another_group_is_refused(self):
        self.run_script()
        done = self.run_script(check=False, env={'LIWAN_AI_GID': str(os.getgid() + 1)})
        self.assertEqual(2, done.returncode)
        self.assertIn(f'must be {os.getuid()}:{os.getgid() + 1}:2750', done.stderr)

    @unittest.skipIf(os.getuid() == 0, 'as root the group can always be set')
    def test_a_group_the_worker_cannot_set_stops_the_script_and_leaves_no_directory(self):
        foreign = next(gid for gid in range(60000, 60100) if gid not in os.getgroups())
        done = self.run_script(check=False, env={'LIWAN_AI_GID': str(foreign)})
        self.assertEqual(2, done.returncode)
        self.assertIn(f'Cannot give {self.ai_platform} to group {foreign}', done.stderr)
        self.assertFalse(self.ai_platform.exists())

    @unittest.skipIf(os.getuid() == 0 or 10001 in os.getgroups(), 'needs an account outside group 10001')
    def test_the_ai_group_defaults_to_10001_the_gid_of_the_ai_container_user(self):
        done = self.run_script(check=False, env={'LIWAN_AI_GID': ''})  # empty counts as unset
        self.assertEqual(2, done.returncode)
        self.assertIn(f'Cannot give {self.ai_platform} to group 10001', done.stderr)

    def test_a_missing_or_relative_ai_platform_directory_is_refused(self):
        original = self.env_file.read_text()
        line = f'LIWAN_AI_PLATFORM_DIR={self.ai_platform}'
        for replacement in ('', 'LIWAN_AI_PLATFORM_DIR=relative/ai', 'LIWAN_AI_PLATFORM_DIR=REPLACE_WITH_DIR'):
            with self.subTest(replacement=replacement):
                self.env_file.write_text(original.replace(line, replacement))
                done = self.run_script(check=False)
                self.assertEqual(2, done.returncode)
                self.assertIn('LIWAN_AI_PLATFORM_DIR', done.stderr)
                self.assertFalse(self.ai_platform.exists())

    def test_registry_directory_is_readable_by_the_other_container_users(self):
        self.run_script()
        self.assertEqual(0o755, stat.S_IMODE(self.registry.stat().st_mode))

    def test_an_existing_registry_directory_that_others_cannot_read_is_refused(self):
        self.registry.mkdir(parents=True, mode=0o750)
        self.registry.chmod(0o750)
        done = self.run_script(check=False)
        self.assertEqual(2, done.returncode)
        self.assertIn('Refusing', done.stderr)
        self.assertEqual(0o750, stat.S_IMODE(self.registry.stat().st_mode))

    def test_certificates_carry_the_required_names_and_chain_to_the_private_ca(self):
        self.run_script()
        for name, san in (('control-tls.crt', 'control-api'), ('effect-tls.crt', 'control-host.internal')):
            with self.subTest(certificate=name):
                self.assertEqual([san], re.findall(r'DNS:([A-Za-z0-9.-]+)', self.certificate_text(name)))
                verified = subprocess.run(['openssl', 'verify', '-CAfile', str(self.private / 'control-ca.pem'),
                                           str(self.private / name)], capture_output=True, text=True)
                self.assertEqual(0, verified.returncode, verified.stdout + verified.stderr)

    def test_private_files_have_the_modes_their_readers_need(self):
        self.run_script()
        modes = {name: stat.S_IMODE((self.private / name).stat().st_mode) for name in PRIVATE_FILES}
        self.assertEqual({'control-ca.key': 0o600, 'control-ca.pem': 0o644, 'control-tls.key': 0o600,
                          'control-tls.crt': 0o644, 'effect-tls.key': 0o600, 'effect-tls.crt': 0o644,
                          'control-db-password': 0o444}, modes)
        self.assertEqual(0o750, stat.S_IMODE(self.private.stat().st_mode))
        self.assertRegex((self.private / 'control-db-password').read_text(), r'^[0-9a-f]{64}\n$')

    def test_second_run_changes_nothing_and_prints_no_secret(self):
        first = self.run_script()
        snapshot = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in self.root.rglob('*') if path.is_file()}
        second = self.run_script()
        self.assertEqual(snapshot, {path: (path.read_bytes(), path.stat().st_mtime_ns)
                                    for path in self.root.rglob('*') if path.is_file()})
        self.assertNotIn('created', second.stdout)
        secret = (self.private / 'control-db-password').read_text().strip()
        self.assertNotIn(secret, first.stdout + first.stderr + second.stdout + second.stderr)

    def test_half_present_certificate_pair_is_refused(self):
        self.run_script()
        (self.private / 'effect-tls.crt').unlink()
        done = self.run_script(check=False)
        self.assertEqual(2, done.returncode)
        self.assertIn('effect-tls', done.stderr)

    def test_a_failed_signing_prints_its_error_and_leaves_no_partial_pair(self):
        self.run_script()
        for name in ('effect-tls.key', 'effect-tls.crt'):
            (self.private / name).unlink()
        (self.private / 'control-ca.key').write_text('not a key\n')
        done = self.run_script(check=False)
        self.assertNotEqual(0, done.returncode)
        self.assertNotEqual('', done.stderr.strip())
        self.assertFalse((self.private / 'effect-tls.key').exists() or (self.private / 'effect-tls.crt').exists())
        self.assertEqual([], list(self.private.glob('.init.*')))

    def test_a_certificate_close_to_its_end_is_reported_not_replaced(self):
        first = self.run_script()
        self.assertNotIn('warning:', first.stderr)
        key, cert = self.private / 'effect-tls.key', self.private / 'effect-tls.crt'
        request = Path(self.tmp.name) / 'short.csr'
        subprocess.run(['openssl', 'req', '-new', '-key', str(key), '-subj', '/CN=control-host.internal',
                        '-out', str(request)], check=True, capture_output=True)
        subprocess.run(['openssl', 'x509', '-req', '-in', str(request), '-CAkey', str(self.private / 'control-ca.key'),
                        '-CA', str(self.private / 'control-ca.pem'), '-set_serial', '0x1', '-days', '10', '-out', str(cert)],
                       check=True, capture_output=True)
        short = cert.read_bytes()
        done = self.run_script()
        self.assertIn('warning:', done.stderr)
        self.assertIn('effect-tls.crt', done.stderr)
        self.assertEqual(short, cert.read_bytes())

    def test_worker_ids_that_are_placeholders_or_not_the_accounts_are_refused(self):
        account = pwd.getpwuid(os.getuid())
        original = self.env_file.read_text()
        for variable, value in (('LIWAN_CONTROL_UID', 'REPLACE_WITH_WORKER_UID'), ('LIWAN_CONTROL_UID', str(account.pw_uid + 1)),
                                ('LIWAN_CONTROL_GID', 'REPLACE_WITH_WORKER_GID'), ('LIWAN_CONTROL_GID', str(account.pw_gid + 1))):
            with self.subTest(variable=variable, value=value):
                current = {'LIWAN_CONTROL_UID': account.pw_uid, 'LIWAN_CONTROL_GID': account.pw_gid}[variable]
                self.env_file.write_text(original.replace(f'{variable}={current}', f'{variable}={value}'))
                done = self.run_script(check=False)
                self.assertEqual(2, done.returncode)
                self.assertIn(variable, done.stderr)
                self.assertFalse(self.root.exists())

    def test_database_password_goes_to_the_postgres_user_when_run_as_root(self):
        stubs = Path(self.tmp.name) / 'stubs'
        stubs.mkdir()
        log = Path(self.tmp.name) / 'chown.log'
        real_id = shutil.which('id')
        (stubs / 'id').write_text(f'#!/bin/sh\nif [ "$#" = 1 ] && [ "$1" = "-u" ]; then echo 0; exit 0; fi\nexec {real_id} "$@"\n')
        (stubs / 'chown').write_text(f'#!/bin/sh\necho "$@" >> {log}\n')
        for stub in stubs.iterdir():
            stub.chmod(0o755)
        self.run_script(env={'PATH': f'{stubs}:{os.environ["PATH"]}', 'LIWAN_EFFECT_USER': pwd.getpwuid(os.getuid()).pw_name,
                             'LIWAN_ROOT_UID': str(os.getuid()), 'LIWAN_DOCKER_CONFIG_DIR': str(Path(self.tmp.name) / 'etc-liwan-docker')})
        group = subprocess.run([shutil.which('id'), '-gn'], capture_output=True, text=True, check=True).stdout.strip()
        # The file is made under an unpredictable name and handed over with chown -h before the no-clobber rename into place.
        self.assertTrue(any(re.fullmatch(rf'-h 999:{group} {re.escape(str(self.private))}/\.init\.[0-9a-f]{{16}}', line)
                            for line in log.read_text().splitlines()), log.read_text())
        self.assertEqual(0o400, stat.S_IMODE((self.private / 'control-db-password').stat().st_mode))

    def run_as_stubbed_root(self, extra_env: dict | None = None, check: bool = True) -> tuple[subprocess.CompletedProcess, list[str], Path]:
        """Run the script as if root: `id -u` prints 0 and `chown` only logs its arguments; chmod and mkdir are real."""
        stubs = Path(self.tmp.name) / 'root-stubs'
        stubs.mkdir(exist_ok=True)
        log = Path(self.tmp.name) / 'root-chown.log'
        docker_dir = Path(self.tmp.name) / 'etc-liwan-docker'
        real_id = shutil.which('id')
        (stubs / 'id').write_text(f'#!/bin/sh\nif [ "$#" = 1 ] && [ "$1" = "-u" ]; then echo 0; exit 0; fi\nexec {real_id} "$@"\n')
        (stubs / 'chown').write_text(f'#!/bin/sh\necho "$@" >> {log}\n')
        for stub in stubs.iterdir():
            stub.chmod(0o755)
        account = pwd.getpwuid(os.getuid()).pw_name
        # The files the script makes belong to the test account, which therefore stands in for root (LIWAN_ROOT_UID); a test that needs
        # a file of a less trusted owner passes another uid.
        env = {'PATH': f'{stubs}:{os.environ["PATH"]}', 'LIWAN_EFFECT_USER': account, 'LIWAN_DOCKER_CONFIG_DIR': str(docker_dir),
               'LIWAN_ROOT_UID': str(os.getuid()), **(extra_env or {})}
        done = self.run_script(env=env, check=check)
        return done, (log.read_text().splitlines() if log.exists() else []), docker_dir

    def test_as_root_the_effect_boundary_owners_and_modes_are_applied(self):
        # docs/operations/environment-bringup.md A3.2: the gate trusts only root-owned inputs, the effect account owns what it
        # writes, backups/ is readable by the worker group and writable by nobody but the effect account, and shared.env belongs to the docker group the worker is not in.
        shared_env = self.root / 'shared.env'
        self.root.mkdir(parents=True)
        shared_env.write_text('X=1\n')
        shared_env.chmod(0o600)
        done, chowns, docker_dir = self.run_as_stubbed_root()
        group = subprocess.run([shutil.which('id'), '-gn'], capture_output=True, text=True, check=True).stdout.strip()
        account = pwd.getpwuid(os.getuid()).pw_name
        mode = lambda path: stat.S_IMODE(path.stat().st_mode)  # noqa: E731
        self.assertEqual(0o750, mode(self.config))
        self.assertEqual(0o640, mode(self.config / 'shared-runtime.json'))
        self.assertEqual(0o640, mode(self.config / 'inventory-v2.json'))
        self.assertEqual(0o3770, mode(self.state))
        self.assertEqual(0o640, mode(shared_env))
        for path in (self.config, self.state):
            self.assertIn(f'-h root:{group} {path}', chowns)
        # The config files are made inside the settled directory, handed to root with chown -h under a temporary name, then renamed.
        handed = [line for line in chowns if re.fullmatch(rf'-h root:{group} {re.escape(str(self.config))}/\.init\.[0-9a-f]{{16}}', line)]
        self.assertEqual(2, len(handed), chowns)
        self.assertIn(f'-h root:docker {shared_env}', chowns)
        modes = {'reservations': 0o700, 'credentials': 0o700, 'classifications': 0o755, 'restore-effects': 0o700,
                 'reconfigure': 0o700, 'runtime-gate-history': 0o700, 'backups': 0o750}
        for name, expected in modes.items():
            with self.subTest(directory=name):
                self.assertEqual(expected, mode(self.state / name))
                self.assertIn(f'-h {account}:{group} {self.state / name}', chowns)
        # The effect account owns restore-registry: in the sticky state directory the owner of an entry may rename it, so a worker-owned
        # one could be swapped for a link that dockerd follows. The worker (group) writes files in it.
        self.assertEqual(0o775, mode(self.state / 'restore-registry'))
        self.assertIn(f'-h {account}:{group} {self.state / "restore-registry"}', chowns)
        self.assertEqual({}, json.loads((docker_dir / 'config.json').read_text()))
        self.assertIn(f'-h root:root {docker_dir / "config.json"}', chowns)
        self.assertEqual(0o644, mode(docker_dir / 'config.json'))
        self.assertIn(f'created {docker_dir / "config.json"}', done.stdout)

    def test_as_root_a_second_run_keeps_the_effect_directories_and_their_content(self):
        self.run_as_stubbed_root()
        marker = self.state / 'reservations' / 'a'
        marker.write_text('x')
        (self.state / 'backups').chmod(0o700)
        done, _, docker_dir = self.run_as_stubbed_root()
        self.assertEqual('x', marker.read_text())
        self.assertEqual(0o700, stat.S_IMODE((self.state / 'backups').stat().st_mode))  # an existing directory is never changed
        self.assertIn(f'kept    {self.state / "backups"}', done.stdout)
        self.assertIn(f'kept    {docker_dir / "config.json"}', done.stdout)

    def refused_as_root(self, fragment: str) -> subprocess.CompletedProcess:
        done, _, _ = self.run_as_stubbed_root(check=False)
        self.assertEqual(2, done.returncode, done.stdout + done.stderr)
        self.assertIn(fragment, done.stderr)
        return done

    def test_as_root_a_symlinked_config_file_is_refused_and_its_target_left_alone(self):
        self.run_as_stubbed_root()
        target = Path(self.tmp.name) / 'victim'
        target.write_text('x')
        target.chmod(0o600)
        (self.config / 'inventory-v2.json').unlink()
        (self.config / 'inventory-v2.json').symlink_to(target)
        self.refused_as_root('is a symbolic link')
        self.assertEqual(0o600, stat.S_IMODE(target.stat().st_mode))
        self.assertEqual('x', target.read_text())

    def test_as_root_a_symlinked_effect_subdirectory_is_refused_and_its_target_left_alone(self):
        self.run_as_stubbed_root()
        target = Path(self.tmp.name) / 'victim-dir'
        target.mkdir()
        target.chmod(0o777)
        (self.state / 'credentials').rmdir()
        (self.state / 'credentials').symlink_to(target)
        self.refused_as_root(f'{self.state / "credentials"} is a symbolic link')
        self.assertEqual(0o777, stat.S_IMODE(target.stat().st_mode))

    def test_as_root_a_symlinked_config_directory_or_parent_is_refused(self):
        target = Path(self.tmp.name) / 'elsewhere'
        target.mkdir()
        target.chmod(0o755)  # explicit: mkdir's mode is cut by the umask other tests leave behind
        self.config.parent.mkdir(parents=True)
        self.config.symlink_to(target)
        self.refused_as_root(f'{self.config} is a symbolic link')
        self.assertEqual(0o755, stat.S_IMODE(target.stat().st_mode))
        self.config.unlink()
        moved = self.config.parent.with_name('control-real')
        self.config.parent.rename(moved)
        self.config.parent.symlink_to(moved)
        self.refused_as_root(f'{self.config.parent} is a symbolic link')

    def test_as_root_a_config_file_the_worker_could_write_is_refused_when_its_content_is_not_what_the_script_writes(self):
        self.run_as_stubbed_root()
        runtime = self.config / 'shared-runtime.json'
        runtime.write_text(runtime.read_text().replace(PROJECT, 'liwan-shared-planted'))
        runtime.chmod(0o660)
        self.refused_as_root('Review it')
        self.assertIn('liwan-shared-planted', runtime.read_text())
        self.assertEqual(0o660, stat.S_IMODE(runtime.stat().st_mode))  # never blessed as it stands

    def test_as_root_a_writable_config_file_with_the_expected_content_is_replaced_by_a_fresh_root_copy(self):
        self.run_as_stubbed_root()
        runtime = self.config / 'shared-runtime.json'
        before = runtime.stat().st_ino
        runtime.chmod(0o660)
        done, chowns, _ = self.run_as_stubbed_root()
        self.assertIn(f'replaced {runtime}', done.stdout)
        self.assertEqual(0o640, stat.S_IMODE(runtime.stat().st_mode))
        self.assertNotEqual(before, runtime.stat().st_ino)  # a new inode: a descriptor the worker holds writes nowhere
        self.assertEqual(PROJECT, json.loads(runtime.read_text())['projectName'])
        self.assertEqual([], [name for name in os.listdir(self.config) if name.startswith('.init.')])

    def test_as_root_a_config_file_owned_by_another_uid_is_not_trusted(self):
        self.run_as_stubbed_root()
        inventory = self.config / 'inventory-v2.json'
        inventory.write_text('{"version":2,"targets":{"a":{}}}\n')
        done, _, _ = self.run_as_stubbed_root(extra_env={'LIWAN_ROOT_UID': str(os.getuid() + 7)}, check=False)
        self.assertEqual(2, done.returncode)
        self.assertIn('must be owned by root', done.stderr)  # the directory that holds it is not root's either

    def test_as_root_a_writable_existing_effect_directory_or_shared_env_is_refused_for_review(self):
        self.run_as_stubbed_root()
        (self.state / 'backups').chmod(0o770)
        self.refused_as_root('review its content')
        (self.state / 'backups').chmod(0o750)
        shared_env = self.root / 'shared.env'
        shared_env.write_text('X=1\n')
        shared_env.chmod(0o660)
        self.refused_as_root(f'{shared_env} is not owned by root or is writable')
        self.assertEqual(0o660, stat.S_IMODE(shared_env.stat().st_mode))

    def test_as_root_a_shared_env_or_docker_config_that_is_a_symlink_or_writable_is_refused(self):
        self.root.mkdir(parents=True)
        victim = Path(self.tmp.name) / 'victim-env'
        victim.write_text('X=1\n')
        victim.chmod(0o600)
        (self.root / 'shared.env').symlink_to(victim)
        self.refused_as_root(f'{self.root / "shared.env"} is a symbolic link')
        self.assertEqual(0o600, stat.S_IMODE(victim.stat().st_mode))
        (self.root / 'shared.env').unlink()
        docker_dir = Path(self.tmp.name) / 'etc-liwan-docker'
        docker_dir.mkdir()
        (docker_dir / 'config.json').write_text('{"credsStore":"x"}')
        (docker_dir / 'config.json').chmod(0o666)
        self.refused_as_root('can name a program the docker client runs')

    def test_as_root_a_missing_effect_account_stops_the_script_before_anything_is_made(self):
        stubs = Path(self.tmp.name) / 'root-stubs'
        stubs.mkdir()
        real_id = shutil.which('id')
        (stubs / 'id').write_text(f'#!/bin/sh\nif [ "$#" = 1 ] && [ "$1" = "-u" ]; then echo 0; exit 0; fi\nexec {real_id} "$@"\n')
        (stubs / 'id').chmod(0o755)
        done = self.run_script(check=False, env={'PATH': f'{stubs}:{os.environ["PATH"]}', 'LIWAN_EFFECT_USER': 'liwan-no-such-effect-account'})
        self.assertEqual(2, done.returncode)
        self.assertIn('The effect account does not exist: liwan-no-such-effect-account', done.stderr)
        self.assertFalse(self.root.exists())

    def test_as_the_worker_itself_no_effect_directory_is_made(self):
        self.run_script()
        for name in ('reservations', 'credentials', 'classifications', 'backups'):
            self.assertFalse((self.state / name).exists())
        self.assertEqual(0o750, stat.S_IMODE(self.state.stat().st_mode))
        self.assertEqual(0o640, stat.S_IMODE((self.config / 'shared-runtime.json').stat().st_mode))

    def test_missing_or_placeholder_variable_is_refused(self):
        self.env_file.write_text(self.env_file.read_text().replace(RESTORE_DOMAIN, 'REPLACE_WITH_RESTORE_DOMAIN'))
        done = self.run_script(check=False)
        self.assertEqual(2, done.returncode)
        self.assertIn('LIWAN_RESTORE_DOMAIN', done.stderr)
        self.assertFalse(self.root.exists())

    def test_a_dangling_symlink_planted_in_a_worker_owned_directory_is_not_written_through(self):
        # Tester finding: the registry and private directories belong to the worker, and `write_file` runs `cat >` and then
        # chmod/chown on the path as root. `[[ -e ]]` is false for a dangling link, so the link is followed: root creates and
        # hands to the worker (or uid 999) a file at any path the worker names. Both must be refused like the other links.
        self.run_script()
        for planted in (self.registry / 'registry.json', self.private / 'control-db-password'):
            planted.unlink()
            target = Path(self.tmp.name) / ('elsewhere-' + planted.name)
            planted.symlink_to(target)
            done = self.run_script(check=False)
            self.assertFalse(target.exists(), f'{planted} was written through to {target}')
            self.assertNotEqual(0, done.returncode)
            planted.unlink()
            target.unlink(missing_ok=True)
            self.run_script()

    def test_a_symlink_in_place_of_a_managed_directory_is_refused_even_to_a_directory(self):
        self.run_script()
        for name in ('registry', 'private', 'ai_platform'):
            directory = getattr(self, name)
            moved = Path(self.tmp.name) / f'moved-{name}'
            directory.rename(moved)
            directory.symlink_to(moved)
            done = self.run_script(check=False)
            self.assertNotEqual(0, done.returncode, name)
            self.assertIn('symbolic link', done.stderr)
            directory.unlink()
            moved.rename(directory)

    def test_a_symlink_in_place_of_restore_registry_is_refused_as_root(self):
        self.run_as_stubbed_root()
        link = self.state / 'restore-registry'
        link.rmdir()
        elsewhere = Path(self.tmp.name) / 'elsewhere'
        elsewhere.mkdir()
        link.symlink_to(elsewhere)
        done, _, _ = self.run_as_stubbed_root(check=False)
        self.assertNotEqual(0, done.returncode)
        self.assertIn('symbolic link', done.stderr)
        self.assertEqual([], list(elsewhere.iterdir()))

    def test_no_work_file_is_left_in_a_worker_directory(self):
        self.run_script()
        for directory in (self.registry, self.private, self.config):
            self.assertEqual([], [path.name for path in directory.iterdir() if path.name.startswith('.init.')], directory)


if __name__ == '__main__':
    unittest.main()
