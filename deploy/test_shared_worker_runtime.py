#!/usr/bin/env python3
"""Real shared-mode lifecycle: run-local.sh starts and supervises the shared worker.

Issue #444: the commercial scheduler only runs in `shared-worker-main.ts`, and no
deployment file started it. This runs the REAL `run-local.sh` and `local-process.sh`
from a temp ROOT (script files are symlinks, so the executed code is the repository
source) with:

  * the REAL Node 22 binary reached through a temp NODE_BIN that also holds a fake npm
    (migration never runs), a fake docker answering the retained-identity payload
    `resource_guard.py` expects, and fake lsof/curl;
  * an inert Node entrypoint (node_modules/tsx/dist/cli.mjs) that records its own
    pid/ppid/argv and then idles, so api, worker and shared-worker are genuine node
    children with real argv, PIDs and start times;
  * a temp private home whose runtime.env selects the tenancy mode.

No PostgreSQL, port, container, private home or service is touched. The suite is
skipped when this host has no Node 22, because the scripts under test refuse to run.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent / 'control-plane'
PINNED = Path('/Users/tariq/code/odoo/.venv/bin/python')
if not PINNED.exists():  # pragma: no cover - pinned interpreter is the supported host layout
    PINNED = Path(sys.executable)


def _node22() -> Path | None:
    """The Node 22 the runtime scripts require, wherever this host or CI keeps it."""
    candidates = [Path('/opt/homebrew/opt/node@22/bin/node'), Path(shutil.which('node') or '')]
    candidates += sorted(Path('/usr/local/bin').glob('node*'))
    for candidate in candidates:
        if not candidate.is_file():
            continue
        try:
            done = subprocess.run([str(candidate), '--version'], capture_output=True, text=True, timeout=10)
        except OSError:
            continue
        if done.returncode == 0 and done.stdout.strip().startswith('v22.'):
            return candidate
    return None


NODE22 = _node22()
SCRIPTS = ('run-local.sh', 'local-process.sh', 'status-local.sh', 'stop-local.sh',
           'process_lock.py', 'startup_handoff.py', 'begin_generation.py',
           'recover_generation.py', 'resource_guard.py', 'runtime-trap.sh',
           'runtime-trap-cleanup.sh', 'runtime-tenancy.sh')

DOCKER_PY = r'''import json, sys
from pathlib import Path
args = sys.argv[1:]
container_id = 'c0ffee'
container = {'Id': container_id, 'Name': '/liwan-saas-control-local-control-db-1',
    'Image': 'sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5',
    'Config': {'Labels': {'com.docker.compose.project': 'liwan-saas-control-local',
        'com.docker.compose.service': 'control-db',
        'com.docker.compose.config-hash': 'eefc5a8aaa1f419dbc3c6be5b81fc07a767399f6ad5ba0813af0f663086d2e56',
        'com.docker.compose.project.config_files': __import__('os').environ['LIWAN_TEST_COMPOSE'],
        'com.docker.compose.project.working_dir': __import__('os').environ['LIWAN_TEST_WORKDIR']}},
    'HostConfig': {'PortBindings': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}},
    'Mounts': [{'Name': 'liwan-saas-control-local-db', 'Destination': '/var/lib/postgresql/data', 'Type': 'volume'}],
    'NetworkSettings': {'Networks': {'liwan-saas-control-local-private': {}}},
    'State': {'Status': 'running', 'Health': {'Status': 'healthy'}}}
if args[:1] == ['exec'] and 'psql' in args:
    # The running-operation query of local-process.sh; the test decides what the database holds.
    print(__import__('os').environ.get('LIWAN_TEST_RUNNING_OPERATION', ''))
elif args[:1] == ['ps']:
    print(container_id)
elif args[:1] == ['inspect'] and '--format' in args:
    print('running')
elif args[:1] == ['inspect']:
    print(json.dumps([container]))
elif args[:2] == ['volume', 'inspect']:
    print(json.dumps([{'Name': 'liwan-saas-control-local-db',
        'Labels': {'com.docker.compose.project': 'liwan-saas-control-local',
                   'com.docker.compose.volume': 'control_db_data'}}]))
elif args[:2] == ['network', 'inspect']:
    print(json.dumps([{'Name': 'liwan-saas-control-local-private',
        'Labels': {'com.docker.compose.project': 'liwan-saas-control-local',
                   'com.docker.compose.network': 'control-private'}}]))
else:
    sys.exit(0)
'''

ENTRY_MJS = r'''import fs from 'node:fs';
import process from 'node:process';
const home = process.env.LIWAN_CONTROL_HOME;
const entry = process.argv[2] || 'unknown';
// Distinguish the three entrypoints; the shared worker is checked on its own.
const name = entry.includes('shared-worker-main') ? 'shared-worker'
  : entry.includes('worker-main') ? 'worker' : 'api';
// A stuck child: the test names the entrypoint that must outlive SIGTERM.
if (process.env.LIWAN_TEST_IGNORE_TERM === name) process.on('SIGTERM', () => {});
fs.writeFileSync(`${home}/entry-${name}.json`, JSON.stringify({
  pid: process.pid, ppid: process.ppid, argv: process.argv,
  tenancy: process.env.LIWAN_TENANCY_MODE ?? null,
}));
setInterval(() => {}, 1000);
'''


class LockDescriptorScan(unittest.TestCase):
    """`process_lock.py --fds` names the inherited descriptors that are the lifecycle lock.

    `local-process.sh` closes exactly these in every child it launches; a missed one is
    held for the child's lifetime and blocks every later start, stop and status.
    """

    def test_only_descriptors_on_the_lock_file_are_named(self):
        with tempfile.TemporaryDirectory(prefix='liwan-lock-fds-') as home:
            lock, other = Path(home, 'processes.lock'), Path(home, 'other')
            lock.touch(); other.touch()
            fds = [os.open(lock, os.O_RDWR), os.open(other, os.O_RDWR), os.open(lock, os.O_RDONLY)]
            try:
                done = subprocess.run(
                    [sys.executable, str(HERE / 'process_lock.py'), '--fds'], pass_fds=fds,
                    env={**os.environ, 'LIWAN_CONTROL_HOME': home}, capture_output=True, text=True, timeout=30)
            finally:
                for fd in fds:
                    os.close(fd)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertEqual(done.stdout.split(), [str(fds[0]), str(fds[2])])


@unittest.skipIf(NODE22 is None, 'Node 22 is required by the control-plane runtime scripts')
class SharedModeRuntime(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='liwan-shared-mode-')
        self.base = Path(self.tmp.name).resolve()
        self.home = self.base / 'home'; self.home.mkdir(mode=0o700)
        self.root = self.base / 'root'; self.root.mkdir()
        (self.root / 'deploy' / 'control-plane').mkdir(parents=True)
        for name in SCRIPTS:
            os.symlink(HERE / name, self.root / 'deploy' / 'control-plane' / name)
        (self.home / 'logs').mkdir()
        for name in ('control-db-password', 'control-service-key', 'control-database-url', 'inventory-v2.json'):
            (self.home / name).write_text('{}' if name.endswith('.json') else 'fake')
        self.runtime_env = self.home / 'runtime.env'
        (self.home / 'processes.lock').touch()
        tsx = self.root / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'
        tsx.parent.mkdir(parents=True); tsx.write_text(ENTRY_MJS)
        for name in ('main.ts', 'worker-main.ts', 'shared-worker-main.ts'):
            path = self.root / 'apps' / 'control-plane' / 'src' / name
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text('// inert stand-in\n')
        self.bin = self.base / 'node-bin'; self.bin.mkdir()
        os.symlink(NODE22, self.bin / 'node')
        (self.bin / 'npm').write_text('#!/bin/sh\nexit 0\n'); (self.bin / 'npm').chmod(0o700)
        helpers = self.base / 'helpers'; helpers.mkdir()
        docker_py = helpers / 'docker.py'; docker_py.write_text(DOCKER_PY)
        (self.bin / 'docker').write_text(f'#!/bin/sh\nexec "{PINNED}" "{docker_py}" "$@"\n')
        (self.bin / 'docker').chmod(0o700)
        (self.bin / 'lsof').write_text('#!/bin/sh\nexit 1\n'); (self.bin / 'lsof').chmod(0o700)
        (self.bin / 'curl').write_text('#!/bin/sh\nexit 0\n'); (self.bin / 'curl').chmod(0o700)
        os.symlink(PINNED, self.bin / 'python3')
        self.children = []
        self.reapers = []

    def tearDown(self):
        for child in list(self.children):
            if child.poll() is None:
                child.kill()
        for name in ('api', 'worker', 'shared-worker'):
            record = self.entry(name)
            if record and self._alive(record['pid']):
                try:
                    os.kill(record['pid'], 15)
                except OSError:
                    pass
        for child in self.children:
            if child.poll() is None:
                child.wait(timeout=5)
        for reaper in self.reapers:
            reaper.join(timeout=5)
        self.tmp.cleanup()

    # --- helpers -----------------------------------------------------------
    def _alive(self, pid):
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    def entry(self, name):
        path = self.home / f'entry-{name}.json'
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text())
        except ValueError:
            return None

    def env(self):
        env = {**os.environ,
               'LIWAN_CONTROL_HOME': str(self.home),
               'LIWAN_REPOSITORY_ROOT': str(self.root),
               'LIWAN_NODE_BIN': str(self.bin),
               'LIWAN_TEST_COMPOSE': str((HERE / 'compose.yml').resolve()),
               'LIWAN_TEST_WORKDIR': str(HERE.resolve()),
               'PATH': f'{self.bin}:{os.environ["PATH"]}'}
        env.pop('LIWAN_PROCESS_LOCK_FD', None)
        env.pop('LIWAN_TENANCY_MODE', None)
        return env

    def spawn(self, argv, **kwargs):
        child = subprocess.Popen(argv, **kwargs)
        self.children.append(child)
        reaper = threading.Thread(target=child.wait, daemon=True)
        reaper.start(); self.reapers.append(reaper)
        return child

    def start_runtime(self, timeout=60):
        log = self.home / 'logs' / 'supervisor.log'
        handle = open(log, 'w')
        self.addCleanup(handle.close)
        child = self.spawn(['bash', str(self.root / 'deploy/control-plane/run-local.sh'), 'runtime'],
                           cwd=str(self.root), env=self.env(), stdout=handle, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if log.is_file() and 'Local control API ready' in log.read_text(errors='replace'):
                return child, log.read_text(errors='replace')
            if child.poll() is not None:
                self.fail(f'run-local exited {child.returncode}: {log.read_text(errors="replace")[-2000:]!r}')
            time.sleep(.05)
        self.fail('run-local never reported readiness')

    def wait_for_entries(self, *names, timeout=15):
        """The supervisor reports readiness before a freshly exec'd node has written its record."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if all(self.entry(name) for name in names):
                return
            time.sleep(.05)
        self.fail(f'{names} did not record their identity within {timeout}s')

    def run_script(self, name, timeout=60, env=None):
        return subprocess.run(['bash', str(self.root / 'deploy/control-plane' / name)],
                              cwd=str(self.root), env={**self.env(), **(env or {})},
                              capture_output=True, text=True, timeout=timeout)

    def run_local_process(self, *args, timeout=30):
        return subprocess.run(['bash', str(self.root / 'deploy/control-plane/local-process.sh'), *args],
                              cwd=str(self.root), env=self.env(),
                              capture_output=True, text=True, timeout=timeout)

    def records(self):
        return sorted(p.name for p in (self.home / 'processes').iterdir())

    # --- tests -------------------------------------------------------------
    def test_shared_mode_starts_status_checks_and_stops_three_children(self):
        self.runtime_env.write_text(
            'export LIWAN_TENANCY_MODE=shared\n'
            f'export LIWAN_SHARED_RUNTIME_CONFIG={self.base / "shared-runtime.json"}\n'
            f'export LIWAN_TENANT_REGISTRY_PATH={self.base / "registry.json"}\n')
        supervisor, ready = self.start_runtime()
        self.assertIn('shared worker (commercial scheduler) running', ready)
        self.wait_for_entries('api', 'worker', 'shared-worker')

        api, worker, shared = self.entry('api'), self.entry('worker'), self.entry('shared-worker')
        for name, record in (('api', api), ('worker', worker), ('shared-worker', shared)):
            self.assertIsNotNone(record, f'{name} entrypoint did not record its identity')
            # Every child is launched from the same runtime.env, so all see shared mode.
            self.assertEqual(record['tenancy'], 'shared', name)
        self.assertEqual(shared['argv'][2],
                         str(self.root / 'apps/control-plane/src/shared-worker-main.ts'))
        self.assertEqual(worker['argv'][2], str(self.root / 'apps/control-plane/src/worker-main.ts'))
        # A real generation record set, not a bare pid file.
        self.assertEqual(self.records(), sorted([
            'generation', 'runtime.pid', 'runtime.start',
            'api.pid', 'api.start', 'api.generation',
            'worker.pid', 'worker.start', 'worker.generation',
            'shared-worker.pid', 'shared-worker.start', 'shared-worker.generation']))

        status = self.run_script('status-local.sh')
        self.assertEqual(status.returncode, 0, f'exit={status.returncode} err={status.stderr[-2000:]!r}')
        self.assertIn('Shared worker (commercial scheduler) exact argv', status.stdout)

        # The per-name status path is supervised like api/worker.
        self.assertEqual(self.run_script('local-process.sh', timeout=30).returncode, 2)  # usage, no args
        shared_status = self.run_local_process('status', 'shared-worker')
        self.assertEqual(shared_status.returncode, 0, shared_status.stderr[-2000:])

        stop = self.run_script('stop-local.sh')
        self.assertEqual(stop.returncode, 0, f'exit={stop.returncode} err={stop.stderr[-2000:]!r}')
        self.assertIn('Owned runtime stopped', stop.stdout)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and any(self._alive(r['pid']) for r in (api, worker, shared)):
            time.sleep(.05)
        for name, record in (('api', api), ('worker', worker), ('shared-worker', shared)):
            self.assertFalse(self._alive(record['pid']), f'{name} must be stopped with the runtime')
        supervisor.wait(timeout=10)
        self.assertEqual(list((self.home / 'processes').iterdir()), [])

    def test_shared_runtime_is_not_healthy_once_its_shared_worker_was_stopped_alone(self):
        # `local-process.sh stop shared-worker` removes only that child's records. In a
        # shared runtime the scheduler is mandatory (a suspension or renewal can no longer
        # reach Odoo without it), so neither status command may report success.
        self.runtime_env.write_text(
            'export LIWAN_TENANCY_MODE=shared\n'
            f'export LIWAN_SHARED_RUNTIME_CONFIG={self.base / "shared-runtime.json"}\n'
            f'export LIWAN_TENANT_REGISTRY_PATH={self.base / "registry.json"}\n')
        supervisor, _ = self.start_runtime()
        self.wait_for_entries('api', 'worker', 'shared-worker')
        shared = self.entry('shared-worker')

        stopped = self.run_local_process('stop', 'shared-worker')
        self.assertEqual(stopped.returncode, 0, stopped.stderr[-2000:])
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and self._alive(shared['pid']):
            time.sleep(.05)
        self.assertFalse(self._alive(shared['pid']))
        self.assertFalse((self.home / 'processes' / 'shared-worker.pid').exists())

        status = self.run_script('status-local.sh')
        self.assertEqual(status.returncode, 2, status.stdout + status.stderr[-2000:])
        self.assertIn('shared-worker exact process identity not confirmed', status.stderr)
        runtime_status = self.run_local_process('status', 'runtime')
        self.assertEqual(runtime_status.returncode, 2, runtime_status.stdout + runtime_status.stderr[-2000:])
        self.assertIn('Shared worker identity mismatch', runtime_status.stderr)

        # The damaged runtime can still be stopped, which removes every record.
        self.assertEqual(self.run_script('stop-local.sh').returncode, 0)
        supervisor.wait(timeout=10)
        self.assertEqual(list((self.home / 'processes').iterdir()), [])

    def test_a_child_that_misses_its_stop_deadline_leaves_the_records_whole(self):
        # A slow child (a mail batch, a provisioning job) can outlive the SIGTERM deadline.
        # The stop reports the timeout and keeps the complete record set, so the next
        # stop still sees every owner instead of refusing a half-deleted set.
        self.runtime_env.write_text(
            'export LIWAN_TENANCY_MODE=shared\nexport LIWAN_TEST_IGNORE_TERM=worker\n'
            f'export LIWAN_SHARED_RUNTIME_CONFIG={self.base / "shared-runtime.json"}\n'
            f'export LIWAN_TENANT_REGISTRY_PATH={self.base / "registry.json"}\n')
        supervisor, _ = self.start_runtime()
        self.wait_for_entries('api', 'worker', 'shared-worker')
        api, worker, shared = self.entry('api'), self.entry('worker'), self.entry('shared-worker')
        before = self.records()

        first = self.run_script('stop-local.sh', env={'LIWAN_STOP_SECONDS': '2'})
        self.assertEqual(first.returncode, 11, first.stdout + first.stderr[-2000:])
        self.assertIn('Stop timeout for worker; owner records retained', first.stderr)
        self.assertEqual(self.records(), before, 'a timed-out stop must not delete any record')
        self.assertTrue(self._alive(worker['pid']) and self._alive(shared['pid']))
        self.assertIsNone(supervisor.poll(), 'the supervisor keeps running after a timed-out stop')

        # The stuck child finally dies; the same stop now completes the whole runtime.
        os.kill(worker['pid'], 9)
        second = self.run_script('stop-local.sh', env={'LIWAN_STOP_SECONDS': '2'})
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr[-2000:])
        supervisor.wait(timeout=10)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and any(self._alive(r['pid']) for r in (api, shared)):
            time.sleep(.05)
        self.assertFalse(any(self._alive(r['pid']) for r in (api, worker, shared)))
        self.assertEqual(list((self.home / 'processes').iterdir()), [])

    def test_stopping_a_busy_worker_names_its_operation_and_can_be_repeated(self):
        # An operator job cannot be interrupted or resumed, so the stop neither aborts nor
        # kills it: it reports the operation with a distinct exit code, keeps every record
        # and can be repeated until the operation (and with it the worker) has ended.
        self.runtime_env.write_text('export LIWAN_TEST_IGNORE_TERM=worker\n')
        supervisor, _ = self.start_runtime()
        self.wait_for_entries('api', 'worker')
        api, worker = self.entry('api'), self.entry('worker')
        before = self.records()
        busy = {'LIWAN_STOP_SECONDS': '2', 'LIWAN_TEST_RUNNING_OPERATION': 'op_0123 tenant.create'}

        for attempt in (1, 2):
            stop = self.run_script('stop-local.sh', env=busy)
            self.assertEqual(stop.returncode, 14, f'attempt {attempt}: {stop.stdout}{stop.stderr[-2000:]}')
            self.assertIn('Worker is finishing operation op_0123 (tenant.create)', stop.stderr)
            self.assertEqual(self.records(), before, 'a busy stop keeps every owner record')
            self.assertTrue(self._alive(worker['pid']), 'the busy worker is never killed')
            self.assertIsNone(supervisor.poll())

        # The operation ends and the worker exits; the same stop now completes the runtime.
        os.kill(worker['pid'], 9)
        done = self.run_script('stop-local.sh', env={'LIWAN_STOP_SECONDS': '2'})
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr[-2000:])
        supervisor.wait(timeout=10)
        self.assertEqual(list((self.home / 'processes').iterdir()), [])
        self.assertFalse(self._alive(api['pid']))

    def test_dedicated_mode_starts_exactly_api_and_worker(self):
        self.runtime_env.write_text('')
        supervisor, ready = self.start_runtime()
        self.assertIn('worker running', ready)
        self.assertNotIn('shared worker', ready)
        self.wait_for_entries('api', 'worker')
        self.assertIsNone(self.entry('shared-worker'), 'dedicated mode must not start the shared worker')
        self.assertEqual(self.records(), sorted([
            'generation', 'runtime.pid', 'runtime.start',
            'api.pid', 'api.start', 'api.generation',
            'worker.pid', 'worker.start', 'worker.generation']))

        status = self.run_script('status-local.sh')
        self.assertEqual(status.returncode, 0, status.stderr[-2000:])
        self.assertNotIn('Shared worker', status.stdout)

        self.assertEqual(self.run_script('stop-local.sh').returncode, 0)
        supervisor.wait(timeout=10)

    def test_dedicated_mode_refuses_a_direct_shared_worker_start(self):
        # An operator naming the process explicitly must not create a supervised child
        # that would exit on its own (no tenant registry / shared runtime config).
        self.runtime_env.write_text('')
        state = self.home / 'processes'; state.mkdir(mode=0o700)
        (state / 'generation').write_text('a' * 32 + '\n')
        result = self.run_local_process('start', 'shared-worker')
        self.assertEqual(result.returncode, 13, result.stdout + result.stderr[-2000:])
        self.assertIn('LIWAN_TENANCY_MODE=shared', result.stderr)
        self.assertIsNone(self.entry('shared-worker'))
        self.assertFalse((self.home / 'processes' / 'shared-worker.generation').exists(),
                         'a refused start must not publish a generation record')
        self.assertFalse((self.home / 'processes' / 'shared-worker.pid').exists())

    def test_shared_mode_with_a_relative_path_refuses_before_any_child(self):
        self.runtime_env.write_text(
            'export LIWAN_TENANCY_MODE=shared\n'
            'export LIWAN_SHARED_RUNTIME_CONFIG=relative/shared-runtime.json\n'
            f'export LIWAN_TENANT_REGISTRY_PATH={self.base / "registry.json"}\n')
        result = self.run_script('run-local.sh')
        self.assertEqual(result.returncode, 8, result.stderr[-2000:])
        self.assertIn('absolute LIWAN_SHARED_RUNTIME_CONFIG', result.stderr)
        self.assertIsNone(self.entry('api'), 'nothing may start before the shared paths are validated')
        self.assertIsNone(self.entry('shared-worker'))


if __name__ == '__main__':
    unittest.main()
