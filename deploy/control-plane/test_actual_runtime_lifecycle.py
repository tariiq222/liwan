#!/usr/bin/env python3
"""Real lifecycle integration: run-local.sh -> local-process.sh -> status/stop -> restart.

Runs the REAL deploy/control-plane scripts from a temp ROOT (script files are
symlinks, so the executed code is the repository source) with:
  * the REAL Node 22 binary, reached through a temp NODE_BIN dir that also holds a
    fake npm (migration never runs);
  * inert Node entrypoints (node_modules/tsx/dist/cli.mjs) that record their own
    pid/ppid/argv/lock-fd and then idle, so api/worker are genuine node children
    with real argv, PID and start times;
  * a fake docker that answers with the exact retained-identity payload
    resource_guard.py expects, a fake lsof and a fake curl;
  * a temp private home with placeholder files only.
No PostgreSQL, port, container, private home or service is touched, and no `ps`
shim is used: every identity assertion reads the real process table.
"""
import fcntl
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

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PINNED = Path('/Users/tariq/code/odoo/.venv/bin/python')
if not PINNED.exists():  # pragma: no cover - pinned interpreter is the supported host layout
    PINNED = Path(sys.executable)
NODE22 = Path('/opt/homebrew/opt/node@22/bin/node')
SCRIPTS = ('run-local.sh', 'local-process.sh', 'status-local.sh', 'stop-local.sh',
           'process_lock.py', 'startup_handoff.py', 'begin_generation.py',
           'recover_generation.py', 'resource_guard.py', 'runtime-trap.sh',
           'runtime-trap-cleanup.sh')

DOCKER_PY = r'''import json, sys
from pathlib import Path
args = sys.argv[1:]
container_id = 'c0ffee'
container = {'Id': container_id, 'Name': '/webvue-saas-control-local-control-db-1',
    'Image': 'sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5',
    'Config': {'Labels': {'com.docker.compose.project': 'webvue-saas-control-local',
        'com.docker.compose.service': 'control-db',
        'com.docker.compose.config-hash': 'eefc5a8aaa1f419dbc3c6be5b81fc07a767399f6ad5ba0813af0f663086d2e56',
        'com.docker.compose.project.config_files': __import__('os').environ['WEBVUE_TEST_COMPOSE'],
        'com.docker.compose.project.working_dir': __import__('os').environ['WEBVUE_TEST_WORKDIR']}},
    'HostConfig': {'PortBindings': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}},
    'Mounts': [{'Name': 'webvue-saas-control-local-db', 'Destination': '/var/lib/postgresql/data', 'Type': 'volume'}],
    'NetworkSettings': {'Networks': {'webvue-saas-control-local-private': {}}},
    'State': {'Status': 'running', 'Health': {'Status': 'healthy'}}}
if args[:1] == ['ps']:
    print(container_id)
elif args[:1] == ['inspect'] and '--format' in args:
    print('running')
elif args[:1] == ['inspect']:
    print(json.dumps([container]))
elif args[:2] == ['volume', 'inspect']:
    print(json.dumps([{'Name': 'webvue-saas-control-local-db',
        'Labels': {'com.docker.compose.project': 'webvue-saas-control-local',
                   'com.docker.compose.volume': 'control_db_data'}}]))
elif args[:2] == ['network', 'inspect']:
    print(json.dumps([{'Name': 'webvue-saas-control-local-private',
        'Labels': {'com.docker.compose.project': 'webvue-saas-control-local',
                   'com.docker.compose.network': 'control-private'}}]))
elif args[:1] == ['exec']:
    sys.exit(0)
else:
    sys.exit(0)
'''

ENTRY_MJS = r'''import fs from 'node:fs';
import process from 'node:process';
const home = process.env.WEBVUE_CONTROL_HOME;
const entry = (process.argv[2] || 'unknown');
const name = entry.includes('worker') ? 'worker' : 'api';
fs.writeFileSync(`${home}/entry-${name}.json`, JSON.stringify({
  pid: process.pid, ppid: process.ppid, argv: process.argv,
  lock_var: process.env.WEBVUE_PROCESS_LOCK_FD ?? null,
  fds: fs.readdirSync('/dev/fd').sort((a, b) => Number(a) - Number(b)),
}));
setInterval(() => {}, 1000);
'''


class ActualRuntimeLifecycle(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='webvue-actual-lifecycle-')
        # run-local.sh derives and exports its own ROOT with `pwd -P`, so the
        # fixture must use the canonical path for every root-relative value.
        self.base = Path(self.tmp.name).resolve()
        self.home = self.base / 'home'; self.home.mkdir(mode=0o700)
        self.root = self.base / 'root'; self.root.mkdir()
        (self.root / 'deploy' / 'control-plane').mkdir(parents=True)
        for name in SCRIPTS:
            os.symlink(HERE / name, self.root / 'deploy' / 'control-plane' / name)
        (self.root / 'logs').mkdir(exist_ok=True)
        (self.home / 'logs').mkdir()
        for name in ('control-db-password', 'control-service-key', 'control-database-url', 'inventory-v2.json'):
            (self.home / name).write_text('{}' if name.endswith('.json') else 'fake')
        (self.home / 'runtime.env').write_text('')
        (self.home / 'processes.lock').touch()
        tsx = self.root / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'
        tsx.parent.mkdir(parents=True); tsx.write_text(ENTRY_MJS)
        for name in ('main.ts', 'worker-main.ts'):
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
        for child in self.children:
            if child.poll() is None:
                self._stop_runtime()
                break
        for name in ('api', 'worker'):
            record = self.entry(name)
            if record and self._alive(record['pid']):
                try:
                    os.kill(record['pid'], 15)
                except OSError:
                    pass
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and any(self._alive(self.entry(n)['pid'])
                                                 for n in ('api', 'worker') if self.entry(n)):
            time.sleep(.05)
        for child in self.children:
            if child.poll() is None:
                child.kill()
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
               'WEBVUE_CONTROL_HOME': str(self.home),
               'WEBVUE_REPOSITORY_ROOT': str(self.root),
               'WEBVUE_NODE_BIN': str(self.bin),
               'WEBVUE_TEST_COMPOSE': str((HERE / 'compose.yml').resolve()),
               'WEBVUE_TEST_WORKDIR': str(HERE.resolve()),
               'PATH': f'{self.bin}:{os.environ["PATH"]}'}
        env.pop('WEBVUE_PROCESS_LOCK_FD', None)
        return env

    def spawn(self, argv, **kwargs):
        child = subprocess.Popen(argv, **kwargs)
        self.children.append(child)
        reaper = threading.Thread(target=child.wait, daemon=True)
        reaper.start(); self.reapers.append(reaper)
        return child

    def lock_is_free(self):
        path = self.home / 'processes.lock'
        fd = os.open(str(path), os.O_RDWR)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
            return True
        except BlockingIOError:
            return False
        finally:
            os.close(fd)

    def start_runtime(self, timeout=60):
        log = self.home / 'logs' / 'supervisor.log'
        handle = open(log, 'w')
        self.addCleanup(handle.close)
        child = self.spawn(['bash', str(self.root / 'deploy/control-plane/run-local.sh'), 'runtime'],
                           cwd=str(self.root), env=self.env(), stdout=handle, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if log.is_file() and 'Local control API ready' in log.read_text(errors='replace'):
                return child
            if child.poll() is not None:
                self.fail(f'run-local exited {child.returncode}: {log.read_text(errors="replace")[-2000:]!r}')
            time.sleep(.05)
        self.fail('run-local never reported readiness')

    def _stop_runtime(self):
        try:
            subprocess.run(['bash', str(self.root / 'deploy/control-plane/stop-local.sh')],
                           cwd=str(self.root), env=self.env(), capture_output=True, text=True, timeout=60)
        except subprocess.TimeoutExpired:
            pass

    def run_script(self, name, timeout=60):
        return subprocess.run(['bash', str(self.root / 'deploy/control-plane' / name)],
                              cwd=str(self.root), env=self.env(),
                              capture_output=True, text=True, timeout=timeout)

    # --- tests -------------------------------------------------------------
    def test_real_lifecycle_status_stop_restart_and_free_lock(self):
        supervisor = self.start_runtime()
        self.assertTrue(self.lock_is_free(), 'lifecycle lock must be free once the runtime is ready')
        api, worker = self.entry('api'), self.entry('worker')
        self.assertIsNotNone(api, 'api entrypoint did not record its identity')
        self.assertIsNotNone(worker, 'worker entrypoint did not record its identity')

        status = self.run_script('status-local.sh')
        self.assertEqual(status.returncode, 0, f'status exit={status.returncode} err={status.stderr[-2000:]!r}')
        self.assertIn('exact argv, start times and generation ownership verified', status.stdout)

        started = time.monotonic()
        duplicate = self.run_script('run-local.sh', timeout=60)
        elapsed = time.monotonic() - started
        self.assertNotEqual(duplicate.returncode, 0, 'a duplicate start must be refused')
        self.assertLess(elapsed, 30, 'duplicate start must refuse promptly, not block on the lock')

        stop = self.run_script('stop-local.sh')
        self.assertEqual(stop.returncode, 0, f'stop exit={stop.returncode} err={stop.stderr[-2000:]!r}')
        self.assertIn('Owned runtime stopped', stop.stdout)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and (self._alive(api['pid']) or self._alive(worker['pid'])):
            time.sleep(.05)
        self.assertFalse(self._alive(api['pid']), 'api must be stopped')
        self.assertFalse(self._alive(worker['pid']), 'worker must be stopped')

        (self.home / 'entry-api.json').unlink()
        (self.home / 'entry-worker.json').unlink()
        restarted = self.start_runtime()
        self.assertTrue(self.lock_is_free(), 'lock must be free after restart too')
        restarted_status = self.run_script('status-local.sh')
        self.assertEqual(restarted_status.returncode, 0,
                         f'restarted status exit={restarted_status.returncode} err={restarted_status.stderr[-2000:]!r}')
        self.assertEqual(self.run_script('stop-local.sh').returncode, 0)
        supervisor.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()
