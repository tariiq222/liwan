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
            head_timeout=2, euid=kwargs.get('euid', case.euid), lstat=kwargs.get('lstat', case.lstat))))
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
