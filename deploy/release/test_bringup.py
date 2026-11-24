from __future__ import annotations

import configparser
import contextlib
import io
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from deploy.release import bringup
from deploy.release.release import Paths

HERE = Path(bringup.__file__).resolve().parent
REAL_STACK_COMPOSE = (HERE.parent / 'stack' / 'compose.yml').read_text(encoding='utf-8')
SECRET = 'SECRET-TOKEN-VALUE-0123456789'
COMMIT = 'a' * 40
TAG_COMMIT = 'c' * 40
SRV = '/srv/liwan-staging'
CONFIG = '/etc/liwan-release/staging.env'
# A4.7a: the signing key and the directory the edge serves; the shared env file names the same directory.
PROOF_KEY = '/etc/liwan-release/staging-release-proof.key'
PROOF_DIR = f'{SRV}/release-proof'
PROOF_URL = 'https://app.staging.example.test/_liwan/release-proof/'
CONFIG_TEXT = (f'LIWAN_RELEASE_PROJECT=liwan-shared-staging\nLIWAN_SHARED_ENV_FILE={SRV}/shared.env\n'
               'LIWAN_RELEASE_PG_DUMP=/usr/bin/pg_dump\nLIWAN_RELEASE_PG_HOST=127.0.0.1\n'
               'LIWAN_RELEASE_CONTROL_PG_HOST=127.0.0.1\nLIWAN_RELEASE_ODOO_DATA_DIR=/var/lib/docker/volumes/x/_data\n'
               f'LIWAN_RELEASE_DISK_PATH=/var/lib/docker\nPGPASSFILE=/etc/liwan-release/pgpass\n'
               f'LIWAN_RELEASE_PROOF_KEY_FILE={PROOF_KEY}\nLIWAN_RELEASE_PROOF_DIR={PROOF_DIR}\n')
USAGE_KEY = 'ab' * 32
SHARED_TEXT = (f'LIWAN_CONTROL_CONFIG_DIR={SRV}/control/config\nLIWAN_CONTROL_PRIVATE_DIR={SRV}/control/private\n'
               f'LIWAN_TENANT_REGISTRY_DIR={SRV}/state/registry\nLIWAN_AI_PLATFORM_DIR={SRV}/control/state/ai-platform\n'
               f'LIWAN_SHARED_COMPOSE_FILE={SRV}/shared.compose.json\nDB_PASSWORD=runtime-pass\nDB_ADMIN_PASSWORD=admin-pass\n'
               f'LIWAN_AI_USAGE_KEY={USAGE_KEY}\nLIWAN_TENANT_STORAGE_FILES_DIR={SRV}/control/tenant-storage\n'
               f'LIWAN_RELEASE_PROOF_DIR={PROOF_DIR}\n')
CREDENTIAL_TEXT = f'LIWAN_GHCR_READ_USER=reader\nLIWAN_GHCR_READ_TOKEN={SECRET}\nLIWAN_GITHUB_READ_TOKEN={SECRET}\n'
GIB = 1024 ** 3
SS_HEADER = 'State Recv-Q Send-Q Local Address:Port Peer Address:Port'
SYSTEMD = '/etc/systemd/system'
STATE = '/var/lib/liwan-release/staging'
# The fake's scratch directory: a capability probe writes here and nothing it writes is kept or reused.
SCRATCH = '/scratch/docker-config'
# The three rules of A3.6, as the arguments after the chain name.
FIREWALL_RULES = [
    ['DOCKER-USER', '-i', 'liwan-dbhost', '-m', 'conntrack', '--ctstate', 'NEW', '-j', 'DROP'],
    ['INPUT', '-i', 'liwan-dbhost', '-m', 'conntrack', '--ctstate', 'NEW', '-j', 'DROP'],
    ['INPUT', '-s', '172.29.40.0/24', '-d', '172.29.40.1', '-p', 'tcp', '--dport', '4188', '-m', 'conntrack', '--ctstate',
     'NEW', '-j', 'ACCEPT'],
]


def entry(kind: int, mode: int, uid: int = 0, gid: int = 0, text: str = '', target: str = '') -> SimpleNamespace:
    return SimpleNamespace(st_mode=kind | mode, st_uid=uid, st_gid=gid, text=text, target=target)


def directory(mode: int = 0o755, uid: int = 0, gid: int = 0):
    return entry(stat.S_IFDIR, mode, uid, gid)


def regular(mode: int = 0o644, uid: int = 0, gid: int = 0, text: str = ''):
    return entry(stat.S_IFREG, mode, uid, gid, text)


def symlink_entry(target: str):
    return entry(stat.S_IFLNK, 0o777, target=target)


class FakeHost:
    """A machine in a dict. ``mutations`` lists every change made, so a test can prove a run changed nothing."""

    def __init__(self, euid: int = 0):
        self._euid = euid
        self.files: dict[str, SimpleNamespace] = {}
        self.users: dict[str, tuple[int, int]] = {}
        self.groups: dict[str, list] = {'root': [0, []]}
        self.enabled: set[str] = set()
        self.active: set[str] = set()
        self.tags = f'{TAG_COMMIT}\trefs/tags/release/19.0.1.0.0\n'
        self.scopes = (200, {'x-oauth-scopes': 'read:packages'})
        self.https: list[tuple[str, str]] = []
        self.versions: dict[str, str] = {}
        self.firewall = False
        self.mutations: list[str] = []
        self.calls: list[list[str]] = []
        self.envs: list[dict] = []
        self.stdins: list[str | None] = []
        self.overrides: list = []  # (predicate(argv), (code, output)) answered before everything else
        self.disk: dict[str, tuple[int, int]] = {}
        self.memory = (12 * GIB, 4 * GIB)
        # A host whose openssl can make and use an Ed25519 key; an empty host is the one that may lack it.
        self.openssl_ed25519 = False

    # --- reads
    def euid(self):
        return self._euid

    def lstat(self, path):
        return self.files.get(str(path))

    def readlink(self, path):
        return self.files[str(path)].target

    def listdir(self, path):
        prefix = str(path).rstrip('/') + '/'
        return [key[len(prefix):] for key in self.files if key.startswith(prefix) and '/' not in key[len(prefix):]]

    def read_text(self, path):
        self.undecodable(path)
        return self.files[str(path)].text

    def read_bytes(self, path):
        if str(path) not in self.files:
            raise FileNotFoundError(str(path))
        return self.files[str(path)].text.encode('utf-8')

    def realpath(self, path):
        parts = Path(os.path.normpath(str(path))).parts
        current = Path(parts[0])
        for part in parts[1:]:
            current = current / part
            entry = self.files.get(str(current))
            if entry is not None and stat.S_ISLNK(entry.st_mode):
                target = Path(entry.target)
                current = target if target.is_absolute() else Path(os.path.normpath(str(current.parent / target)))
        return os.path.normpath(str(current))

    def undecodable(self, path):
        if getattr(self.files[str(path)], 'undecodable', False):
            raise bringup.ItemError(f'{path} is not valid UTF-8 text')

    def read_env(self, path):
        self.undecodable(path)
        pairs = (line.split('=', 1) for line in self.files[str(path)].text.splitlines() if '=' in line)
        return {key: value for key, value in pairs}

    def https_headers(self, url, token):
        self.https.append((url, token))
        return self.scopes

    def user(self, name):
        return self.users.get(name)

    def group(self, name):
        found = self.groups.get(name)
        return None if found is None else (found[0], list(found[1]))

    def disk_usage(self, path):
        return self.disk.get(str(path), (100, 50))

    def meminfo(self):
        return self.memory

    @contextlib.contextmanager
    def scratch_dir(self):
        try:
            yield SCRATCH
        finally:
            for key in [k for k in self.files if k.startswith(f'{SCRATCH}/')]:
                del self.files[key]

    # --- changes
    def make_dir(self, path, mode, uid, gid):
        self.mutations.append(f'make_dir {path}')
        self.files[str(path)] = directory(mode, uid, gid)

    def write_new(self, path, text, mode):
        self.mutations.append(f'write_new {path}')
        if str(path) in self.files:
            raise FileExistsError(str(path))
        self.files[str(path)] = regular(mode, text=text)

    def chown(self, path, uid, gid):
        self.mutations.append(f'chown {path}')
        self.files[str(path)].st_uid, self.files[str(path)].st_gid = uid, gid

    def chmod(self, path, mode):
        self.mutations.append(f'chmod {path}')
        self.files[str(path)].st_mode = stat.S_IFREG | mode

    def symlink(self, target, link):
        self.mutations.append(f'symlink {link}')
        self.files[str(link)] = symlink_entry(target)

    def run(self, argv, env=None, cwd=None, stdin=None):
        self.calls.append(list(argv))
        self.envs.append(dict(env or {}))
        self.stdins.append(stdin)
        for matches, result in self.overrides:
            if matches(argv):
                return result
        command = argv[0]
        if command == 'useradd':
            self.mutations.append('useradd')
            self.users[argv[-1]] = (990, 990)
            self.groups[argv[-1]] = [990, []]
        elif command == 'usermod':
            self.mutations.append('usermod')
            self.groups[argv[2]][1].append(argv[3])
        elif command == 'gpasswd':
            self.mutations.append('gpasswd')
            self.groups[argv[3]][1].remove(argv[2])
        elif command == 'systemctl':
            return self.systemctl(argv)
        elif command == 'sh':
            return self.firewall_script(argv)
        elif command.endswith('init-host.sh'):
            self.init_host(argv)
        elif command == 'openssl':
            return self.openssl(argv)
        elif argv[1:] == ['--version']:
            return (0, self.versions[command]) if command in self.versions else (127, '')
        elif command == 'git':
            return self.git(argv)
        return 0, ''

    def git(self, argv):
        if 'rev-parse' in argv:
            return 0, COMMIT + '\n'
        if 'ls-remote' in argv and '--tags' in argv:
            return 0, self.tags
        if 'push' in argv:
            if '--dry-run' not in argv:
                self.mutations.append('real push')
            return 1, f'remote: Permission to x denied to y.\nfatal: unable to access: The requested URL returned error: 403 {SECRET}'
        return 0, ''

    def systemctl(self, argv):
        if argv[1] == 'is-enabled':
            return (0, 'enabled\n') if argv[2] in self.enabled else (1, 'disabled\n')
        if argv[1] == 'is-active':
            return (0, 'active\n') if argv[2] in self.active else (3, 'inactive\n')
        self.mutations.append(' '.join(argv))
        if argv[1] == 'enable':
            self.enabled.add(argv[-1])
            if '--now' in argv:
                self.active.add(argv[-1])
        return 0, ''

    def firewall_script(self, argv):
        if argv[-1] == '--check':
            return (0, '') if self.firewall else (1, '')
        self.mutations.append('firewall')
        self.firewall = True
        return 0, ''

    def init_host(self, argv):
        self.mutations.append('init-host')
        shared = self.read_env(argv[1])
        for key, names in bringup.INIT_HOST_FILES.items():
            for name in names:
                self.files[f'{shared[key]}/{name}'] = regular(0o640)
        for key in bringup.INIT_HOST_DIRS:
            self.files[shared[key]] = directory(0o2750)

    def openssl(self, argv):
        """Ed25519 support, and a `-out` path that holds a made thing; scratch files never record host mutations."""
        if not self.openssl_ed25519:
            return 1, 'Algorithm ED25519 not found\n'
        out = argv[argv.index('-out') + 1] if '-out' in argv else ''
        source = argv[argv.index('-in') + 1] if '-in' in argv else ''
        entry = self.files.get(source) if source else None
        if 'genpkey' in argv:
            content = 'openssl-made'
        elif 'pkey' in argv and '-outform' in argv:
            # DER names the key, not the text it is stored in: a private key's public half is the `pub:` body its .pub holds
            if entry is None:
                return 1, 'Unable to load key\n'
            body = entry.text.replace('\r\n', '\n').strip()
            content = 'der:' + (body if body.startswith('pub:') else 'pub:' + body)
        elif 'pkey' in argv and '-pubout' in argv:
            if entry is None and not source.startswith(SCRATCH):
                return 1, 'Unable to load key\n'
            content = f'pub:{entry.text}' if entry is not None else 'pub:probe'
        else:
            content = 'openssl-sig'
        if out:
            if out.startswith(SCRATCH):
                self.files[out] = regular(0o644, text=content)
            else:
                self.write_new(out, content, 0o644)
        return 0, ''


def seeded_host(euid: int = 0) -> FakeHost:
    """A host that a human prepared up to the hand-written files; everything the tool may create is still missing."""
    host = FakeHost(euid)
    host.groups['docker'] = [999, ['ubuntu']]
    host.files['/etc/liwan-release'] = directory(0o700)
    host.files[CONFIG] = regular(0o600, text=CONFIG_TEXT)
    host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT)
    host.files['/etc/liwan-release/github-read'] = regular(0o600, text=CREDENTIAL_TEXT)
    host.files[f'/opt/liwan/releases/{COMMIT}'] = directory()
    host.files['/opt/liwan/current/deploy/control-plane/init-host.sh'] = regular(0o755)  # as seen through the link
    host.files['/opt/liwan/current/deploy/stack/compose.yml'] = regular(0o644, text=REAL_STACK_COMPOSE)
    host.versions = {'node': 'v22.3.0', 'npm': '10.8.1', 'pg_dump': 'pg_dump (PostgreSQL) 16.4', 'git': 'git version 2.43.0',
                     'python3': 'Python 3.12.3'}
    host.openssl_ed25519 = True
    return host


def run(host, *argv, registry=None):
    out = io.StringIO()
    code = bringup.main(['--environment', 'staging', *argv], out=out, host=host, registry=registry)
    return code, out.getvalue().splitlines()


def statuses(lines):
    return {line.split()[1].rstrip(':'): line.split()[0] for line in lines if not line.startswith('RESULT')}


class BringupTest(unittest.TestCase):
    def test_check_only_on_empty_host_lists_every_item_missing(self):
        host = FakeHost()
        code, lines = run(host)
        names = [item.name for item in bringup.REGISTRY if not item.post_run]
        self.assertEqual(1, code)
        self.assertEqual({'MISSING'}, set(statuses(lines).values()))
        self.assertEqual(names, list(statuses(lines)))
        self.assertEqual(f'RESULT: bringup incomplete {len(names)}', lines[-1])
        self.assertEqual([], host.mutations)

    def test_apply_on_empty_host_creates_what_it_may_and_reports_the_rest(self):
        host = FakeHost()
        host.groups['docker'] = [999, ['ubuntu']]
        code, lines = run(host, '--apply')
        found = statuses(lines)
        self.assertEqual(1, code)
        for name in ('worker-user', 'firewall-rules', 'firewall-unit', 'shared-worker-unit'):
            self.assertEqual('created', found[name], name)
        for name in ('release-config', 'directories', 'current-checkout', 'read-credential-file'):
            self.assertEqual('MISSING', found[name], name)
        self.assertEqual(['liwan-worker'], host.groups['docker'][1])

    def test_second_apply_changes_nothing(self):
        host = seeded_host()
        code, first = run(host, '--apply')
        self.assertEqual((0, 'RESULT: bringup ok'), (code, first[-1]))
        created = {name for name, status in statuses(first).items() if status == 'created'}
        self.assertTrue({'worker-user', 'directories', 'current-checkout', 'init-host', 'firewall-rules', 'firewall-unit',
                         'shared-worker-unit'} <= created)
        self.assertEqual(f'/opt/liwan/releases/{COMMIT}', host.files['/opt/liwan/current'].target)
        host.mutations.clear()
        code, second = run(host, '--apply')
        self.assertEqual(0, code)
        self.assertEqual({'ok'}, set(statuses(second).values()))
        self.assertEqual([], host.mutations)

    def test_check_only_never_mutates(self):
        host = seeded_host()
        run(host)
        self.assertEqual([], host.mutations)

    def test_directories_get_the_modes_of_a3_3(self):
        host = seeded_host()
        run(host, '--apply')
        self.assertEqual(0o700, stat.S_IMODE(host.files['/var/lib/liwan-release/staging'].st_mode))
        control = host.files[f'{SRV}/control']
        self.assertEqual((0o750, 0, 990), (stat.S_IMODE(control.st_mode), control.st_uid, control.st_gid))

    def test_symlink_at_a_directory_path_fails_without_touching_anything(self):
        host = seeded_host()
        host.users['liwan-worker'], host.groups['liwan-worker'] = (990, 990), [990, []]
        host.files[f'{SRV}/config'] = symlink_entry('/etc')
        code, lines = run(host, '--apply')
        self.assertEqual('FAILED', statuses(lines)['directories'])
        self.assertIn(f'{SRV}/config is a symlink', ' '.join(lines))
        self.assertEqual([], [m for m in host.mutations if m.startswith('make_dir')])
        self.assertEqual(symlink_entry('/etc').target, host.files[f'{SRV}/config'].target)

    def test_symlink_at_the_credential_path_fails(self):
        host = seeded_host()
        host.files['/etc/liwan-release/github-read'] = symlink_entry('/etc/shadow')
        _, lines = run(host, '--apply')
        found = statuses(lines)
        self.assertEqual('FAILED', found['read-credential-file'])
        self.assertEqual('FAILED', found['read-credential-access'])
        self.assertFalse([m for m in host.mutations if 'github-read' in m])
        self.assertFalse([call for call in host.calls if 'ls-remote' in call])

    def test_wrong_mode_of_an_existing_directory_is_reported_not_changed(self):
        host = seeded_host()
        host.users['liwan-worker'], host.groups['liwan-worker'] = (990, 990), [990, []]
        host.files['/opt/liwan/releases'] = directory(0o777)
        _, lines = run(host, '--apply')
        self.assertEqual('MISSING', statuses(lines)['directories'])
        self.assertEqual(0o777, stat.S_IMODE(host.files['/opt/liwan/releases'].st_mode))

    def test_a_current_link_pointing_elsewhere_is_reported_not_replaced(self):
        host = seeded_host()
        host.files['/opt/liwan/current'] = symlink_entry('/somewhere/else')
        _, lines = run(host, '--apply')
        self.assertEqual('MISSING', statuses(lines)['current-checkout'])
        self.assertEqual('/somewhere/else', host.files['/opt/liwan/current'].target)

    def test_a_real_directory_at_current_fails(self):
        host = seeded_host()
        host.files['/opt/liwan/current'] = directory()
        _, lines = run(host, '--apply')
        self.assertEqual('FAILED', statuses(lines)['current-checkout'])

    def test_two_bootstrap_checkouts_are_not_guessed(self):
        host = seeded_host()
        host.files[f'/opt/liwan/releases/{"b" * 40}'] = directory()
        run(host, '--apply')
        self.assertNotIn('/opt/liwan/current', host.files)

    def test_a_current_link_to_an_existing_directory_outside_releases_is_reported_as_outside(self):
        host = seeded_host()
        host.files['/elsewhere'] = directory()
        host.files['/opt/liwan/current'] = symlink_entry('/elsewhere')
        _, lines = run(host)
        self.assertTrue(line_of(lines, 'current-checkout').startswith('MISSING'))
        self.assertIn('outside /opt/liwan/releases', line_of(lines, 'current-checkout'))

    def test_a_single_candidate_that_is_not_a_real_directory_is_not_linked(self):
        for name, candidate in {'file': regular(), 'symlink': symlink_entry('/etc')}.items():
            with self.subTest(name):
                host = seeded_host()
                host.files[f'/opt/liwan/releases/{COMMIT}'] = candidate
                _, lines = run(host, '--apply')
                self.assertEqual('FAILED', statuses(lines)['current-checkout'])
                self.assertNotIn('/opt/liwan/current', host.files)
                self.assertNotIn('symlink /opt/liwan/current', host.mutations)

    def test_credential_that_can_write_is_refused(self):
        host = seeded_host()
        host.overrides.append((lambda argv: 'push' in argv, (0, '')))
        _, lines = run(host)
        self.assertEqual('MISSING', statuses(lines)['read-credential-access'])

    def test_apply_without_root_exits_2(self):
        host = seeded_host(euid=1000)
        code, lines = run(host, '--apply')
        self.assertEqual((2, ['bringup: --apply needs root']), (code, lines))
        self.assertEqual([], host.calls)

    def test_a_malformed_environment_name_is_refused(self):
        out = io.StringIO()
        code = bringup.main(['--environment', '../development'], out=out, host=FakeHost())
        self.assertEqual(2, code)
        self.assertEqual(1, len(out.getvalue().splitlines()))

    def test_no_output_line_carries_a_secret(self):
        host = seeded_host()
        _, first = run(host, '--apply', '--post-run')
        _, second = run(host, '--post-run')
        for line in first + second:
            self.assertNotIn(SECRET, line)
            self.assertNotIn('shared.env:', line)

    def test_post_run_items_only_with_the_flag(self):
        host = seeded_host()
        _, without = run(host)
        _, with_flag = run(host, '--post-run')
        post = [item.name for item in bringup.REGISTRY if item.post_run]
        self.assertFalse(set(post) & set(statuses(without)))
        self.assertTrue(set(post) <= set(statuses(with_flag)))

    def test_post_run_listener_check_flags_a_wildcard_bind(self):
        host = seeded_host()
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + 'LIWAN_EDGE_BIND=127.0.0.1\n'
                                                  'LIWAN_EDGE_HTTP_PORT=18080\n')
        host.overrides.append((lambda argv: argv[0] == 'ss', (0, f'{SS_HEADER}\nLISTEN 0 4096 0.0.0.0:18080 0.0.0.0:*\n')))
        _, lines = run(host, '--post-run')
        line = next(line for line in lines if 'post-run-listeners' in line)
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn('0.0.0.0:18080', line)

    def test_the_runner_is_registry_driven(self):
        calls = []

        def check(ctx):
            calls.append(ctx.environment)
            return bringup.OK

        extra = bringup.Item('custom-item', check, 'never shown')
        code, lines = run(FakeHost(), registry=[extra])
        self.assertEqual((0, ['ok custom-item', 'RESULT: bringup ok']), (code, lines))
        self.assertEqual(['staging'], calls)

    def test_an_item_that_needs_apply_is_applied_once(self):
        def make(state):
            return bringup.Item('late', lambda ctx: bringup.OK if state['done'] else bringup.missing('x'), 'm',
                                lambda ctx: state.update(done=True))

        self.assertEqual(['created late', 'RESULT: bringup ok'], run(FakeHost(), '--apply', registry=[make({'done': False})])[1])
        self.assertEqual(['MISSING late: m (x)', 'RESULT: bringup incomplete 1'],
                         run(FakeHost(), registry=[make({'done': False})])[1])

    def test_no_branching_on_the_environment_name(self):
        source = (HERE / 'bringup.py').read_text(encoding='utf-8')
        self.assertIsNone(re.search(r"(==|!=|\bin\b)\s*\(?['\"](staging|production)['\"]", source))
        self.assertIsNone(re.search(r"environment\s*(==|!=)", source))

    def test_paths_default_to_the_release_command_paths(self):
        paths = Paths()
        self.assertEqual('/opt/liwan/current', str(paths.current))


class FirewallFilesTest(unittest.TestCase):
    def test_script_ensures_the_three_rules_of_a3_6_and_checks_before_inserting(self):
        text = (HERE / 'liwan-firewall.sh').read_text(encoding='utf-8')
        found = [line.split()[1:] for line in text.splitlines() if line.startswith('ensure ')]
        self.assertEqual(FIREWALL_RULES, found)
        self.assertLess(text.index('iptables -w 5 -C'), text.index('iptables -w 5 -I'))
        self.assertNotIn('iptables -A', text)
        calls = [line for line in text.splitlines() if re.search(r'\biptables -', line) and not line.startswith('#')]
        self.assertTrue(calls)
        self.assertTrue(all('iptables -w 5 ' in line for line in calls), calls)
        self.assertNotRegex(text, r'(?m)^set -[a-z]*e')

    def run_script(self, *args, fail_chain='', present=False):
        with tempfile.TemporaryDirectory() as tmp:
            stub = Path(tmp) / 'iptables'
            stub.write_text('#!/bin/sh\necho "$*" >> "$STUB_LOG"\n'
                            'case "$*" in *"$STUB_FAIL_CHAIN"*) [ -n "$STUB_FAIL_CHAIN" ] && exit 1 ;; esac\n'
                            'case "$*" in *" -C "*) [ "$STUB_PRESENT" = 1 ] && exit 0; exit 1 ;; esac\nexit 0\n', encoding='utf-8')
            stub.chmod(0o755)
            log = Path(tmp) / 'log'
            env = {'PATH': f'{tmp}:/usr/bin:/bin', 'STUB_LOG': str(log), 'STUB_FAIL_CHAIN': fail_chain,
                   'STUB_PRESENT': '1' if present else '0'}
            done = subprocess.run(['sh', str(HERE / 'liwan-firewall.sh'), *args], env=env, capture_output=True, text=True,
                                  check=False)
            return done, log.read_text(encoding='utf-8').splitlines() if log.exists() else []

    def test_every_rule_is_attempted_and_a_failure_is_reported_at_the_end(self):
        done, log = self.run_script(fail_chain='DOCKER-USER')
        inserts = [line for line in log if ' -I ' in line]
        self.assertEqual(['-w 5 -I DOCKER-USER', '-w 5 -I INPUT', '-w 5 -I INPUT'], [' '.join(line.split()[:4]) for line in inserts])
        self.assertEqual(1, done.returncode)
        self.assertIn('failed: DOCKER-USER', done.stderr)
        self.assertTrue(all(line.startswith('-w 5 ') for line in log))

    def test_script_exits_zero_when_every_rule_is_present_and_adds_nothing(self):
        done, log = self.run_script(present=True)
        self.assertEqual(0, done.returncode)
        self.assertEqual([], [line for line in log if ' -I ' in line])

    def test_check_mode_lists_absent_rules_and_inserts_nothing(self):
        done, log = self.run_script('--check')
        self.assertEqual(1, done.returncode)
        self.assertEqual(3, done.stdout.count('absent:'))
        self.assertEqual([], [line for line in log if ' -I ' in line])

    def test_unit_is_a_oneshot_after_and_part_of_docker(self):
        unit = configparser.ConfigParser(strict=False, interpolation=None)
        unit.read(HERE / 'liwan-firewall.service', encoding='utf-8')
        self.assertEqual('oneshot', unit['Service']['Type'])
        self.assertEqual('/bin/sh /opt/liwan/current/deploy/release/liwan-firewall.sh', unit['Service']['ExecStart'])
        self.assertEqual('docker.service', unit['Unit']['After'])
        self.assertEqual('docker.service', unit['Unit']['PartOf'])
        self.assertNotIn('Wants', unit['Unit'])
        self.assertEqual('multi-user.target', unit['Install']['WantedBy'])

    def test_unit_script_path_is_this_directory(self):
        self.assertTrue((HERE / 'liwan-firewall.sh').is_file())
        self.assertEqual('deploy/release', HERE.relative_to(bringup.ROOT).as_posix())


def line_of(lines, name):
    return next(line for line in lines if line.split()[1].rstrip(':') == name)


def with_config(host, extra='', **replace):
    text = CONFIG_TEXT
    for old, new in replace.items():
        text = text.replace(old, new)
    host.files[CONFIG] = regular(0o600, text=text + extra)


class Recorder:
    """An output stream that remembers which lines were flushed when."""

    def __init__(self):
        self.pending, self.flushed = [], []

    def write(self, text):
        self.pending.append(text)

    def flush(self):
        self.flushed, self.pending = self.flushed + self.pending, []


class ReportingTest(unittest.TestCase):
    def test_undecodable_config_fails_the_item_and_the_run_continues(self):
        host = seeded_host()
        host.files[CONFIG].undecodable = True
        code, lines = run(host)
        self.assertEqual('FAILED', statuses(lines)['release-config'])
        self.assertIn(f'{CONFIG} is not valid UTF-8 text', line_of(lines, 'release-config'))
        self.assertEqual('ok', statuses(lines)['package-git'])
        self.assertEqual((1, True), (code, lines[-1].startswith('RESULT: bringup incomplete')))

    def test_undecodable_shared_env_fails_the_item_that_needs_it(self):
        host = seeded_host()
        host.files[f'{SRV}/shared.env'].undecodable = True
        _, lines = run(host)
        self.assertEqual('FAILED', statuses(lines)['init-host'])
        self.assertIn('is not valid UTF-8 text', line_of(lines, 'init-host'))

    def test_non_integer_size_keys_fail_without_echoing_the_value(self):
        host = seeded_host()
        with_config(host, 'LIWAN_BRINGUP_MIN_MEMORY_MIB=12GB\nLIWAN_BRINGUP_MIN_SWAP_MIB=lots\n')
        _, lines = run(host)
        found = statuses(lines)
        self.assertEqual(('FAILED', 'FAILED', 'ok'), (found['memory'], found['swap'], found['disk']))
        self.assertIn('LIWAN_BRINGUP_MIN_MEMORY_MIB must be a whole number', line_of(lines, 'memory'))
        self.assertNotIn('12GB', ' '.join(lines))
        self.assertNotIn('lots', ' '.join(lines))

    def test_each_line_is_flushed_when_its_item_finishes_and_a_crash_costs_one_item(self):
        out, seen = Recorder(), []

        def crash(ctx):
            seen.append(list(out.flushed))
            raise RuntimeError(SECRET)

        items = [bringup.Item('first', lambda ctx: bringup.OK, 'm'), bringup.Item('crash', crash, 'm'),
                 bringup.Item('last', lambda ctx: bringup.OK, 'm')]
        code = bringup.main(['--environment', 'staging'], out=out, host=FakeHost(), registry=items)
        self.assertEqual(['ok first\n'], seen[0])
        self.assertEqual(['ok first\n', 'FAILED crash: unexpected RuntimeError\n', 'ok last\n', 'RESULT: bringup incomplete 1\n'],
                         out.flushed)
        self.assertEqual(1, code)
        self.assertNotIn(SECRET, ''.join(out.flushed))

    def test_failed_command_names_the_command_but_never_its_output(self):
        host = seeded_host()
        host.overrides.append((lambda argv: argv[0] == 'useradd', (1, SECRET)))
        _, lines = run(host, '--apply', '--post-run')
        line = line_of(lines, 'worker-user')
        self.assertTrue(line.startswith('FAILED worker-user: useradd exited 1; run it by hand to see the reason: useradd --system'))
        self.assertNotIn(SECRET, '\n'.join(lines))

    def test_secret_in_command_output_or_exception_text_never_reaches_stdout(self):
        host = seeded_host()
        host.overrides = [(lambda argv: 'ls-remote' in argv, (1, SECRET)), (lambda argv: argv[0] == 'ss', (1, SECRET)),
                          (lambda argv: argv[0] == 'docker' and 'ps' in argv, (1, SECRET))]
        _, lines = run(host, '--apply', '--post-run')
        crash = bringup.Item('crash', lambda ctx: (_ for _ in ()).throw(ValueError(SECRET)), 'm')
        _, more = run(host, registry=[crash])
        self.assertNotIn(SECRET, '\n'.join(lines + more))
        self.assertEqual('FAILED crash: unexpected ValueError', more[0])


class SafetyTest(unittest.TestCase):
    def test_a_differing_firewall_unit_is_left_alone_and_reported_once(self):
        host = seeded_host()
        host.files[f'{SYSTEMD}/liwan-firewall.service'] = regular(0o644, text='old')
        _, lines = run(host, '--apply')
        self.assertEqual(1, sum(1 for line in lines if ' firewall-unit' in line))
        self.assertIn(f'{SYSTEMD}/liwan-firewall.service differs from', line_of(lines, 'firewall-unit'))
        self.assertTrue(line_of(lines, 'firewall-unit').startswith('MISSING'))
        self.assertNotIn('systemctl enable liwan-firewall.service', host.mutations)
        self.assertNotIn(f'write_new {SYSTEMD}/liwan-firewall.service', host.mutations)
        self.assertEqual(1, host.mutations.count('systemctl daemon-reload'))  # the worker unit's own
        self.assertEqual('old', host.files[f'{SYSTEMD}/liwan-firewall.service'].text)

    def test_an_installed_worker_unit_is_enabled_without_being_rewritten(self):
        host = seeded_host()
        host.files[f'{SYSTEMD}/liwan-shared-worker.service'] = regular(0o644, text='adjusted prefix')
        _, lines = run(host, '--apply')
        self.assertEqual('created', statuses(lines)['shared-worker-unit'])
        self.assertNotIn(f'write_new {SYSTEMD}/liwan-shared-worker.service', host.mutations)
        self.assertEqual('adjusted prefix', host.files[f'{SYSTEMD}/liwan-shared-worker.service'].text)

    def test_only_the_firewall_unit_is_started_on_apply(self):
        host = seeded_host()
        run(host, '--apply')
        self.assertIn('systemctl enable --now liwan-firewall.service', host.mutations)
        self.assertIn('systemctl enable liwan-shared-worker.service', host.mutations)
        self.assertNotIn('systemctl enable --now liwan-shared-worker.service', host.mutations)
        self.assertEqual({'liwan-firewall.service'}, host.active)

    def test_an_enabled_but_inactive_firewall_unit_is_missing_then_started_by_apply(self):
        host = seeded_host()
        run(host, '--apply')
        host.active.clear()
        host.mutations.clear()
        _, lines = run(host)
        self.assertTrue(line_of(lines, 'firewall-unit').startswith('MISSING'))
        self.assertIn('is not active', line_of(lines, 'firewall-unit'))
        self.assertEqual('ok', statuses(lines)['shared-worker-unit'])  # never required to be active
        self.assertEqual([], host.mutations)
        _, lines = run(host, '--apply')
        self.assertEqual('created', statuses(lines)['firewall-unit'])
        self.assertIn('liwan-firewall.service', host.active)

    def test_units_are_written_with_mode_0644(self):
        host = seeded_host()
        run(host, '--apply')
        for unit in ('liwan-firewall.service', 'liwan-shared-worker.service'):
            self.assertEqual(0o644, stat.S_IMODE(host.files[f'{SYSTEMD}/{unit}'].st_mode), unit)

    def init_outputs(self, host, only=None):
        for key, names in bringup.INIT_HOST_FILES.items():
            for name in names:
                if only is None or name in only:
                    host.files[f'{SRV}/{ {"LIWAN_CONTROL_CONFIG_DIR": "control/config", "LIWAN_CONTROL_PRIVATE_DIR": "control/private", "LIWAN_TENANT_REGISTRY_DIR": "state/registry"}[key] }/{name}'] = regular(0o640)

    def test_init_host_does_not_run_once_a_release_was_served(self):
        host = seeded_host()
        host.files[f'{STATE}/served.json'] = regular(0o600, text='{}')
        _, lines = run(host, '--apply')
        self.assertNotIn('init-host', host.mutations)
        line = line_of(lines, 'init-host')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn('shared-runtime.json', line)
        self.assertIn(f'run as root: /opt/liwan/current/deploy/control-plane/init-host.sh {SRV}/shared.env liwan-shared-staging', line)

    def test_init_host_does_not_run_when_only_some_outputs_exist(self):
        host = seeded_host()
        self.init_outputs(host, only={'shared-runtime.json'})
        _, lines = run(host, '--apply')
        line = line_of(lines, 'init-host')
        self.assertNotIn('init-host', host.mutations)
        self.assertIn('registry.json', line)
        self.assertNotIn(f'{SRV}/control/config/shared-runtime.json,', line)
        self.assertIn('run as root:', line)

    def test_shared_env_must_be_a_regular_file_and_not_a_symlink(self):
        host = seeded_host()
        host.files[f'{SRV}/shared.env'] = symlink_entry('/etc/passwd')
        _, lines = run(host, '--apply')
        self.assertEqual('FAILED', statuses(lines)['init-host'])
        self.assertNotIn('init-host', host.mutations)

    def test_a_0640_root_docker_or_a_0600_root_shared_env_is_accepted(self):
        """A4.1: 640 root:docker is the documented state, because the effect account reads it through the docker group."""
        cases = {'0640 root:docker': regular(0o640, gid=999, text=SHARED_TEXT),
                 '0600 root:root': regular(0o600, text=SHARED_TEXT)}
        for name, entry_ in cases.items():
            with self.subTest(name):
                host = seeded_host()
                host.files[f'{SRV}/shared.env'] = entry_
                run(host, '--apply')
                _, lines = run(host)
                self.assertEqual('ok', statuses(lines)['init-host'])
                self.assertEqual('ok', statuses(lines)['shared-db-passwords'])
                self.assertEqual('ok', statuses(lines)['shared-ai-usage-key'])

    def test_a_shared_env_group_readable_by_a_group_that_does_not_need_it_is_refused(self):
        host = seeded_host()
        host.files[f'{SRV}/shared.env'] = regular(0o640, gid=1000, text=SHARED_TEXT)
        _, lines = run(host)
        self.assertEqual('FAILED', statuses(lines)['init-host'])
        self.assertIn('a group other than root or docker', line_of(lines, 'init-host'))

    def test_a_shared_env_writable_by_group_or_other_owned_by_a_stranger_or_readable_by_other_is_refused(self):
        cases = {'0660 group writable': regular(0o660, gid=999, text=SHARED_TEXT),
                 '0664 group and other writable': regular(0o664, gid=999, text=SHARED_TEXT),
                 '0602 other writable': regular(0o602, text=SHARED_TEXT),
                 '0644 readable by other': regular(0o644, text=SHARED_TEXT),
                 'foreign owner': regular(0o600, uid=1000, text=SHARED_TEXT)}
        for name, entry_ in cases.items():
            with self.subTest(name):
                host = seeded_host()
                host.files[f'{SRV}/shared.env'] = entry_
                _, lines = run(host, '--apply')
                found = statuses(lines)
                self.assertEqual('FAILED', found['init-host'])
                self.assertEqual('FAILED', found['shared-ai-usage-key'])
                self.assertIn(f'{SRV}/shared.env must be owned by root or {bringup.WORKER_USER}', line_of(lines, 'init-host'))
                self.assertNotIn('init-host', host.mutations)

    def test_a_worker_owned_private_shared_env_is_accepted(self):
        host = seeded_host()
        run(host, '--apply')
        host.files[f'{SRV}/shared.env'] = regular(0o600, uid=990, gid=990, text=SHARED_TEXT)
        _, lines = run(host)
        self.assertEqual('ok', statuses(lines)['init-host'])

    def test_release_config_must_be_0600_and_root_owned(self):
        for name, entry_ in {'mode': regular(0o644, text=CONFIG_TEXT), 'owner': regular(0o600, uid=1000, text=CONFIG_TEXT)}.items():
            with self.subTest(name):
                host = seeded_host()
                host.files[CONFIG] = entry_
                _, lines = run(host)
                self.assertTrue(line_of(lines, 'release-config').startswith('MISSING'))
                self.assertIn('mode 0600 and owned by root', line_of(lines, 'release-config'))

    def test_credential_file_must_be_0600_and_root_owned_before_anything_reads_it(self):
        for name, entry_ in {'mode': regular(0o644, text=CREDENTIAL_TEXT), 'owner': regular(0o600, uid=1000, text=CREDENTIAL_TEXT)}.items():
            with self.subTest(name):
                host = seeded_host()
                host.files['/etc/liwan-release/github-read'] = entry_
                _, lines = run(host)
                found = statuses(lines)
                self.assertEqual(('MISSING', 'MISSING'), (found['read-credential-file'], found['read-credential-access']))
                self.assertFalse([call for call in host.calls if 'ls-remote' in call or 'login' in call])

    def test_extra_docker_group_members_are_reported_and_only_the_image_user_is_removed(self):
        host = seeded_host()
        host.users['liwan-worker'] = (990, 990)
        host.groups['docker'] = [999, ['liwan-worker', 'ubuntu', 'bob']]
        _, lines = run(host)
        self.assertIn('also lists ubuntu, bob', line_of(lines, 'worker-user'))
        _, lines = run(host, '--apply')
        self.assertTrue(line_of(lines, 'worker-user').startswith('MISSING'))
        self.assertIn('also lists bob', line_of(lines, 'worker-user'))
        self.assertEqual(['liwan-worker', 'bob'], host.groups['docker'][1])


class ThresholdTest(unittest.TestCase):
    def status(self, host, name):
        return statuses(run(host)[1])[name]

    def test_disk_alert_is_70_percent_on_each_path_including_var_lib_docker(self):
        host = seeded_host()
        with_config(host, **{'LIWAN_RELEASE_DISK_PATH=/var/lib/docker': 'LIWAN_RELEASE_DISK_PATH=/data'})
        self.assertEqual('ok', self.status(host, 'disk'))
        host.disk['/var/lib/docker'] = (100, 31)
        self.assertEqual('ok', self.status(host, 'disk'))
        host.disk['/var/lib/docker'] = (100, 30)
        self.assertEqual('MISSING', self.status(host, 'disk'))
        host.disk = {'/data': (100, 30)}
        self.assertEqual('MISSING', self.status(host, 'disk'))
        host.disk = {SRV: (100, 5)}
        self.assertEqual('MISSING', self.status(host, 'disk'))

    def test_memory_and_swap_have_minimums_and_the_config_may_override_them(self):
        host = seeded_host()
        host.memory = (10 * GIB, 4 * GIB)
        self.assertEqual(('MISSING', 'ok'), (self.status(host, 'memory'), self.status(host, 'swap')))
        host.memory = (12 * GIB, 3 * GIB)
        self.assertEqual(('ok', 'MISSING'), (self.status(host, 'memory'), self.status(host, 'swap')))
        host.memory = (12 * GIB, 0)
        self.assertEqual('MISSING', self.status(host, 'swap'))
        with_config(host, 'LIWAN_BRINGUP_MIN_SWAP_MIB=0\nLIWAN_BRINGUP_MIN_MEMORY_MIB=1000\n')
        host.memory = (2 * GIB, 0)
        self.assertEqual(('ok', 'ok'), (self.status(host, 'memory'), self.status(host, 'swap')))


class CredentialProbeTest(unittest.TestCase):
    def test_the_probe_only_ever_dry_runs_and_no_token_is_in_an_argument(self):
        host = seeded_host()
        run(host, '--apply')
        pushes = [call for call in host.calls if 'push' in call]
        self.assertTrue(pushes)
        self.assertTrue(all('--dry-run' in call for call in pushes))
        self.assertNotIn('real push', host.mutations)
        self.assertEqual([], [call for call in host.calls if SECRET in ' '.join(call)])
        self.assertIn(SECRET + '\n', host.stdins)
        self.assertTrue(any(env.get('LIWAN_GITHUB_READ_TOKEN') == SECRET for env in host.envs))

    def test_the_read_token_inspects_one_release_document_without_pulling_or_removing(self):
        host = seeded_host()
        run(host)
        image = f'ghcr.io/tariiq222/liwan-release:{TAG_COMMIT}'
        inspect = host.calls.index(['docker', 'manifest', 'inspect', image])
        self.assertEqual('/scratch/docker-config', host.envs[inspect]['DOCKER_CONFIG'])
        self.assertEqual([], [call for call in host.calls if 'pull' in call or 'rmi' in call])
        self.assertEqual([], [call for call in host.calls if SECRET in ' '.join(call)])
        login = host.calls.index(['docker', 'login', 'ghcr.io', '--username', 'reader', '--password-stdin'])
        self.assertEqual(SECRET + '\n', host.stdins[login])
        self.assertEqual('/scratch/docker-config', host.envs[login]['DOCKER_CONFIG'])

    def test_a_registry_refusal_is_reported(self):
        for command, text in (('login', 'cannot log in'), ('manifest', 'either the release document of')):
            with self.subTest(command):
                host = seeded_host()
                host.overrides.append((lambda argv, command=command: argv[:2] == ['docker', command], (1, SECRET)))
                _, lines = run(host)
                self.assertTrue(line_of(lines, 'read-credential-access').startswith('MISSING'))
                self.assertIn(text, line_of(lines, 'read-credential-access'))

    def test_only_an_authorization_refusal_proves_the_token_cannot_write(self):
        host = seeded_host()
        self.assertEqual('ok', statuses(run(host)[1])['read-credential-access'])
        host.overrides.append((lambda argv: 'push' in argv, (1, f'fatal: Could not resolve host: github.com {SECRET}')))
        _, lines = run(host)
        self.assertEqual('FAILED read-credential-access: write probe inconclusive', line_of(lines, 'read-credential-access'))
        self.assertNotIn(SECRET, '\n'.join(lines))
        host.overrides[0] = (lambda argv: 'push' in argv, (0, ''))
        self.assertEqual('MISSING', statuses(run(host)[1])['read-credential-access'])


class ReadCredentialAccessTest(unittest.TestCase):
    def access(self, host):
        return statuses(run(host)[1])['read-credential-access']

    def ghcr_only(self, host):
        text = f'LIWAN_GHCR_READ_USER=reader\nLIWAN_GHCR_READ_TOKEN={SECRET}\n'
        host.files['/etc/liwan-release/github-read'] = regular(0o600, text=text)

    def test_a_file_with_the_ghcr_keys_only_and_read_only_scopes_is_ok_without_a_git_probe(self):
        host = seeded_host()
        self.ghcr_only(host)
        self.assertEqual('ok', self.access(host))
        self.assertEqual([], [call for call in host.calls if 'push' in call])
        self.assertFalse([env for env in host.envs if 'LIWAN_GITHUB_READ_TOKEN' in env])
        self.assertEqual([('https://api.github.com/user', SECRET)], host.https)

    def test_a_write_scope_on_the_registry_token_is_refused(self):
        for header in ('read:packages, write:packages', 'repo', ''):
            with self.subTest(header):
                host = seeded_host()
                self.ghcr_only(host)
                host.scopes = (200, {'x-oauth-scopes': header})
                self.assertEqual('MISSING', self.access(host))

    def test_a_missing_scope_header_or_a_refused_token_is_not_ok(self):
        for response in ((200, {}), (401, {'x-oauth-scopes': 'read:packages'})):
            with self.subTest(response):
                host = seeded_host()
                host.scopes = response
                self.assertEqual('MISSING', self.access(host))

    def test_with_the_git_token_a_refused_write_is_ok_and_an_accepted_one_is_not(self):
        host = seeded_host()
        self.assertEqual('ok', self.access(host))
        self.assertTrue([call for call in host.calls if 'push' in call])
        host.overrides.append((lambda argv: 'push' in argv, (0, '')))
        self.assertEqual('MISSING', self.access(host))

    def test_no_token_is_in_any_argument(self):
        host = seeded_host()
        self.access(host)
        self.assertEqual([], [call for call in host.calls if SECRET in ' '.join(call)])

    def test_the_image_of_the_release_tag_commit_is_inspected(self):
        host = seeded_host()
        self.access(host)
        self.assertIn(['docker', 'manifest', 'inspect', f'ghcr.io/tariiq222/liwan-release:{TAG_COMMIT}'], host.calls)
        self.assertNotIn(['docker', 'manifest', 'inspect', f'ghcr.io/tariiq222/liwan-release:{COMMIT}'], host.calls)

    def test_the_highest_tag_wins_by_number_and_a_peeled_line_names_the_commit(self):
        host = seeded_host()
        host.tags = (f'{"1" * 40}\trefs/tags/release/19.0.1.9.0\n{"2" * 40}\trefs/tags/release/19.0.1.10.0\n'
                     f'{"3" * 40}\trefs/tags/release/19.0.1.10.0^{{}}\n{"4" * 40}\trefs/tags/other\n')
        self.access(host)
        self.assertIn(['docker', 'manifest', 'inspect', f'ghcr.io/tariiq222/liwan-release:{"3" * 40}'], host.calls)

    def test_no_release_tag_yet_is_reported_as_a_missing_release_document(self):
        host = seeded_host()
        host.tags = ''
        _, lines = run(host)
        line = line_of(lines, 'read-credential-access')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn('no release document exists yet', line)
        self.assertNotIn('cannot', line)
        self.assertEqual([], [call for call in host.calls if call[:2] == ['docker', 'manifest']])


class PostRunTest(unittest.TestCase):
    def post_host(self, extra=''):
        host = seeded_host()
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + extra)
        return host

    def restore(self, host, wget, ss=(0, f'{SS_HEADER}\nLISTEN 0 4096 0.0.0.0:80 0.0.0.0:*\n')):
        host.overrides = [(lambda argv: 'wget' in argv, wget), (lambda argv: 'ss' in argv, ss)]
        return statuses(run(host, '--post-run')[1])['post-run-restore-route']

    def test_restore_route_needs_a_404_status_line_and_no_443_listener(self):
        host = self.post_host('LIWAN_RESTORE_DOMAIN=staging.liwanos.com\n')
        self.assertEqual('ok', self.restore(host, (8, '  HTTP/1.1 404 Not Found\n  Content-Length: 12\n')))
        self.assertEqual('MISSING', self.restore(host, (0, '  HTTP/1.1 200 OK\n  Content-Length: 1404\n  X: y\n')))
        self.assertEqual('MISSING', self.restore(host, (0, 'Content-Length: 1404\n')))
        ok_status = (8, '  HTTP/1.1 404 Not Found\n')
        self.assertEqual('MISSING', self.restore(host, ok_status, (0, f'{SS_HEADER}\nLISTEN 0 4096 *:443 *:*\n')))
        self.assertEqual('MISSING', self.restore(host, ok_status, (1, '')))

    def served(self, host, **record):
        host.files[f'{STATE}/served.json'] = regular(0o600, text=json.dumps({'commit': COMMIT, **record}))

    def release_state(self, host):
        return statuses(run(host, '--post-run')[1])['post-run-release-state']

    def test_served_commit_must_match_the_commit_current_points_to(self):
        host = self.post_host()
        run(host, '--apply')
        self.assertEqual('MISSING', self.release_state(host))  # nothing served yet
        self.served(host)
        self.assertEqual('ok', self.release_state(host))
        self.served(host, commit='b' * 40)
        self.assertEqual('MISSING', self.release_state(host))
        host.files[f'{STATE}/served.json'] = regular(0o600, text='[]')
        self.assertEqual('MISSING', self.release_state(host))
        host.files[f'{STATE}/served.json'] = regular(0o600, text='not json')
        self.assertEqual('FAILED', self.release_state(host))
        self.served(host)
        host.files[f'{STATE}/run.json'] = regular(0o600)
        self.assertEqual('MISSING', self.release_state(host))
        del host.files[f'{STATE}/run.json']
        host.files[f'{STATE}/halted.json'] = regular(0o600)
        self.assertEqual('MISSING', self.release_state(host))

    def post(self, host, name):
        return statuses(run(host, '--post-run')[1])[name]

    def only(self, host, prefix, answer):
        host.overrides = [(lambda argv: argv[:len(prefix)] == prefix, answer)]

    def test_shared_files_take_the_shape_of_the_shared_env_file(self):
        """A8.2a: the render takes the shared env file's own owner, group and mode (A4.1: 0640 root:docker), so both files
        carry one shape; 0600 owned by root or the worker is the narrower form the release also produces and reads."""
        def prepared(compose, env):
            host = self.post_host()
            host.users['liwan-worker'] = (990, 990)
            host.files[f'{SRV}/shared.compose.json'] = compose
            host.files[f'{SRV}/shared.env'] = env
            return host

        owned = regular(0o600, 990, 990, text=SHARED_TEXT)
        accepted = {'0600 liwan-worker': (regular(0o600, 990, 990), owned),
                    '0640 root:docker': (regular(0o640, 0, 999), regular(0o640, 0, 999, text=SHARED_TEXT)),
                    '0600 root:root': (regular(0o600, 0, 0), regular(0o600, 0, 0, text=SHARED_TEXT))}
        for name, (compose, env) in accepted.items():
            with self.subTest(name):
                self.assertEqual('ok', self.post(prepared(compose, env), 'post-run-shared-files'))
        refused = {'other readable': (regular(0o644, 990, 990), owned),
                   '0664': (regular(0o664, 990, 990), owned),
                   '0660': (regular(0o660, 990, 990), owned),
                   'other writable': (regular(0o602, 990, 990), owned),
                   'unrelated owner': (regular(0o600, 1000, 1000), owned),
                   'group that does not need it': (regular(0o640, 0, 1000), owned),
                   'env 0664': (regular(0o600, 990, 990), regular(0o664, 0, 999, text=SHARED_TEXT)),
                   'env unrelated owner': (regular(0o600, 990, 990), regular(0o600, 1000, 1000, text=SHARED_TEXT)),
                   'absent': (None, owned)}
        for name, (compose, env) in refused.items():
            with self.subTest(name):
                host = prepared(compose or regular(), env)
                if compose is None:
                    del host.files[f'{SRV}/shared.compose.json']
                self.assertEqual('MISSING', self.post(host, 'post-run-shared-files'))
        host = prepared(regular(0o664, 990, 990), owned)
        line = line_of(run(host, '--post-run')[1], 'post-run-shared-files')
        self.assertIn(f'{SRV}/shared.compose.json is 0664 990:990', line)
        self.assertIn('0640 root:docker', line)

    def test_ai_role_and_container_must_both_be_there(self):
        def host_with(role, containers):
            host = self.post_host()
            host.overrides = [(lambda argv: argv[:2] == ['docker', 'exec'], role), (lambda argv: argv[:2] == ['docker', 'ps'], containers)]
            return host

        self.assertEqual('ok', self.post(host_with((0, '1\n'), (0, 'Up 2 hours (healthy)\n')), 'post-run-ai-role'))
        for name, role, containers in (('no role', (0, '0\n'), (0, 'Up 2 hours (healthy)\n')),
                                       ('role query failed', (1, '1\n'), (0, 'Up 2 hours (healthy)\n')),
                                       ('unhealthy', (0, '1\n'), (0, 'Up 2 hours (unhealthy)\n')),
                                       ('no health state', (0, '1\n'), (0, 'Up 2 hours\n')),
                                       ('not up', (0, '1\n'), (0, 'Exited (1) 2 hours ago\n')),
                                       ('docker ps failed', (0, '1\n'), (1, 'Up (healthy)\n'))):
            with self.subTest(name):
                self.assertEqual('MISSING', self.post(host_with(role, containers), 'post-run-ai-role'))

    def test_pg_dump_runs_with_the_pgpass_file_on_the_tenant_port_and_its_failure_is_reported(self):
        host = self.post_host()
        self.assertEqual('ok', self.post(host, 'post-run-pg-dump'))
        call = next(call for call in host.calls if call[:2] == ['/usr/bin/pg_dump', '-h'])
        self.assertEqual(['-h', '127.0.0.1', '-p', '15433', '-U', 'postgres'], call[1:7])
        self.assertEqual('/etc/liwan-release/pgpass', host.envs[host.calls.index(call)]['PGPASSFILE'])
        self.only(host, ['/usr/bin/pg_dump'], (1, SECRET))
        self.assertEqual('MISSING', self.post(host, 'post-run-pg-dump'))
        no_pgpass = self.post_host()
        with_config(no_pgpass, **{'PGPASSFILE=/etc/liwan-release/pgpass\n': ''})
        self.assertEqual('MISSING', self.post(no_pgpass, 'post-run-pg-dump'))

    def test_runtime_role_is_asserted_as_the_admin_in_database_postgres(self):
        host = self.post_host()
        self.assertEqual('ok', self.post(host, 'post-run-runtime-role'))
        call = next(call for call in host.calls if call[:2] == ['docker', 'exec'] and '-c' in call)
        self.assertEqual(['-U', 'postgres', '-d', 'postgres'], call[4:8])
        self.only(host, ['docker', 'exec'], (1, SECRET))
        self.assertEqual('MISSING', self.post(host, 'post-run-runtime-role'))

    def test_postgres_client_and_server_must_be_16_4_or_later(self):
        for client, server, expected in (('pg_dump (PostgreSQL) 16.4', '16.4\n', 'ok'), ('pg_dump (PostgreSQL) 16.3', '16.4\n', 'MISSING'),
                                         ('pg_dump (PostgreSQL) 16.4', '16.3 (Debian)\n', 'MISSING'), ('pg_dump (PostgreSQL) 17.0', '17.0\n', 'ok')):
            with self.subTest(client, server=server):
                host = self.post_host()
                host.versions['/usr/bin/pg_dump'] = client
                self.only(host, ['docker', 'exec'], (0, server))
                self.assertEqual(expected, self.post(host, 'post-run-postgres-floor'))

    def test_db_passwords_must_both_be_set_and_differ(self):
        for name, text, expected in (('both', SHARED_TEXT, 'ok'), ('same', SHARED_TEXT.replace('admin-pass', 'runtime-pass'), 'MISSING'),
                                     ('no admin', SHARED_TEXT.replace('DB_ADMIN_PASSWORD=admin-pass\n', ''), 'MISSING')):
            with self.subTest(name):
                host = seeded_host()
                host.files[f'{SRV}/shared.env'] = regular(0o600, text=text)
                self.assertEqual(expected, statuses(run(host)[1])['shared-db-passwords'])

    def test_ai_usage_key_must_be_64_hex(self):
        for name, text, expected in (('good', SHARED_TEXT, 'ok'), ('absent', SHARED_TEXT.replace(f'LIWAN_AI_USAGE_KEY={USAGE_KEY}\n', ''), 'MISSING'),
                                     ('placeholder', SHARED_TEXT.replace(USAGE_KEY, 'REPLACE_WITH_GENERATED_AI_USAGE_ROOT_SECRET'), 'MISSING')):
            with self.subTest(name):
                host = seeded_host()
                host.files[f'{SRV}/shared.env'] = regular(0o600, text=text)
                self.assertEqual(expected, statuses(run(host)[1])['shared-ai-usage-key'])

    # --- A3.2b tenant storage files
    STORAGE = f'{SRV}/control/tenant-storage'

    def storage_host(self, shared_extra=''):
        host = seeded_host()
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + shared_extra)
        host.files[f'{SRV}/control'] = directory(0o750)
        return host

    def test_apply_makes_the_directory_and_a_random_naming_key_owned_by_the_container_user(self):
        host = self.storage_host()
        run(host, '--apply')
        folder, key = host.files[self.STORAGE], host.files[f'{self.STORAGE}/oci_naming_key']
        self.assertEqual((0o700, 0, 0), (stat.S_IMODE(folder.st_mode), folder.st_uid, folder.st_gid))
        self.assertEqual((0o400, 10001, 10001), (stat.S_IMODE(key.st_mode), key.st_uid, key.st_gid))
        self.assertRegex(key.text, r'^[0-9a-f]{64}$')
        self.assertNotIn(f'{self.STORAGE}/oci_provision_key', host.files)  # bring-up never creates the OCI signing key

    def test_the_naming_key_is_never_replaced_and_never_printed(self):
        host = self.storage_host()
        run(host, '--apply')
        first = host.files[f'{self.STORAGE}/oci_naming_key'].text
        host.mutations.clear()
        _, lines = run(host, '--apply')
        self.assertEqual(first, host.files[f'{self.STORAGE}/oci_naming_key'].text)
        self.assertEqual([], [m for m in host.mutations if self.STORAGE in m])
        self.assertNotIn(first, '\n'.join(lines))

    def test_the_signing_key_is_required_only_once_tenant_storage_is_configured(self):
        host = self.storage_host()
        run(host, '--apply')
        self.assertEqual('ok', statuses(run(host)[1])['tenant-storage-files'])
        configured = self.storage_host('OCI_TENANCY_OCID=ocid1.tenancy.oc1..x\n')
        run(configured, '--apply')
        lines = run(configured)[1]
        self.assertEqual('MISSING', statuses(lines)['tenant-storage-files'])
        self.assertIn('oci_provision_key absent', '\n'.join(lines))
        configured.files[f'{self.STORAGE}/oci_provision_key'] = regular(0o400, 10001, 10001, text='synthetic signing key body')
        self.assertEqual('ok', statuses(run(configured)[1])['tenant-storage-files'])
        self.assertNotIn('synthetic signing key body', '\n'.join(run(configured)[1]))

    def test_wrong_modes_or_owners_of_the_storage_files_are_reported(self):
        for name, path, entry_ in (('naming key readable by group', f'{self.STORAGE}/oci_naming_key', regular(0o440, 10001, 10001, text='k')),
                                   ('naming key owned by root', f'{self.STORAGE}/oci_naming_key', regular(0o400, 0, 0, text='k')),
                                   ('directory open to others', self.STORAGE, directory(0o755))):
            with self.subTest(name):
                host = self.storage_host()
                run(host, '--apply')
                host.files[path] = entry_
                self.assertEqual('MISSING', statuses(run(host)[1])['tenant-storage-files'])

    def test_a_shared_env_without_the_directory_key_is_reported_and_nothing_is_created(self):
        host = self.storage_host()
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT.replace(f'LIWAN_TENANT_STORAGE_FILES_DIR={SRV}/control/tenant-storage\n', ''))
        _, lines = run(host, '--apply')
        self.assertEqual('MISSING', statuses(lines)['tenant-storage-files'])
        self.assertEqual([], [m for m in host.mutations if 'tenant-storage' in m])

    def test_empty_database_port_keys_mean_the_release_defaults(self):
        host = self.post_host('LIWAN_DB_HOST_PORT=\nLIWAN_CONTROL_DB_HOST_PORT=\n')
        self.post(host, 'post-run-pg-dump')
        self.assertEqual('15433', next(call for call in host.calls if call[:2] == ['/usr/bin/pg_dump', '-h'])[4])
        self.only(host, ['ss'], (0, f'{SS_HEADER}\nLISTEN 0 4096 0.0.0.0:15433 0.0.0.0:*\n'))
        self.assertEqual('MISSING', self.post(host, 'post-run-listeners'))
        self.only(host, ['ss'], (0, f'{SS_HEADER}\nLISTEN 0 4096 0.0.0.0:15432 0.0.0.0:*\n'))
        self.assertEqual('MISSING', self.post(host, 'post-run-listeners'))
        self.only(host, ['ss'], (0, f'{SS_HEADER}\nLISTEN 0 4096 127.0.0.1:15433 0.0.0.0:*\nLISTEN 0 4096 127.0.0.1:15432 0.0.0.0:*\n'))
        self.assertEqual('ok', self.post(host, 'post-run-listeners'))

    def test_only_the_openship_container_may_use_the_host_network(self):
        host = self.post_host()
        for output, expected in (('', 'ok'), ('openship-edge\n', 'ok'), ('openship-edge\nliwan-proxy-1\n', 'MISSING')):
            with self.subTest(output):
                self.only(host, ['docker', 'ps'], (0, output))
                self.assertEqual(expected, self.post(host, 'post-run-host-network'))
        self.only(host, ['docker', 'ps'], (1, ''))
        self.assertEqual('MISSING', self.post(host, 'post-run-host-network'))

    def test_the_edge_must_answer_with_a_good_status_and_valid_tls(self):
        host = self.post_host('LIWAN_PROSPECT_HOST=prospect.example.com\n')
        for answer, expected in (((0, '200 0'), 'ok'), ((0, '301 0'), 'ok'), ((0, '200 19'), 'MISSING'), ((0, '404 0'), 'MISSING'),
                                 ((60, '000 20'), 'MISSING'), ((0, ''), 'MISSING')):
            with self.subTest(answer):
                self.only(host, ['curl'], answer)
                self.assertEqual(expected, self.post(host, 'post-run-edge-answer'))
        self.assertIn('https://prospect.example.com/favicon.ico', next(call for call in host.calls if call[0] == 'curl'))
        self.assertEqual('MISSING', self.post(self.post_host(), 'post-run-edge-answer'))

    def test_the_worker_must_be_active_and_log_a_tick(self):
        host = self.post_host()
        unit_active, ticking = (lambda argv: argv[:2] == ['systemctl', 'is-active']), (lambda argv: argv[0] == 'journalctl')
        for name, active, journal, expected in (
                ('ticking', (0, 'active\n'), (0, 'x commercial_scheduler_tick done\n'), 'ok'),
                ('inactive', (3, 'inactive\n'), (0, 'commercial_scheduler_tick\n'), 'MISSING'),
                ('no tick', (0, 'active\n'), (0, 'started\n'), 'MISSING'),
                ('journal failed', (0, 'active\n'), (1, 'commercial_scheduler_tick\n'), 'MISSING')):
            with self.subTest(name):
                host.overrides = [(unit_active, active), (ticking, journal)]
                self.assertEqual(expected, self.post(host, 'post-run-worker-ticks'))


class ReleaseProofTest(unittest.TestCase):
    """A4.7a/A8.2c: the signing key and its directory, the pinned public key, and the proof transport."""

    def item(self, host, name):
        return statuses(run(host)[1])[name]

    def test_openssl_must_generate_sign_and_verify_ed25519(self):
        host = seeded_host()
        host.openssl_ed25519 = False
        line = line_of(run(host)[1], 'release-proof-openssl')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn('OpenSSL 3', line)
        host.openssl_ed25519 = True
        _, lines = run(host)
        self.assertEqual('ok', statuses(lines)['release-proof-openssl'])
        probe = [call for call in host.calls if call[:2] == ['openssl', 'genpkey']][0]
        self.assertTrue(probe[probe.index('-out') + 1].startswith(f'{SCRATCH}/'))
        self.assertTrue(any(call[:2] == ['openssl', 'pkeyutl'] for call in host.calls))
        self.assertNotIn(f'{SCRATCH}/probe', '\n'.join(lines))

    def test_apply_makes_the_directory_and_the_key_pair_once(self):
        host = seeded_host()
        self.assertEqual('MISSING', self.item(host, 'release-proof-dir'))
        code, lines = run(host, '--apply')
        self.assertEqual(0, code, lines)
        self.assertEqual({'created'}, {statuses(lines)['release-proof-dir'], statuses(lines)['release-proof-key']})
        folder, key, public = host.files[PROOF_DIR], host.files[PROOF_KEY], host.files[PROOF_KEY + '.pub']
        self.assertEqual((0o755, 0, 0), (stat.S_IMODE(folder.st_mode), folder.st_uid, folder.st_gid))
        self.assertEqual((0o600, 0), (stat.S_IMODE(key.st_mode), key.st_uid))
        self.assertEqual((0o644, 0), (stat.S_IMODE(public.st_mode), public.st_uid))
        key.text, public.text = 'existing key', 'pub:existing key'
        host.mutations.clear()
        code, second = run(host, '--apply')
        self.assertEqual(0, code)
        self.assertEqual({'ok'}, set(statuses(second).values()))
        self.assertEqual(('existing key', 'pub:existing key'),
                         (host.files[PROOF_KEY].text, host.files[PROOF_KEY + '.pub'].text))
        self.assertEqual([], [m for m in host.mutations if PROOF_KEY in m or PROOF_DIR in m])

    def test_a_stale_or_mismatched_public_key_is_reported_and_apply_never_mints_a_mismatch(self):
        host = seeded_host()
        run(host, '--apply')
        host.files[PROOF_KEY].text = 'SECRET-PRIVATE-KEY-BODY'
        host.files[PROOF_KEY + '.pub'].text = 'STALE-PUBLIC-KEY-BODY'
        line = line_of(run(host)[1], 'release-proof-key')
        self.assertTrue(line.startswith('MISSING'), line)
        self.assertIn('does not match', line)
        self.assertNotIn('SECRET-PRIVATE-KEY-BODY', line)
        self.assertNotIn('STALE-PUBLIC-KEY-BODY', line)
        # If the private key is lost while the old .pub remains, --apply must NOT mint a new mismatched key.
        del host.files[PROOF_KEY]
        host.mutations.clear()
        _, applied = run(host, '--apply')
        self.assertEqual('MISSING', statuses(applied)['release-proof-key'])
        self.assertNotIn(PROOF_KEY, host.files)
        self.assertEqual('STALE-PUBLIC-KEY-BODY', host.files[PROOF_KEY + '.pub'].text)
        self.assertEqual([], [m for m in host.mutations if PROOF_KEY in m])

    def test_a_wrong_mode_or_a_directory_the_shared_env_file_disagrees_with_is_reported(self):
        host = seeded_host()
        run(host, '--apply')
        host.files[PROOF_KEY] = regular(0o644, text='k')
        self.assertIn('expected 0600 0', line_of(run(host)[1], 'release-proof-key'))
        host.files[PROOF_DIR] = directory(0o750)
        self.assertIn('expected 0755 0:0', line_of(run(host)[1], 'release-proof-dir'))
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT.replace(
            f'LIWAN_RELEASE_PROOF_DIR={PROOF_DIR}\n', 'LIWAN_RELEASE_PROOF_DIR=/srv/elsewhere/proof\n'))
        self.assertIn('/srv/elsewhere/proof', line_of(run(host)[1], 'release-proof-dir'))

    def test_proof_dir_missing_from_the_shared_env_file_is_reported_as_missing(self):
        host = seeded_host()
        host.files[PROOF_DIR] = directory(0o755)
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT.replace(
            f'LIWAN_RELEASE_PROOF_DIR={PROOF_DIR}\n', ''))
        line = line_of(run(host)[1], 'release-proof-dir')
        self.assertTrue(line.startswith('MISSING'), line)
        self.assertIn('absent from the shared env file', line)
        self.assertIn('both', line)
        self.assertIn(CONFIG, line)
        # --apply also refuses to create the directory until shared.env names it too.
        del host.files[PROOF_DIR]
        host.mutations.clear()
        _, applied = run(host, '--apply')
        self.assertEqual('MISSING', statuses(applied)['release-proof-dir'])
        self.assertNotIn(PROOF_DIR, host.files)

    def test_the_pinned_public_key_is_required_only_where_a_proof_is_required(self):
        self.assertEqual('ok', self.item(seeded_host(), 'release-proof-public-key'))
        pinned = '/etc/liwan-release/staging-release-proof.pub'
        host = seeded_host()
        with_config(host, f'{bringup.PROOF_URL_KEY}={PROOF_URL}\n{bringup.PROOF_PUBLIC_KEY_KEY}={pinned}\n')
        line = line_of(run(host)[1], 'release-proof-public-key')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn(f'{pinned} absent', line)
        self.assertIn('copy the signing environment', line)
        host.files[pinned] = regular(0o644, text='public key')
        self.assertEqual('ok', self.item(host, 'release-proof-public-key'))
        for name, found in (('writable by others', regular(0o666, text='public key')),
                            ('owned by another user', regular(0o644, 501, 0, text='public key'))):
            with self.subTest(name):
                host.files[pinned] = found
                self.assertEqual('MISSING', self.item(host, 'release-proof-public-key'))
        url_only = seeded_host()
        with_config(url_only, f'{bringup.PROOF_URL_KEY}={PROOF_URL}\n')
        self.assertIn('set together or not at all', line_of(run(url_only)[1], 'release-proof-public-key'))

    def test_pinning_the_environments_own_public_key_is_refused(self):
        own_pub = PROOF_KEY + '.pub'
        copied = '/etc/liwan-release/copied-own.pub'

        def copied_key(text):
            return lambda h: h.files.__setitem__(copied, regular(0o644, text=text))

        def copied_without_pub(text):
            def setup(h):
                del h.files[PROOF_KEY + '.pub']  # a deleted .pub must not disable the refusal
                h.files[copied] = regular(0o644, text=text)
            return setup

        for name, pinned_path, setup in (
                ('direct path', own_pub, lambda h: None),
                ('parent traversal', '/etc/liwan-release/../liwan-release/staging-release-proof.key.pub', lambda h: None),
                ('symlinked parent dir', '/etc/liwan-link/staging-release-proof.key.pub',
                 lambda h: h.files.__setitem__('/etc/liwan-link', symlink_entry('/etc/liwan-release'))),
                ('copied own key bytes', copied, copied_key('pub:openssl-made')),
                ('copied own key with an extra newline', copied, copied_key('pub:openssl-made\n')),
                ('copied own key with crlf line endings', copied, copied_key('pub:openssl-made\r\n')),
                ('copied own key without the .pub beside it', copied, copied_without_pub('pub:openssl-made'))):
            with self.subTest(name):
                host = seeded_host()
                run(host, '--apply')
                setup(host)
                with_config(host, f'{bringup.PROOF_URL_KEY}={PROOF_URL}\n{bringup.PROOF_PUBLIC_KEY_KEY}={pinned_path}\n')
                line = line_of(run(host)[1], 'release-proof-public-key')
                self.assertTrue(line.startswith('MISSING'), line)
                self.assertIn('own signing public key', line)
                self.assertNotIn('pub:openssl-made', line)
                self.assertNotIn('openssl-made', line)

    def test_a_signing_key_openssl_cannot_read_blocks_a_pinned_key(self):
        """No derived key means no pinned key can be shown not to be this environment's own, so the item is MISSING."""
        host = seeded_host()
        run(host, '--apply')
        host.openssl_ed25519 = False  # openssl reads no key on this host at all
        pinned = '/etc/liwan-release/source-release-proof.pub'
        host.files[pinned] = regular(0o644, text='pub:someone-else')
        with_config(host, f'{bringup.PROOF_URL_KEY}={PROOF_URL}\n{bringup.PROOF_PUBLIC_KEY_KEY}={pinned}\n')
        line = line_of(run(host)[1], 'release-proof-public-key')
        self.assertTrue(line.startswith('MISSING'), line)
        self.assertIn('cannot be read as a private key', line)
        self.assertNotIn('openssl-made', line)

    def test_the_proof_egress_requires_404_with_the_route_marker_header(self):
        pinned = '/etc/liwan-release/source-release-proof.pub'
        host = seeded_host()
        with_config(host, f'{bringup.PROOF_URL_KEY}={PROOF_URL}\n{bringup.PROOF_PUBLIC_KEY_KEY}={pinned}\n')
        cases = (
            ((0, 'HTTP/2 404 \r\nx-liwan-release-proof: 1\r\n\r\n'), 'ok'),
            ((0, 'HTTP/1.1 404 Not Found\r\nX-Liwan-Release-Proof: 1\r\n\r\n'), 'ok'),
            # A bare 404 from a wrong host or an older edge without the release-proof route must be MISSING.
            ((0, 'HTTP/2 404 \r\nserver: Caddy\r\n\r\n'), 'MISSING'),
            ((0, 'HTTP/2 404 \r\nx-liwan-release-proof: 0\r\n\r\n'), 'MISSING'),
            ((0, 'HTTP/2 200 \r\nx-liwan-release-proof: 1\r\n\r\n'), 'MISSING'),
            ((0, 'HTTP/2 502 \r\n\r\n'), 'MISSING'),
            ((6, ''), 'MISSING'),
            ((0, ''), 'MISSING'),
        )
        for answer, expected in cases:
            with self.subTest(answer=answer):
                host.overrides = [(lambda argv: argv[0] == 'curl', answer)]
                self.assertEqual(expected, statuses(run(host, '--post-run')[1])['release-proof-egress'])
        probe = [call for call in host.calls if call[0] == 'curl' and call[-1].startswith(PROOF_URL)][0]
        self.assertEqual(f'{PROOF_URL}{bringup.PROOF_PROBE_COMMIT}.json', probe[-1])
        self.assertIn('--max-time', probe)
        self.assertIn('-D', probe)
        # The probe speaks HTTPS to the edge itself: no proxy of the host may answer it, and no other scheme is tried.
        self.assertEqual('*', probe[probe.index('--noproxy') + 1])
        self.assertEqual('=https', probe[probe.index('--proto') + 1])
        # Nothing configured: the environment requires no proof, so the item checks no transport.
        self.assertEqual('ok', statuses(run(seeded_host(), '--post-run')[1])['release-proof-egress'])

    def test_a_message_names_the_key_and_never_the_proof_url(self):
        """The URL is the transport of a private signature; the release path does not print it either."""
        pinned = '/etc/liwan-release/source-release-proof.pub'
        host = seeded_host()
        with_config(host, f'{bringup.PROOF_URL_KEY}={PROOF_URL}\n{bringup.PROOF_PUBLIC_KEY_KEY}={pinned}\n')
        for answer, expected in (((0, 'HTTP/2 200 \r\n\r\n'), 'MISSING'),
                                 ((0, 'HTTP/2 404 \r\n\r\n'), 'MISSING'),
                                 ((6, ''), 'MISSING'),
                                 ((0, ''), 'MISSING')):
            with self.subTest(answer=answer):
                host.overrides = [(lambda argv: argv[0] == 'curl', answer)]
                line = line_of(run(host, '--post-run')[1], 'release-proof-egress')
                self.assertTrue(line.startswith(expected), line)
                self.assertIn(bringup.PROOF_URL_KEY, line)
                self.assertNotIn(PROOF_URL, line)
                self.assertNotIn(bringup.PROOF_PROBE_COMMIT, line)

    def test_an_explicit_environment_must_name_the_proof_pair(self):
        """Production's policy is `explicit`: an unset pair is a missing item, never a green gate that is off."""
        host = seeded_host()
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + 'LIWAN_RELEASE_TAG_POLICY=explicit\n')
        for item in ('release-proof-public-key', 'release-proof-egress'):
            with self.subTest(item):
                line = line_of(run(host, '--post-run')[1], item)
                self.assertTrue(line.startswith('MISSING'), line)
                self.assertIn('LIWAN_RELEASE_TAG_POLICY=explicit', line)
                self.assertIn(bringup.PROOF_URL_KEY, line)
                self.assertIn(bringup.PROOF_PUBLIC_KEY_KEY, line)
        # With the pair, the same host is checked as before.
        with_config(host, f'{bringup.PROOF_URL_KEY}={PROOF_URL}\n{bringup.PROOF_PUBLIC_KEY_KEY}=/etc/liwan-release/s.pub\n')
        host.files['/etc/liwan-release/s.pub'] = regular(0o644, text='public key')
        self.assertEqual('ok', self.item(host, 'release-proof-public-key'))
        host.overrides = [(lambda argv: argv[0] == 'curl', (0, 'HTTP/2 404 \r\nx-liwan-release-proof: 1\r\n\r\n'))]
        self.assertEqual('ok', statuses(run(host, '--post-run')[1])['release-proof-egress'])

    def test_a_proof_url_that_is_not_https_or_has_no_trailing_slash_is_reported(self):
        pinned = '/etc/liwan-release/source-release-proof.pub'
        for url in ('http://app.staging.example.test/_liwan/release-proof/',
                    'https://app.staging.example.test/_liwan/release-proof'):
            with self.subTest(url=url):
                host = seeded_host()
                with_config(host, f'{bringup.PROOF_URL_KEY}={url}\n{bringup.PROOF_PUBLIC_KEY_KEY}={pinned}\n')
                line = line_of(run(host, '--post-run')[1], 'release-proof-egress')
                self.assertTrue(line.startswith('MISSING'))
                self.assertIn('ending in /', line)


class TenantStorageItemsTest(unittest.TestCase):
    """A3.2b, A4.13 to A4.15: the settings, stack and flag items of tenant storage."""
    STORAGE = f'{SRV}/control/tenant-storage'
    SETTINGS = (('OCI_TENANCY_OCID', 'ocid1.tenancy.oc1..example'), ('OCI_USER_OCID', 'ocid1.user.oc1..example'),
                ('OCI_FINGERPRINT', 'aa:bb:cc'), ('OCI_COMPARTMENT_OCID', 'ocid1.compartment.oc1..example'))
    STACK_TEMPLATE = ('services:\n'
                      '  tenant-storage:\n'
                      '    profiles: [tenant-storage]\n'
                      '    environment:\n'
                      '      HTTPS_PROXY: http://tenant-storage-egress:3128\n'
                      '  tenant-storage-egress:\n'
                      '    profiles: [tenant-storage]\n'
                      'networks:\n'
                      '  tenant_storage: { internal: true }\n')

    def resolved(self, **overrides):
        """The resolved compose file the release writes: both services, the four settings in the provisioner's environment."""
        environment = dict(self.SETTINGS)
        environment.update(overrides)
        return {'services': {bringup.TENANT_STORAGE_PROFILE: {'environment': environment},
                             bringup.TENANT_STORAGE_EGRESS: {'environment': {}}}}

    def prepared(self, flag=None, settings=True, files=True, stack=True):
        host = seeded_host()
        extra = ''.join(f'{key}={value}\n' for key, value in self.SETTINGS if settings)
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + extra)
        host.files[f'{SRV}/shared.compose.json'] = regular(0o600, text=json.dumps(self.resolved()))
        if files:
            host.files[self.STORAGE] = directory(0o700)
            host.files[f'{self.STORAGE}/oci_naming_key'] = regular(0o400, 10001, 10001, text='ab' * 32)
            host.files[f'{self.STORAGE}/oci_provision_key'] = regular(0o400, 10001, 10001, text='synthetic signing key body')
        if not stack:
            del host.files['/opt/liwan/current/deploy/stack/compose.yml']
        host.files['/opt/liwan/current'] = symlink_entry(f'/opt/liwan/releases/{COMMIT}')
        if flag is not None:
            host.files[str(bringup.SHARED_WORKER_ENV_FILE)] = regular(0o600, text=f'{bringup.TENANT_STORAGE_FLAG_KEY}={flag}\n')
        return host

    def found(self, host, *argv):
        return statuses(run(host, *argv)[1])

    def test_the_oci_settings_are_empty_while_tenant_storage_is_off_and_all_required_once_started(self):
        self.assertEqual('ok', self.found(self.prepared(settings=False))['tenant-storage-settings'])
        self.assertEqual('ok', self.found(self.prepared())['tenant-storage-settings'])
        partial = self.prepared(settings=False)
        partial.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + 'OCI_TENANCY_OCID=ocid1.tenancy.oc1..example\n')
        line = line_of(run(partial)[1], 'tenant-storage-settings')
        self.assertTrue(line.startswith('MISSING'))
        for key in ('OCI_USER_OCID', 'OCI_FINGERPRINT', 'OCI_COMPARTMENT_OCID'):
            self.assertIn(key, line)
        flagged = self.prepared(flag='true', settings=False)
        self.assertTrue(line_of(run(flagged)[1], 'tenant-storage-settings').startswith('MISSING'))

    def test_a_stale_resolved_compose_file_is_named_with_the_release_to_run(self):
        host = self.prepared()
        host.files[f'{SRV}/shared.compose.json'] = regular(0o600, text=json.dumps(self.resolved(OCI_TENANCY_OCID='')))
        line = line_of(run(host)[1], 'tenant-storage-settings')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn('carries no OCI_TENANCY_OCID', line)
        self.assertIn('release again so the rendered compose file carries the settings', line)
        host.files[f'{SRV}/shared.compose.json'] = regular(
            0o600, text=json.dumps(self.resolved(OCI_USER_OCID='ocid1.user.oc1..other')))
        line = line_of(run(host)[1], 'tenant-storage-settings')
        self.assertIn('carries a different OCI_USER_OCID than the shared env file', line)

    def test_the_resolved_compose_file_keeps_both_services(self):
        host = self.prepared()
        self.assertEqual('ok', self.found(host)['tenant-storage-settings'])
        resolved = self.resolved()
        del resolved['services'][bringup.TENANT_STORAGE_EGRESS]
        host.files[f'{SRV}/shared.compose.json'] = regular(0o600, text=json.dumps(resolved))
        self.assertIn(f'has no service {bringup.TENANT_STORAGE_EGRESS}', line_of(run(host)[1], 'tenant-storage-settings'))

    def test_a_missing_resolved_compose_file_names_the_release_hint(self):
        host = self.prepared()
        del host.files[f'{SRV}/shared.compose.json']
        line = line_of(run(host)[1], 'tenant-storage-settings')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn(f'{SRV}/shared.compose.json is absent', line)
        self.assertIn('trigger the liwan-staging-release job (A7.1)', line)
        self.assertIn('. /etc/liwan-release/github-read', line)
        self.assertIn('/opt/liwan/current/deploy/release/release.py run --environment staging', line)

    def test_the_runtime_config_compose_file_is_used_when_the_shared_env_names_none(self):
        host = self.prepared()
        host.files[f'{SRV}/shared.env'] = regular(
            0o600, text=SHARED_TEXT.replace(f'{bringup.SHARED_COMPOSE_KEY}={SRV}/shared.compose.json\n', '')
            + ''.join(f'{key}={value}\n' for key, value in self.SETTINGS))
        host.files[f'{SRV}/control/config'] = directory(0o750)
        host.files[f'{SRV}/control/config/shared-runtime.json'] = regular(
            0o600, text=json.dumps({'composeFile': f'{SRV}/shared.compose.json'}))
        self.assertEqual('ok', self.found(host)['tenant-storage-settings'])
        del host.files[f'{SRV}/control/config/shared-runtime.json']
        line = line_of(run(host)[1], 'tenant-storage-settings')
        self.assertIn(f'names no {bringup.SHARED_COMPOSE_KEY}', line)
        self.assertIn('trigger the liwan-staging-release job (A7.1)', line)

    def test_the_flag_guard_sees_a_stale_resolved_compose_file(self):
        host = self.prepared(flag='true')
        host.files[f'{SRV}/shared.compose.json'] = regular(0o600, text=json.dumps(self.resolved(OCI_COMPARTMENT_OCID='')))
        line = line_of(run(host)[1], 'tenant-storage-enabled')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn('carries no OCI_COMPARTMENT_OCID', line)

    def test_the_stack_item_needs_the_provisioner_and_its_egress_proxy_in_the_served_checkout(self):
        self.assertEqual([], bringup.storage_stack_problems(bringup.compose_services(REAL_STACK_COMPOSE)))
        host = self.prepared()
        self.assertEqual('ok', self.found(host)['tenant-storage-stack'])
        cases = {'no provisioner': self.STACK_TEMPLATE.replace('  tenant-storage:\n', '  another-service:\n'),
                 'no egress proxy': self.STACK_TEMPLATE.replace('  tenant-storage-egress:\n', '  another-proxy:\n'),
                 'no profile': self.STACK_TEMPLATE.replace('profiles: [tenant-storage]', 'profiles: [other]', 1),
                 'no proxy route': self.STACK_TEMPLATE.replace('http://tenant-storage-egress:3128', 'http://another-proxy:3128')}
        for name, text in cases.items():
            with self.subTest(name):
                host.files['/opt/liwan/current/deploy/stack/compose.yml'] = regular(0o644, text=text)
                self.assertTrue(line_of(run(host)[1], 'tenant-storage-stack').startswith('MISSING'))
        del host.files['/opt/liwan/current/deploy/stack/compose.yml']
        self.assertIn('is absent', line_of(run(host)[1], 'tenant-storage-stack'))

    def test_any_value_but_exactly_true_keeps_the_flag_off(self):
        for flag in (None, 'false', '1', 'True', 'yes'):
            with self.subTest(flag):
                self.assertEqual('ok', self.found(self.prepared(flag=flag, settings=False, files=False))['tenant-storage-enabled'])

    def test_the_flag_is_ok_only_when_the_files_settings_and_stack_are_all_there(self):
        self.assertEqual('ok', self.found(self.prepared(flag='true'))['tenant-storage-enabled'])
        for name, host in (('settings', self.prepared(flag='true', settings=False)),
                           ('files', self.prepared(flag='true', files=False)),
                           ('stack', self.prepared(flag='true', stack=False))):
            with self.subTest(name):
                line = line_of(run(host)[1], 'tenant-storage-enabled')
                self.assertTrue(line.startswith('MISSING'))
                self.assertIn(f'{bringup.TENANT_STORAGE_FLAG_KEY}=true in {bringup.SHARED_WORKER_ENV_FILE}', line)
                self.assertIn(f'set {bringup.TENANT_STORAGE_FLAG_KEY} to false', line)

    def test_the_signing_key_is_required_once_the_flag_turns_storage_on(self):
        host = self.prepared(flag='true', settings=False, files=False)
        line = line_of(run(host)[1], 'tenant-storage-files')
        self.assertIn(f'{self.STORAGE}/oci_provision_key absent', line)
        self.assertIn('OCI API signing key', line)

    def test_the_control_env_file_the_shared_env_names_carries_the_flag_too(self):
        host = self.prepared()
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + ''.join(f'{k}={v}\n' for k, v in self.SETTINGS)
                                                   + f'{bringup.CONTROL_ENV_KEY}={SRV}/control/control.env\n')
        host.files[f'{SRV}/control/control.env'] = regular(0o600, text=f'{bringup.TENANT_STORAGE_FLAG_KEY}=true\n')
        self.assertEqual('ok', self.found(host)['tenant-storage-enabled'])
        host.files[f'{SRV}/shared.env'] = regular(0o600, text=SHARED_TEXT + f'{bringup.CONTROL_ENV_KEY}={SRV}/control/control.env\n')
        line = line_of(run(host)[1], 'tenant-storage-enabled')
        self.assertTrue(line.startswith('MISSING'))
        self.assertIn(f'{SRV}/control/control.env', line)

    def test_apply_never_generates_the_signing_key_and_a_second_apply_changes_nothing(self):
        host = self.prepared(flag='true', files=False)
        found = self.found(host, '--apply')
        self.assertEqual(('MISSING', 'MISSING', 'ok', 'ok'),
                         (found['tenant-storage-files'], found['tenant-storage-enabled'],
                          found['tenant-storage-settings'], found['tenant-storage-stack']))
        self.assertNotIn(f'{self.STORAGE}/oci_provision_key', host.files)
        self.assertEqual((0o700, 0o400), (stat.S_IMODE(host.files[self.STORAGE].st_mode),
                                          stat.S_IMODE(host.files[f'{self.STORAGE}/oci_naming_key'].st_mode)))
        host.files[f'{self.STORAGE}/oci_provision_key'] = regular(0o400, 10001, 10001, text='synthetic signing key body')
        host.mutations.clear()
        _, second = run(host, '--apply')
        self.assertEqual({'ok'}, set(statuses(second).values()))
        self.assertEqual([], host.mutations)


class RealHostTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(os.path.realpath(self.tmp.name))
        self.host = bringup.Host()

    def https_with(self, outcome):
        class Opener:
            requests = []

            def open(self, request, timeout=None):
                self.requests.append(request)
                if isinstance(outcome, BaseException):
                    raise outcome
                return outcome

        with mock.patch.object(urllib.request, 'build_opener', return_value=Opener()) as build:
            return Opener, build, self.host.https_headers('https://api.github.com/user', SECRET)

    def test_https_headers_sends_the_token_in_a_header_and_reads_status_and_headers(self):
        response = mock.MagicMock()
        response.__enter__.return_value = SimpleNamespace(status=200, headers={'X-OAuth-Scopes': 'read:packages'})
        opener, build, result = self.https_with(response)
        self.assertEqual((200, {'x-oauth-scopes': 'read:packages'}), result)
        self.assertIs(bringup.RefuseRedirect, build.call_args.args[0])
        self.assertEqual(f'Bearer {SECRET}', opener.requests[0].get_header('Authorization'))

    def test_https_headers_refuses_a_redirect_without_leaking_the_token(self):
        self.assertIsNone(bringup.RefuseRedirect().redirect_request(None, None, 302, 'Found', {}, 'https://evil.example/'))
        error = urllib.error.HTTPError('https://api.github.com/user', 302, 'Found', {}, None)
        with self.assertRaises(bringup.ItemError) as caught:
            self.https_with(error)
        self.assertEqual('api.github.com answered with a redirect', str(caught.exception))

    def test_https_headers_turns_a_network_error_into_unreachable_without_the_token(self):
        with self.assertRaises(bringup.ItemError) as caught:
            self.https_with(urllib.error.URLError(f'boom {SECRET}'))
        self.assertEqual('api.github.com is unreachable', str(caught.exception))

    def test_write_new_refuses_an_existing_path_and_a_symlink(self):
        existing = self.root / 'a'
        existing.write_text('keep', encoding='utf-8')
        with self.assertRaises(FileExistsError):
            self.host.write_new(existing, 'x', 0o644)
        self.assertEqual('keep', existing.read_text(encoding='utf-8'))
        (self.root / 'link').symlink_to(self.root / 'target')
        with self.assertRaises(OSError):
            self.host.write_new(self.root / 'link', 'x', 0o644)
        self.assertFalse((self.root / 'target').exists())

    def test_write_new_sets_the_mode_whatever_the_umask(self):
        old = os.umask(0o077)
        self.addCleanup(os.umask, old)
        self.host.write_new(self.root / 'unit', 'text', 0o644)
        self.assertEqual((0o644, 'text'), (stat.S_IMODE((self.root / 'unit').stat().st_mode), (self.root / 'unit').read_text(encoding='utf-8')))

    def test_reads_refuse_a_symlink(self):
        (self.root / 'real').write_text('A=1\n', encoding='utf-8')
        (self.root / 'link').symlink_to(self.root / 'real')
        self.assertEqual({'A': '1'}, self.host.read_env(self.root / 'real'))
        for read in (self.host.read_text, self.host.read_env):
            with self.assertRaises(OSError):
                read(self.root / 'link')

    def test_undecodable_text_is_an_item_error_naming_the_path(self):
        (self.root / 'bad').write_bytes(b'A=\xff\xfe\n')
        for read in (self.host.read_text, self.host.read_env):
            with self.assertRaises(bringup.ItemError) as caught:
                read(self.root / 'bad')
            self.assertEqual(f'{self.root / "bad"} is not valid UTF-8 text', str(caught.exception))

    def test_make_dir_creates_with_the_mode_and_refuses_a_symlink_target_or_parent(self):
        self.host.make_dir(self.root / 'new', 0o750, os.getuid(), os.getgid())
        self.assertEqual(0o750, stat.S_IMODE((self.root / 'new').stat().st_mode))
        (self.root / 'real').mkdir()
        (self.root / 'linkdir').symlink_to(self.root / 'real')
        (self.root / 'dangling').symlink_to(self.root / 'nowhere')
        for target in ('linkdir', 'dangling', 'new'):
            with self.assertRaises(FileExistsError):
                self.host.make_dir(self.root / target, 0o750, os.getuid(), os.getgid())
        with self.assertRaises(OSError):
            self.host.make_dir(self.root / 'linkdir' / 'child', 0o750, os.getuid(), os.getgid())
        self.assertFalse((self.root / 'real' / 'child').exists())
        self.assertFalse((self.root / 'nowhere').exists())

    def test_a_hung_command_is_an_item_error_naming_only_the_program(self):
        with self.assertRaises(bringup.ItemError) as caught:
            bringup.Host(timeout=0.2).run(['sleep', '5'])
        self.assertEqual('sleep timed out', str(caught.exception))
        self.assertEqual(120, bringup.COMMAND_TIMEOUT_SECONDS)
        self.assertEqual(bringup.COMMAND_TIMEOUT_SECONDS, bringup.Host().timeout)

    @unittest.skipIf(os.geteuid() == 0, 'root may chown to any uid')
    def test_make_dir_removes_the_directory_it_made_when_the_chown_fails(self):
        with self.assertRaises(PermissionError):
            self.host.make_dir(self.root / 'half', 0o750, 0, 0)
        self.assertFalse((self.root / 'half').exists())

    def test_scratch_dir_is_private_and_removed_on_exit_and_on_error(self):
        with self.host.scratch_dir() as path:
            self.assertEqual(0o700, stat.S_IMODE(os.stat(path).st_mode))
        self.assertFalse(os.path.exists(path))
        with self.assertRaises(RuntimeError):
            with self.host.scratch_dir() as failed:
                self.assertTrue(os.path.isdir(failed))
                raise RuntimeError('boom')
        self.assertFalse(os.path.exists(failed))

    def test_every_open_on_a_write_or_read_path_uses_o_nofollow(self):
        flags = []
        real_open = os.open

        def spy(path, flag, *args, **kwargs):
            flags.append(flag)
            return real_open(path, flag, *args, **kwargs)

        (self.root / 'f').write_text('A=1\n', encoding='utf-8')
        with mock.patch('os.open', spy):
            self.host.write_new(self.root / 'w', 'x', 0o600)
            self.host.read_text(self.root / 'f')
            self.host.read_env(self.root / 'f')
            self.host.make_dir(self.root / 'd', 0o750, os.getuid(), os.getgid())
        self.assertEqual(5, len(flags))
        self.assertTrue(all(flag & os.O_NOFOLLOW for flag in flags), flags)


if __name__ == '__main__':
    unittest.main()
