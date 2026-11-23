"""Tests for the effect gate: refusals, trust rule, config injection, relay, deletion switch and kill escalation."""
from __future__ import annotations

import json
import os
import select
import stat
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from pathlib import Path

from tools.shared_saas_lifecycle import effect_gate as gate
from tools.shared_saas_lifecycle import effect_schema as schema

FAKE_EFFECT = textwrap.dedent('''
    import json, os, signal, sys, time
    mode = sys.argv[1]
    request = json.loads(sys.stdin.readline())
    def say(value):
        print(json.dumps(value), flush=True)
    if mode == 'echo':
        say({'request': request})
        say({'permit': 'stage'})
        say({'got': json.loads(sys.stdin.readline())})
        sys.exit(3)
    if mode == 'env':
        say({'env': dict(os.environ)})
    if mode == 'ignoreterm':
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        say({'ready': os.getpid()})
        time.sleep(60)
    if mode == 'termexit':
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
        say({'ready': os.getpid()})
        time.sleep(60)
    if mode == 'chatter':
        say({'ready': os.getpid()})
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        while True:
            say({'tick': 1})
            time.sleep(0.05)
    if mode == 'partial':
        sys.stdout.write('{"tail": 1}')
        sys.stdout.flush()
''')


def stat_of(mode, uid):
    return os.stat_result((mode, 0, 0, 1, uid, 0, 0, 0, 0, 0))


class GateCase(unittest.TestCase):
    def setUp(self):
        self.root = Path(os.path.realpath(tempfile.mkdtemp()))
        self.addCleanup(lambda: __import__('shutil').rmtree(self.root, ignore_errors=True))
        self.euid = os.geteuid()
        os.chmod(self.root, 0o755)
        self.script = self.root / 'fake_effect.py'
        self.script.write_text(FAKE_EFFECT)
        self.compose = self.write('shared.compose.json', '{}')
        self.envfile = self.write('shared.env', '')
        self.state = self.root / 'state'
        self.state.mkdir(mode=0o755)
        os.chmod(self.state, 0o755)
        self.config = {'schemaVersion': 1, 'projectName': 'liwan-shared-x', 'composeFile': str(self.compose),
                       'envFile': str(self.envfile), 'stateDir': str(self.state), 'domainSuffix': 'x.test',
                       'releaseBackupConfig': str(self.root / 'release.json')}
        self.config_file = self.write('shared-runtime.json', json.dumps(self.config))
        self.env = {gate.CONFIG_ENV: str(self.config_file), 'PATH': '/usr/bin:/bin'}
        self.effects = {name: name for name in ('echo', 'env', 'ignoreterm', 'termexit', 'partial', 'chatter', 'tenant_drop_effect')}

    def write(self, name, text):
        path = self.root / name
        path.write_text(text)
        os.chmod(path, 0o644)
        return path

    def lstat(self, path):
        """Real stat below the temp root; directories above it count as root-owned and closed."""
        if path == '/' or str(self.root).startswith(path.rstrip('/') + '/'):
            return stat_of(stat.S_IFDIR | 0o755, 0)
        return os.lstat(path)

    def argv(self, module):
        return [sys.executable, str(self.script), module]

    def connect(self, head, request, env=None, grace=0.3, stop=None, **kwargs):
        """Runs one gate connection in a thread; returns an object to talk to it."""
        return Connection(self, head, request, self.env if env is None else env, grace, stop, kwargs)

    def converse(self, head, request, **kwargs):
        # The input stays open: stdin EOF is the peer hanging up.
        return self.connect(head, request, **kwargs).finish()


class Connection:
    def __init__(self, case, head, request, env, grace, stop, kwargs):
        self.case = case
        self.in_r, self.in_w = os.pipe()
        self.out_r, self.out_w = os.pipe()
        self.stop = stop or threading.Event()
        self.result = []
        self.buffer = b''
        self.thread = threading.Thread(target=lambda: self.result.append(gate.run(
            self.in_r, self.out_w, env, stop=self.stop, effects=case.effects, argv=case.argv, grace=grace,
            head_timeout=2, euid=kwargs.get('euid', case.euid), lstat=kwargs.get('lstat', case.lstat), validator=kwargs.get('validator', lambda _effect, request: request))))
        self.thread.start()
        if head is not None:
            os.write(self.in_w, head if isinstance(head, bytes) else (json.dumps(head) + '\n').encode())
        if request is not None:
            os.write(self.in_w, request if isinstance(request, bytes) else (json.dumps(request) + '\n').encode())

    def read_line(self, timeout=5):
        deadline = time.monotonic() + timeout
        while b'\n' not in self.buffer:
            if not select.select([self.out_r], [], [], max(0, deadline - time.monotonic()))[0]:
                raise AssertionError('no output line')
            chunk = os.read(self.out_r, 65536)
            if not chunk:
                raise AssertionError('output closed')
            self.buffer += chunk
        line, self.buffer = self.buffer.split(b'\n', 1)
        return json.loads(line)

    def send(self, value):
        os.write(self.in_w, (json.dumps(value) + '\n').encode())

    def close_input(self):
        if self.in_w is not None:
            os.close(self.in_w)
            self.in_w = None

    def finish(self):
        """Joins the gate and returns (all output lines, exit code of run)."""
        self.thread.join(10)
        assert not self.thread.is_alive(), 'gate did not finish'
        os.close(self.out_w)
        data = self.buffer
        while self.out_r is not None:
            chunk = os.read(self.out_r, 65536)
            if not chunk:
                break
            data += chunk
        if self.out_r is not None:
            os.close(self.out_r)
        os.close(self.in_r)
        if self.in_w is not None:
            os.close(self.in_w)
        return [json.loads(line) for line in data.splitlines()], self.result[0]


class RefusalTests(GateCase):
    def refused(self, head, request, code, **kwargs):
        lines, status = self.converse(head, request, **kwargs)
        self.assertEqual(lines, [{'error_code': code}, {'exit': 2}])
        self.assertEqual(status, 2)

    def test_unknown_effect_and_bad_head(self):
        self.refused({'effect': 'rm'}, {}, 'effect_unknown')
        self.refused({'effect': 'echo', 'x': 1}, {}, 'request_invalid')
        self.refused({'effect': ['echo']}, {}, 'request_invalid')
        self.refused(b'not json\n', {}, 'request_invalid')

    def test_missing_or_bad_request(self):
        self.refused({'effect': 'echo'}, None, 'request_invalid')
        self.refused({'effect': 'echo'}, b'[1]\n', 'request_invalid')
        self.refused({'effect': 'echo'}, b'{broken\n', 'request_invalid')

    def test_oversize_request(self):
        big = b'{"a":"' + b'x' * gate.MAX_REQUEST + b'"}\n'
        self.refused({'effect': 'echo'}, big, 'request_invalid')

    def test_request_at_the_limit_is_accepted(self):
        pad = gate.MAX_REQUEST - len(b'{"a":""}')
        lines, status = self.converse({'effect': 'partial'}, b'{"a":"' + b'x' * pad + b'"}\n', grace=0.1)
        self.assertNotEqual(lines[0].get('error_code'), 'request_invalid')

    def test_request_with_config_is_refused_without_echo(self):
        lines, _ = self.converse({'effect': 'echo'}, {'config': {'composeFile': '/evil'}, 'secret': 'S3CRET'})
        self.assertEqual(lines, [{'error_code': 'config_forbidden'}, {'exit': 2}])
        self.assertNotIn('S3CRET', json.dumps(lines))

    def test_runtime_unconfigured_and_invalid(self):
        self.refused({'effect': 'echo'}, {}, 'runtime_unconfigured', env={})
        self.config_file.write_text('[1]')
        self.refused({'effect': 'echo'}, {}, 'runtime_invalid')
        self.config_file.write_text(json.dumps({'composeFile': 1}))
        self.refused({'effect': 'echo'}, {}, 'runtime_invalid')
        self.config_file.write_text('{broken')
        self.refused({'effect': 'echo'}, {}, 'runtime_invalid')

    def test_untrusted_files_and_directories(self):
        os.chmod(self.config_file, 0o664)
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted')
        os.chmod(self.config_file, 0o644)
        os.chmod(self.compose, 0o646)
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted')
        os.chmod(self.compose, 0o644)
        os.chmod(self.envfile, 0o660)
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted')
        os.chmod(self.envfile, 0o644)
        os.chmod(self.root, 0o775)  # an ancestor of every path
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted')

    def test_untrusted_owner_and_missing_file_and_symlink(self):
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted', euid=self.euid + 1)  # files owned by another account
        link = self.root / 'link.json'
        link.symlink_to(self.config_file)
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted', env={gate.CONFIG_ENV: str(link)})
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted', env={gate.CONFIG_ENV: str(self.root / 'absent.json')})
        self.refused({'effect': 'echo'}, {}, 'runtime_untrusted', env={gate.CONFIG_ENV: 'relative.json'})

    def test_refusal_never_echoes_environment(self):
        env = dict(self.env, SECRET_TOKEN='S3CRET')
        lines, _ = self.converse({'effect': 'echo'}, {}, env=env, euid=self.euid + 1)
        self.assertNotIn('S3CRET', json.dumps(lines))

    def test_effect_start_failure(self):
        self.argv = lambda module: ['/nonexistent/python']
        self.refused({'effect': 'echo'}, {}, 'effect_start_failed')


class TrustRuleTests(unittest.TestCase):
    """The root-or-euid ownership branch, with injected stat results."""

    def fs(self, entries):
        def lstat(path):
            if path in entries:
                return stat_of(*entries[path])
            raise FileNotFoundError(path)
        return lstat

    DIR = stat.S_IFDIR | 0o755
    FILE = stat.S_IFREG | 0o640

    def test_root_and_euid_owners_pass(self):
        base = {'/': (self.DIR, 0), '/srv': (self.DIR, 0), '/srv/c': (self.DIR, 700), '/srv/c/f.json': (self.FILE, 700)}
        gate.check_file('/srv/c/f.json', 700, self.fs(base))
        base['/srv/c/f.json'] = (self.FILE, 0)
        gate.check_file('/srv/c/f.json', 700, self.fs(base))

    def test_other_owner_fails_for_file_and_ancestor(self):
        base = {'/': (self.DIR, 0), '/srv': (self.DIR, 0), '/srv/c': (self.DIR, 700), '/srv/c/f.json': (self.FILE, 700)}
        for path, entry in (('/srv/c/f.json', (self.FILE, 999)), ('/srv/c', (self.DIR, 999)), ('/srv', (self.DIR, 999))):
            broken = dict(base, **{path: entry})
            with self.assertRaises(gate.Refusal) as caught:
                gate.check_file('/srv/c/f.json', 700, self.fs(broken))
            self.assertEqual(caught.exception.code, 'runtime_untrusted')

    def test_state_dir_group_writable_needs_sticky(self):
        chain = {'/': (self.DIR, 0), '/srv': (self.DIR, 0)}
        gate.check_state_dir('/srv/s', 700, self.fs(dict(chain, **{'/srv/s': (stat.S_IFDIR | 0o3770, 0)})))
        for mode in (stat.S_IFDIR | 0o770, stat.S_IFDIR | 0o1777, stat.S_IFDIR | 0o3777):
            with self.assertRaises(gate.Refusal):
                gate.check_state_dir('/srv/s', 700, self.fs(dict(chain, **{'/srv/s': (mode, 0)})))

    def test_effect_subdirectories_must_belong_to_the_gate_account(self):
        chain = {'/': (self.DIR, 0), '/srv': (self.DIR, 0), '/srv/s': (stat.S_IFDIR | 0o3770, 0)}
        gate.check_state_dir('/srv/s', 700, self.fs(chain))  # none created yet
        good = dict(chain, **{'/srv/s/' + name: (self.DIR, 700) for name in gate.EFFECT_STATE_DIRS})
        gate.check_state_dir('/srv/s', 700, self.fs(good))
        for owner in (0, 999):
            bad = dict(good, **{'/srv/s/backups': (self.DIR, owner)})
            with self.assertRaises(gate.Refusal):
                gate.check_state_dir('/srv/s', 700, self.fs(bad))
        # restore-registry belongs to the worker and is not checked
        gate.check_state_dir('/srv/s', 700, self.fs(dict(good, **{'/srv/s/restore-registry': (self.DIR, 999)})))


class EffectSubdirectoryModeTests(unittest.TestCase):
    DIR = stat.S_IFDIR

    def check(self, name, mode, owner=700):
        chain = {'/': (self.DIR, 0), '/srv': (self.DIR, 0), '/srv/s': (stat.S_IFDIR | 0o3770, 0), '/srv/s/' + name: (stat.S_IFDIR | mode, owner)}
        gate.check_state_dir('/srv/s', 700, lambda path: stat_of(*chain[path]) if path in chain else (_ for _ in ()).throw(FileNotFoundError(path)))

    def test_no_effect_subdirectory_may_be_writable_by_group_or_other(self):
        for name in gate.EFFECT_STATE_DIRS:
            for mode in (0o770, 0o720, 0o702, 0o777, 0o3770):
                with self.subTest(name=name, mode=oct(mode)), self.assertRaises(gate.Refusal) as caught:
                    self.check(name, mode)
                self.assertEqual('runtime_untrusted', caught.exception.code)

    def test_the_documented_read_bits_are_accepted(self):
        self.check('backups', 0o750)  # the worker reads manifests and cannot write
        self.check('classifications', 0o755)  # containers read it as another uid
        for name in gate.EFFECT_STATE_DIRS:
            self.check(name, 0o700)

    def test_a_symlink_or_file_in_place_of_a_subdirectory_is_refused(self):
        for kind in (stat.S_IFLNK, stat.S_IFREG):
            chain = {'/': (self.DIR, 0), '/srv': (self.DIR, 0), '/srv/s': (stat.S_IFDIR | 0o3770, 0), '/srv/s/backups': (kind | 0o700, 700)}
            with self.assertRaises(gate.Refusal):
                gate.check_state_dir('/srv/s', 700, lambda path: stat_of(*chain[path]) if path in chain else (_ for _ in ()).throw(FileNotFoundError(path)))


class StateDirectoryTests(GateCase):
    def test_group_writable_state_dir_without_sticky_is_refused(self):
        os.chmod(self.state, 0o775)
        lines, _ = self.converse({'effect': 'echo'}, {})
        self.assertEqual(lines[0], {'error_code': 'runtime_untrusted'})

    def test_sticky_group_writable_state_dir_is_accepted(self):
        os.chmod(self.state, 0o3770)
        conn = self.connect({'effect': 'echo'}, {})
        self.assertIn('request', conn.read_line())
        conn.send({'proceed': True})
        conn.finish()

    def test_effect_subdirectory_of_another_owner_is_refused(self):
        (self.state / 'backups').mkdir()
        real = self.lstat
        self.lstat = lambda path: stat_of(stat.S_IFDIR | 0o700, self.euid + 1) if path.endswith('/backups') else real(path)
        lines, _ = self.converse({'effect': 'echo'}, {})
        self.assertEqual(lines[0], {'error_code': 'runtime_untrusted'})


class RelayTests(GateCase):
    def test_config_injected_and_relay_both_ways_with_exit_line(self):
        conn = self.connect({'effect': 'echo'}, {'action': 'observe'})
        first = conn.read_line()
        self.assertEqual(first['request']['action'], 'observe')
        self.assertEqual(first['request']['config']['composeFile'], str(self.compose))
        self.assertEqual(first['request']['config']['releaseBackupConfig'], str(self.root / 'release.json'))
        self.assertEqual(conn.read_line(), {'permit': 'stage'})
        conn.send({'proceed': True})
        lines, status = conn.finish()
        self.assertEqual(lines, [{'got': {'proceed': True}}, {'exit': 3}])
        self.assertEqual(status, 3)

    def test_release_backup_config_stripped_for_the_drop_effect(self):
        self.effects['tenant_drop_effect'] = 'echo'
        conn = self.connect({'effect': 'tenant_drop_effect'}, {'action': 'verify', 'dryRun': True})
        config = conn.read_line()['request']['config']
        self.assertNotIn('releaseBackupConfig', config)
        self.assertEqual(config['projectName'], 'liwan-shared-x')
        conn.send({'proceed': True})
        conn.finish()

    def test_bytes_sent_with_the_request_reach_the_effect(self):
        lines, _ = self.converse({'effect': 'echo'}, json.dumps({'a': 1}).encode() + b'\n{"proceed":true}\n')
        self.assertEqual(lines[-2:], [{'got': {'proceed': True}}, {'exit': 3}])

    def test_partial_last_line_is_completed_before_the_exit_line(self):
        lines, status = self.converse({'effect': 'partial'}, {})
        self.assertEqual(lines, [{'tail': 1}, {'exit': 0}])
        self.assertEqual(status, 0)

    def test_child_environment_is_explicit(self):
        env = dict(self.env, SECRET_TOKEN='S3CRET', CONTROL_DATABASE_URL='postgres://x', LIWAN_TENANT_DELETION_ENABLED='true',
                   DOCKER_HOST='unix:///run/docker.sock', DOCKER_CONFIG='/etc/liwan/docker', HOME='/nonexistent',
                   LIWAN_RELEASE_ROUTES_DIR='/r', LIWAN_RELEASE_HELPER_POOL_ID='p', PYTHONPATH='/evil')
        lines, _ = self.converse({'effect': 'env'}, {}, env=env)
        child = lines[0]['env']
        self.assertNotIn('SECRET_TOKEN', child)
        self.assertNotIn('CONTROL_DATABASE_URL', child)
        self.assertNotIn(gate.CONFIG_ENV, child)
        self.assertNotIn(gate.DELETION_ENV, child)
        self.assertNotIn('PYTHONPATH', child)
        self.assertEqual(child['DOCKER_HOST'], 'unix:///run/docker.sock')
        self.assertEqual(child['LIWAN_RELEASE_HELPER_POOL_ID'], 'p')
        self.assertEqual(child['PYTHONUNBUFFERED'], '1')
        self.assertEqual(child['PATH'], '/usr/bin:/bin')


class DeletionSwitchTests(GateCase):
    def setUp(self):
        super().setUp()
        self.effects['tenant_drop_effect'] = 'echo'

    def test_real_drop_refused_without_the_flag(self):
        for request in ({'action': 'drop_database'}, {'action': 'drop_database', 'dryRun': False}, {'action': 'x', 'dryRun': 'true'},
                        {'action': 'x', 'dryRun': 1}):
            lines, _ = self.converse({'effect': 'tenant_drop_effect'}, request)
            self.assertEqual(lines, [{'error_code': 'deletion_disabled'}, {'exit': 2}], request)

    def test_flag_must_be_exactly_true(self):
        for value in ('1', 'True', 'yes', ''):
            lines, _ = self.converse({'effect': 'tenant_drop_effect'}, {'action': 'x'}, env=dict(self.env, **{gate.DELETION_ENV: value}))
            self.assertEqual(lines[0], {'error_code': 'deletion_disabled'}, value)

    def test_dry_run_passes_without_the_flag(self):
        conn = self.connect({'effect': 'tenant_drop_effect'}, {'action': 'verify', 'dryRun': True})
        self.assertIn('request', conn.read_line())
        conn.send({'proceed': True})
        conn.finish()

    def test_real_drop_passes_with_the_flag(self):
        conn = self.connect({'effect': 'tenant_drop_effect'}, {'action': 'drop_database'}, env=dict(self.env, **{gate.DELETION_ENV: 'true'}))
        self.assertIn('request', conn.read_line())
        conn.send({'proceed': True})
        conn.finish()

    def test_other_effects_ignore_the_switch(self):
        conn = self.connect({'effect': 'echo'}, {'action': 'x'})
        self.assertIn('request', conn.read_line())
        conn.send({'proceed': True})
        conn.finish()


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


class KillTests(GateCase):
    def start_ignoring(self, **kwargs):
        conn = self.connect({'effect': 'ignoreterm'}, {}, **kwargs)
        pid = conn.read_line()['ready']
        self.addCleanup(lambda: alive(pid) and os.kill(pid, 9))
        return conn, pid

    def test_hang_up_terminates_then_kills_the_group_after_the_grace(self):
        conn, pid = self.start_ignoring(grace=0.4)
        started = time.monotonic()
        conn.close_input()
        conn.thread.join(10)
        self.assertGreaterEqual(time.monotonic() - started, 0.35)  # TERM was ignored, so the grace elapsed
        self.assertFalse(alive(pid))
        conn.finish()

    def test_hang_up_ends_quickly_when_the_effect_obeys_term(self):
        conn = self.connect({'effect': 'termexit'}, {}, grace=5)
        pid = conn.read_line()['ready']
        started = time.monotonic()
        conn.close_input()
        conn.thread.join(10)
        self.assertLess(time.monotonic() - started, 3)
        self.assertFalse(alive(pid))
        conn.finish()

    def test_output_write_failure_counts_as_hang_up(self):
        conn = self.connect({'effect': 'chatter'}, {}, grace=0.2)
        pid = conn.read_line()['ready']
        self.addCleanup(lambda: alive(pid) and os.kill(pid, 9))
        os.close(conn.out_r)
        conn.out_r = None
        conn.thread.join(10)
        self.assertFalse(conn.thread.is_alive())
        self.assertFalse(alive(pid))
        conn.finish()

    def test_stop_flag_kills_the_group_and_reports_the_exit(self):
        conn, pid = self.start_ignoring(grace=0.2)
        conn.stop.set()
        lines, status = conn.finish()
        self.assertFalse(alive(pid))
        self.assertEqual(lines[-1], {'exit': 128 + 9})
        self.assertEqual(status, 137)

    def test_grandchild_in_the_group_is_killed_too(self):
        script = self.root / 'spawner.py'
        script.write_text(textwrap.dedent('''
            import json, os, signal, subprocess, sys, time
            sys.stdin.readline()
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            kid = subprocess.Popen([sys.executable, '-c', 'import signal,time;signal.signal(signal.SIGTERM, signal.SIG_IGN);time.sleep(60)'])
            print(json.dumps({'ready': kid.pid}), flush=True)
            time.sleep(60)
        '''))
        self.script = script
        conn = self.connect({'effect': 'echo'}, {}, grace=0.3)
        kid = conn.read_line()['ready']
        self.addCleanup(lambda: alive(kid) and os.kill(kid, 9))
        conn.close_input()
        conn.finish()
        time.sleep(0.1)
        self.assertFalse(alive(kid))


UUID_A = '687674dc-5789-4a99-b151-12d69f010cc3'
UUID_B = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
UUID_C = '3f2b8c1e-5d4a-4e6f-9a7b-0c1d2e3f4a5b'
DIGEST = 'a' * 64
SCRATCH = 'liwan_scratch_' + 'b' * 32
BINDING = {'tenantId': 'acme', 'database': SCRATCH, 'filestore': SCRATCH, 'registryRevision': 2}
CATALOG = {'version': '19.0.1', 'tier': 'standard', 'sourceSha256': DIGEST}
POLICY = {'schema_version': 1, 'channel': 'control_plane', 'modules': ['liwan_core', 'liwan_platform'],
          'features': {'users.limit': 10, 'storage.limit_mb': 100, 'pmo.enabled': True, 'x.y': None}}
ACTOR = {'issuer': 'commercial-fulfillment', 'actorUid': 1}


def business_key(operation, request_id=UUID_A):
    return json.dumps(['shared-v1', 'acme', operation, 'initial' if operation == 'provision' else request_id], separators=(',', ':'))


def provision_request(**over):
    request = {'action': 'apply', 'job': {'schemaVersion': 1, 'requestId': UUID_A, 'binding': BINDING, 'operation': 'provision',
                                          'catalog': CATALOG, 'policy': POLICY},
               'businessKey': business_key('provision'), 'payloadDigest': DIGEST,
               'admin': {'name': 'Customer Administrator', 'login': 'admin@example.test', 'mobile': '+966500000000'},
               'companyName': 'Acme Trading', 'host': 'tacme.example.test', 'controlTenantId': UUID_C,
               'attemptId': UUID_B, 'fence': 7}
    request.update(over)
    return request


def package_authority():
    return {'schemaVersion': 2, 'revisionId': UUID_B, 'digest': DIGEST, 'catalog': CATALOG, 'policy': POLICY}


def backup_request(**over):
    request = {'action': 'apply', 'job': {'schemaVersion': 1, 'requestId': UUID_A, 'binding': BINDING, 'operation': 'backup'},
               'businessKey': business_key('backup'), 'payloadDigest': DIGEST,
               'authority': {'controlTenantId': UUID_C, 'actor': ACTOR, 'backupId': UUID_A, 'manifestSha256': DIGEST},
               'attemptId': UUID_B, 'fence': 3}
    request.update(over)
    return request


def restore_request(**over):
    request = {'action': 'observe', 'job': {'schemaVersion': 1, 'requestId': UUID_A, 'binding': BINDING, 'operation': 'restore', 'approvalId': UUID_B,
                                            'backup': {'schemaVersion': 1, 'backupId': UUID_C, 'binding': BINDING, 'databaseSha256': DIGEST,
                                                       'filestoreSha256': DIGEST, 'consistency': 'verified'}},
               'businessKey': business_key('restore'), 'payloadDigest': DIGEST,
               'authority': {'controlTenantId': UUID_C, 'actor': ACTOR, 'backupId': UUID_C, 'approvalId': UUID_B, 'targetDatabase': SCRATCH,
                             'manifestSha256': DIGEST, 'databaseSha256': DIGEST, 'filestoreSha256': DIGEST},
               'commercial': {'revisionId': UUID_B, 'digest': DIGEST}}
    request.update(over)
    return request


def subscription_request(**over):
    request = {'action': 'reconfigure', 'tenant': {'database': SCRATCH, 'host': 'tacme.example.test'}, 'releaseBinding': BINDING,
               'order_id': UUID_A, 'operation_id': UUID_B, 'previous_revision_id': None, 'target_revision_id': UUID_C,
               'entitlement': {'modules': ['liwan_core', 'liwan_pmo'], 'features': {'users.limit': 10, 'pmo.enabled': True}, 'digest': DIGEST,
                               'compiler_version': 1},
               'branches': {'apply': [{'branch_id': UUID_A, 'name': 'Main branch'}], 'archive': [UUID_B], 'restore': [UUID_C]},
               'commercial_valid_until': '2027-01-01', 'commercial_valid_until_revision': 4, 'trial_ends_at': '2026-12-01T00:00:00.000Z',
               'post_trial_features': {'users.limit': 3}, 'post_trial_modules': ['liwan_core'], 'post_trial_digest': DIGEST,
               'excess_settle': True, 'admin_login': 'admin@example.test', 'attemptId': UUID_B, 'fence': 1,
               'restore': {'requestId': UUID_A, 'approvalId': UUID_B, 'backupId': UUID_C, 'digest': DIGEST, 'manifestSha256': DIGEST}}
    request.update(over)
    return request


def subscription_observe(**over):
    request = {'action': 'observe', 'tenant': {'database': SCRATCH, 'host': 'tacme.example.test'}, 'releaseBinding': BINDING,
               'attemptId': UUID_A, 'fence': 0}
    request.update(over)
    return request


def password_request(**over):
    request = {'action': 'set_admin_password', 'tenant': {'database': SCRATCH, 'host': 'tacme.example.test'}, 'releaseBinding': BINDING,
               'login': 'admin@example.test', 'password': 'a long Passw0rd / with symbols'}
    request.update(over)
    return request


def status_request(**over):
    request = {'action': 'set_tenant_status', 'tenant': {'database': SCRATCH, 'host': 'tacme.example.test'}, 'releaseBinding': BINDING,
               'status': 'suspended', 'reason': 'non_payment'}
    request.update(over)
    return request


def drop_request(**over):
    request = {'action': 'verify', 'dryRun': False, 'planDigest': DIGEST,
               'plan': {'schemaVersion': 1, 'requestId': UUID_A, 'controlTenantId': UUID_C, 'tenantId': 'acme', 'database': 'liwan_acme',
                        'filestore': 'liwan_acme', 'host': 'tacme.example.test', 'customerName': 'Acme / Trading', 'controlPlaneDatabase': 'liwan_control',
                        'restoreCopies': [SCRATCH], 'backupIds': [UUID_A, UUID_B]}}
    request.update(over)
    return request


def at(request, path, value):
    """A deep copy of the request with the value at `path` replaced (a key of None removes it)."""
    copy = json.loads(json.dumps(request))
    node = copy
    for key in path[:-1]:
        node = node[key]
    if value is DELETE:
        del node[path[-1]]
    else:
        node[path[-1]] = value
    return copy


DELETE = object()
TRAVERSAL = ('../x', 'a/b', 'a\\b', 'a\x00b', '..', '.', '/etc/passwd', 'x/../../y', '')

# (effect, request builder, path to an identifier field): every one is refused for each traversal value
IDENTIFIER_FIELDS = [
    ('odoo_effect', provision_request, path) for path in (
        ('job', 'requestId'), ('job', 'binding', 'tenantId'), ('job', 'binding', 'database'), ('job', 'binding', 'filestore'),
        ('job', 'catalog', 'version'), ('job', 'catalog', 'tier'), ('job', 'catalog', 'sourceSha256'), ('job', 'policy', 'modules', 0),
        ('businessKey',), ('payloadDigest',), ('host',), ('controlTenantId',), ('attemptId',))
] + [
    ('odoo_backup', backup_request, path) for path in (
        ('job', 'requestId'), ('job', 'binding', 'database'), ('businessKey',), ('payloadDigest',), ('attemptId',),
        ('authority', 'controlTenantId'), ('authority', 'backupId'), ('authority', 'manifestSha256'))
] + [
    ('odoo_backup', restore_request, path) for path in (
        ('job', 'approvalId'), ('job', 'backup', 'backupId'), ('job', 'backup', 'databaseSha256'), ('authority', 'targetDatabase'),
        ('authority', 'approvalId'), ('authority', 'backupId'), ('commercial', 'revisionId'), ('commercial', 'digest'))
] + [
    ('subscription_effect', subscription_request, path) for path in (
        ('tenant', 'database'), ('tenant', 'host'), ('releaseBinding', 'tenantId'), ('order_id',), ('operation_id',), ('target_revision_id',),
        ('entitlement', 'digest'), ('entitlement', 'modules', 0), ('branches', 'archive', 0), ('branches', 'apply', 0, 'branch_id'),
        ('post_trial_digest',), ('post_trial_modules', 0), ('attemptId',), ('commercial_valid_until',),
        ('restore', 'requestId'), ('restore', 'backupId'), ('restore', 'approvalId'), ('restore', 'digest'), ('restore', 'manifestSha256'))
] + [
    ('admin_password_effect', password_request, path) for path in (('tenant', 'database'), ('tenant', 'host'), ('releaseBinding', 'database'))
] + [
    ('tenant_status_effect', status_request, path) for path in (('tenant', 'database'), ('tenant', 'host'), ('releaseBinding', 'filestore'))
] + [
    ('tenant_drop_effect', drop_request, path) for path in (
        ('planDigest',), ('plan', 'requestId'), ('plan', 'controlTenantId'), ('plan', 'tenantId'), ('plan', 'database'), ('plan', 'filestore'),
        ('plan', 'host'), ('plan', 'controlPlaneDatabase'), ('plan', 'restoreCopies', 0), ('plan', 'backupIds', 0), ('action',))
]

VALID = [
    ('odoo_effect', provision_request()),
    ('odoo_effect', provision_request(action='observe', attemptId=DELETE, fence=DELETE)),
    ('odoo_effect', at(provision_request(packageAuthority=package_authority()), ('job', 'packageAuthority'), package_authority())),
    ('odoo_effect', at(provision_request(), ('admin',), {'name': 'A', 'login': 'a@b.test'})),
    ('odoo_backup', backup_request()),
    ('odoo_backup', at(backup_request(action='observe'), ('authority', 'manifestSha256'), DELETE)),
    ('odoo_backup', restore_request()),
    ('odoo_backup', at(restore_request(), ('commercial',), DELETE)),
    ('subscription_effect', subscription_request()),
    ('subscription_effect', subscription_request(previous_revision_id=UUID_A, trial_ends_at=None, ai_push=True, ai_expected_post_trial_digest=DIGEST,
                                                 recoverable_predecessors=[{'revision_id': UUID_A, 'digest': DIGEST}])),
    ('subscription_effect', subscription_observe()),
    ('subscription_effect', subscription_observe(restore=subscription_request()['restore'], releaseBinding=DELETE)),
    ('admin_password_effect', password_request()),
    ('tenant_status_effect', status_request()),
    ('tenant_status_effect', status_request(status='active', reason=None)),
] + [('tenant_drop_effect', drop_request(action=stage)) for stage in schema.DROP_STAGES] + [
    ('tenant_drop_effect', drop_request(action='drop_database', dryRun=True)),
    ('tenant_drop_effect', at(drop_request(), ('dryRun',), DELETE)),
]


def drop_marked(request):
    """Fixtures mark a key to remove with the DELETE sentinel; the JSON round trip of `at` cannot carry it."""
    if not isinstance(request, dict):
        return request
    return {key: drop_marked(value) for key, value in request.items() if value is not DELETE}


class RequestSchemaTests(unittest.TestCase):
    def accepts(self, effect, request):
        schema.validate(effect, drop_marked(request))

    def refuses(self, effect, request):
        with self.assertRaises(schema.SchemaError):
            schema.validate(effect, drop_marked(request))

    def test_every_request_shape_the_control_plane_sends_passes(self):
        for index, (effect, request) in enumerate(VALID):
            with self.subTest(effect=effect, index=index):
                self.accepts(effect, request)

    def test_the_effects_are_exactly_the_gates(self):
        self.assertEqual(set(gate.EFFECTS), set(schema.SCHEMAS))

    def test_the_drop_stages_are_the_effects_own(self):
        from tools.shared_saas_lifecycle import tenant_drop_effect
        self.assertEqual(tuple(tenant_drop_effect.STAGES), schema.DROP_STAGES)

    def test_traversal_and_separators_are_refused_in_every_identifier_field(self):
        for effect, build, path in IDENTIFIER_FIELDS:
            for value in TRAVERSAL:
                with self.subTest(effect=effect, path=path, value=value):
                    self.refuses(effect, at(build(), path, value))

    def test_a_double_dot_component_or_slash_hidden_inside_a_longer_value_is_refused(self):
        for value in (UUID_A + '/..', '../' + UUID_A, UUID_A + '\\', 'liwan_scratch_' + 'b' * 31 + '/'):
            self.refuses('odoo_backup', at(restore_request(), ('authority', 'targetDatabase'), value))
            self.refuses('odoo_backup', at(restore_request(), ('authority', 'backupId'), value))

    def test_an_unknown_top_level_or_nested_key_is_refused(self):
        for effect, build in (('odoo_effect', provision_request), ('odoo_backup', backup_request), ('odoo_backup', restore_request),
                              ('subscription_effect', subscription_request), ('admin_password_effect', password_request),
                              ('tenant_status_effect', status_request), ('tenant_drop_effect', drop_request)):
            with self.subTest(effect=effect):
                self.refuses(effect, {**build(), 'extra': 1})
                self.refuses(effect, {**build(), 'config': {}})
        self.refuses('odoo_effect', at(provision_request(), ('job', 'extra'), 1))
        self.refuses('odoo_effect', at(provision_request(), ('job', 'binding', 'extra'), 1))
        self.refuses('odoo_effect', at(provision_request(), ('admin', 'extra'), 1))
        self.refuses('odoo_backup', at(backup_request(), ('authority', 'actor', 'extra'), 1))
        self.refuses('subscription_effect', at(subscription_request(), ('tenant', 'extra'), 1))
        self.refuses('subscription_effect', at(subscription_request(), ('entitlement', 'extra'), 1))
        self.refuses('subscription_effect', at(subscription_request(), ('branches', 'extra'), 1))
        self.refuses('tenant_drop_effect', at(drop_request(), ('plan', 'extra'), 1))

    def test_a_missing_required_key_is_refused(self):
        for effect, build, path in (('odoo_effect', provision_request, ('host',)), ('odoo_effect', provision_request, ('job', 'policy')),
                                    ('odoo_backup', backup_request, ('authority',)), ('odoo_backup', restore_request, ('authority', 'targetDatabase')),
                                    ('subscription_effect', subscription_request, ('tenant',)), ('subscription_effect', subscription_request, ('attemptId',)),
                                    ('admin_password_effect', password_request, ('password',)), ('tenant_status_effect', status_request, ('reason',)),
                                    ('tenant_drop_effect', drop_request, ('plan',))):
            with self.subTest(effect=effect, path=path):
                self.refuses(effect, at(build(), path, DELETE))
        reconfigure = subscription_request()
        for key in ('order_id', 'entitlement', 'branches', 'target_revision_id', 'operation_id', 'previous_revision_id'):
            self.refuses('subscription_effect', at(reconfigure, (key,), DELETE))

    def test_wrong_types_are_refused(self):
        for effect, build, path, value in (
                ('odoo_effect', provision_request, ('fence',), '7'), ('odoo_effect', provision_request, ('fence',), True),
                ('odoo_effect', provision_request, ('fence',), -1), ('odoo_effect', provision_request, ('fence',), 1.5),
                ('odoo_effect', provision_request, ('job', 'binding', 'registryRevision'), 0),
                ('odoo_effect', provision_request, ('job', 'policy', 'features'), []), ('odoo_effect', provision_request, ('job', 'policy', 'modules'), []),
                ('odoo_effect', provision_request, ('job', 'policy', 'features', 'x.y'), 'yes'),
                ('odoo_effect', provision_request, ('action',), 'drop'), ('odoo_effect', provision_request, ('admin',), 'root'),
                ('odoo_backup', backup_request, ('authority', 'actor', 'actorUid'), '1'), ('odoo_backup', backup_request, ('authority', 'actor', 'actorUid'), 0),
                ('odoo_backup', backup_request, ('job', 'operation'), 'drop'), ('odoo_backup', restore_request, ('job', 'backup', 'consistency'), 'maybe'),
                ('subscription_effect', subscription_request, ('excess_settle',), False), ('subscription_effect', subscription_request, ('trial_ends_at',), 'tomorrow'),
                ('subscription_effect', subscription_request, ('branches', 'apply'), {}), ('subscription_effect', subscription_request, ('entitlement', 'features'), []),
                ('subscription_effect', subscription_request, ('entitlement', 'compiler_version'), True),
                ('subscription_effect', subscription_request, ('commercial_valid_until_revision',), -1),
                ('admin_password_effect', password_request, ('password',), 123), ('admin_password_effect', password_request, ('password',), 'x\x00y' * 6),
                ('tenant_status_effect', status_request, ('status',), 'deleted'), ('tenant_status_effect', status_request, ('reason',), 'because'),
                ('tenant_drop_effect', drop_request, ('dryRun',), 'false'), ('tenant_drop_effect', drop_request, ('dryRun',), 0),
                ('tenant_drop_effect', drop_request, ('plan', 'schemaVersion'), 2), ('tenant_drop_effect', drop_request, ('plan', 'restoreCopies'), 'x'),
                ('tenant_drop_effect', drop_request, ('action',), 'drop_everything')):
            with self.subTest(effect=effect, path=path, value=value):
                self.refuses(effect, at(build(), path, value))
        self.refuses('odoo_effect', [])
        self.refuses('odoo_effect', 'x')
        self.refuses('odoo_backup', {})

    def test_oversize_values_are_refused(self):
        for effect, build, path, value in (
                ('odoo_effect', provision_request, ('host',), 'a' * 300), ('odoo_effect', provision_request, ('companyName',), 'c' * 513),
                ('odoo_effect', provision_request, ('admin', 'login'), 'l' * 257), ('odoo_effect', provision_request, ('job', 'policy', 'modules'), ['liwan_core'] * 2),
                ('odoo_effect', provision_request, ('job', 'policy', 'modules'), ['liwan_m%d' % n for n in range(1025)]),
                ('odoo_backup', backup_request, ('authority', 'actor', 'issuer'), 'i' * 257),
                ('subscription_effect', subscription_request, ('branches', 'archive'), [UUID_A] * 257),
                ('subscription_effect', subscription_request, ('entitlement', 'features'), {'k%d.x' % n: 1 for n in range(257)}),
                ('subscription_effect', subscription_request, ('admin_login',), 'l' * 255),
                ('subscription_effect', subscription_request, ('branches', 'apply', 0, 'name'), 'n' * 121),
                ('admin_password_effect', password_request, ('password',), 'p' * 257), ('admin_password_effect', password_request, ('login',), 'l' * 257),
                ('tenant_drop_effect', drop_request, ('plan', 'customerName'), 'c' * 201),
                ('tenant_drop_effect', drop_request, ('plan', 'backupIds'), [UUID_A] * 2)):
            with self.subTest(effect=effect, path=path):
                self.refuses(effect, at(build(), path, value))

    def test_free_text_fields_may_hold_a_slash_but_not_a_control_character(self):
        self.accepts('odoo_backup', at(backup_request(), ('authority', 'actor', 'issuer'), 'https://issuer.example.test/realm'))
        self.accepts('tenant_drop_effect', at(drop_request(), ('plan', 'customerName'), 'A/B \\ C'))
        self.accepts('odoo_effect', at(provision_request(), ('companyName',), 'Acme / Trading'))
        for effect, build, path in (('odoo_backup', backup_request, ('authority', 'actor', 'issuer')), ('tenant_drop_effect', drop_request, ('plan', 'customerName')),
                                    ('odoo_effect', provision_request, ('companyName',)), ('odoo_effect', provision_request, ('admin', 'login')),
                                    ('subscription_effect', subscription_request, ('admin_login',))):
            for value in ('a\x00b', 'a\nb', 'a\x1bb'):
                with self.subTest(path=path, value=value):
                    self.refuses(effect, at(build(), path, value))

    def test_the_business_key_must_be_the_exact_shape_the_control_plane_builds(self):
        for value in ('["shared-v1","acme","provision","initial"] ', '["shared-v1","a/b","provision","initial"]', '["shared-v1","acme","drop","initial"]',
                      '["shared-v1","acme","provision","../x"]', 'shared-v1', '["shared-v1","acme","backup","' + UUID_A + '"],1'):
            with self.subTest(value=value):
                self.refuses('odoo_effect', at(provision_request(), ('businessKey',), value))

    def test_the_job_decides_the_authority_shape_of_the_backup_effect(self):
        self.refuses('odoo_backup', {**backup_request(), 'authority': restore_request()['authority']})
        self.refuses('odoo_backup', {**restore_request(), 'authority': backup_request()['authority']})
        self.refuses('odoo_backup', at(backup_request(), ('job', 'operation'), 'provision'))
        self.refuses('odoo_backup', {**backup_request(), 'commercial': restore_request()['commercial']})


class GateRequestSchemaTests(GateCase):
    """The schema runs inside the gate, after the head and before the deletion switch, the config and the start of the effect."""

    def setUp(self):
        super().setUp()
        self.effects = {name: 'echo' for name in gate.EFFECTS}

    def refused(self, head, request):
        lines, code = self.converse(head, request, validator=schema.validate)
        self.assertEqual([{'error_code': 'request_invalid'}, {'exit': 2}], lines)
        self.assertEqual(2, code)

    def test_a_traversal_in_an_identifier_never_starts_the_effect(self):
        self.refused({'effect': 'odoo_backup'}, at(backup_request(), ('authority', 'backupId'), '../../../etc'))
        self.refused({'effect': 'tenant_drop_effect'}, at(drop_request(dryRun=True), ('plan', 'backupIds', 0), '../x'))

    def test_an_unknown_key_is_refused(self):
        self.refused({'effect': 'tenant_status_effect'}, {**status_request(), 'composeFile': '/tmp/evil.yml'})

    def test_the_schema_runs_before_the_deletion_switch(self):
        self.refused({'effect': 'tenant_drop_effect'}, {**drop_request(), 'x': 1})

    def test_a_valid_request_reaches_the_effect_with_the_config_injected(self):
        conn = self.connect({'effect': 'tenant_status_effect'}, status_request(), validator=schema.validate)
        message = conn.read_line()
        self.assertEqual(status_request()['tenant'], message['request']['tenant'])
        self.assertEqual(self.config['projectName'], message['request']['config']['projectName'])
        conn.send({'proceed': True})
        conn.finish()


class EntryPointTests(unittest.TestCase):
    def test_effect_map_is_exactly_the_six_modules(self):
        self.assertEqual(sorted(gate.EFFECTS), ['admin_password_effect', 'odoo_backup', 'odoo_effect', 'subscription_effect',
                                                'tenant_drop_effect', 'tenant_status_effect'])
        for name, module in gate.EFFECTS.items():
            self.assertEqual(module, 'tools.shared_saas_lifecycle.' + name)
            self.assertTrue((Path(__file__).parent / (name + '.py')).is_file())

    def test_default_child_command_is_isolated(self):
        self.assertEqual(gate.child_argv('m')[1:], ['-E', '-s', '-B', '-m', 'm'])

    def test_grace_default_is_twenty_seconds(self):
        self.assertEqual(gate.KILL_GRACE, 20)


if __name__ == '__main__':
    unittest.main()
