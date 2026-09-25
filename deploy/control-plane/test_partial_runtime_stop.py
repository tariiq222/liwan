#!/usr/bin/env python3
"""Bounded mixed-state stop: live supervisor with dead/reused/mismatched owners.

Builds a real runtime (real `run-local.sh`, real Node 22 api/worker, temp ROOT and
home, fake docker/npm/lsof/curl), then damages exactly one owner record at a time
and drives the documented stop. All children are test-owned; timeouts are bounded
and only own processes are signalled. No PostgreSQL, port, container, private home
or service is involved and no `ps` shim is used.
"""
import fcntl
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PINNED = Path('/Users/tariq/code/odoo/.venv/bin/python')
if not PINNED.exists():  # pragma: no cover
    PINNED = Path(sys.executable)
NODE22 = Path('/opt/homebrew/opt/node@22/bin/node')
SCRIPTS = ('run-local.sh', 'local-process.sh', 'status-local.sh', 'stop-local.sh',
           'process_lock.py', 'startup_handoff.py', 'begin_generation.py',
           'recover_generation.py', 'resource_guard.py', 'runtime-trap.sh',
           'runtime-trap-cleanup.sh')

DOCKER_PY = r'''import json, sys, os
args = sys.argv[1:]
container_id = 'c0ffee'
container = {'Id': container_id, 'Name': '/nasq-saas-control-local-control-db-1',
    'Image': 'sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5',
    'Config': {'Labels': {'com.docker.compose.project': 'nasq-saas-control-local',
        'com.docker.compose.service': 'control-db',
        'com.docker.compose.config-hash': 'eefc5a8aaa1f419dbc3c6be5b81fc07a767399f6ad5ba0813af0f663086d2e56',
        'com.docker.compose.project.config_files': os.environ['NASQ_TEST_COMPOSE'],
        'com.docker.compose.project.working_dir': os.environ['NASQ_TEST_WORKDIR']}},
    'HostConfig': {'PortBindings': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}},
    'Mounts': [{'Name': 'nasq-saas-control-local-db', 'Destination': '/var/lib/postgresql/data', 'Type': 'volume'}],
    'NetworkSettings': {'Networks': {'nasq-saas-control-local-private': {}}},
    'State': {'Status': 'running', 'Health': {'Status': 'healthy'}}}
if args[:1] == ['ps']:
    print(container_id)
elif args[:1] == ['inspect'] and '--format' in args:
    print('running')
elif args[:1] == ['inspect']:
    print(json.dumps([container]))
elif args[:2] == ['volume', 'inspect']:
    print(json.dumps([{'Name': 'nasq-saas-control-local-db', 'Labels': {'com.docker.compose.project': 'nasq-saas-control-local', 'com.docker.compose.volume': 'control_db_data'}}]))
elif args[:2] == ['network', 'inspect']:
    print(json.dumps([{'Name': 'nasq-saas-control-local-private', 'Labels': {'com.docker.compose.project': 'nasq-saas-control-local', 'com.docker.compose.network': 'control-private'}}]))
else:
    sys.exit(0)
'''

ENTRY_MJS = r'''import fs from 'node:fs';
import process from 'node:process';
const home = process.env.NASQ_CONTROL_HOME;
const name = (process.argv[2] || '').includes('worker') ? 'worker' : 'api';
fs.writeFileSync(`${home}/entry-${name}.json`, JSON.stringify({ pid: process.pid, argv: process.argv }));
setInterval(() => {}, 1000);
'''


class PartialRuntimeStop(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='nasq-partial-stop-')
        self.base = Path(self.tmp.name).resolve()
        self.home = self.base / 'home'; self.home.mkdir(mode=0o700)
        self.root = self.base / 'root'; (self.root / 'deploy' / 'control-plane').mkdir(parents=True)
        for name in SCRIPTS:
            os.symlink(HERE / name, self.root / 'deploy' / 'control-plane' / name)
        (self.home / 'logs').mkdir()
        for name in ('control-db-password', 'control-service-key', 'control-database-url', 'inventory-v2.json'):
            (self.home / name).write_text('{}' if name.endswith('.json') else 'fake')
        (self.home / 'runtime.env').write_text('')
        (self.home / 'processes.lock').touch()
        tsx = self.root / 'node_modules' / 'tsx' / 'dist' / 'cli.mjs'
        tsx.parent.mkdir(parents=True); tsx.write_text(ENTRY_MJS)
        for name in ('main.ts', 'worker-main.ts'):
            path = self.root / 'apps' / 'control-plane' / 'src' / name
            path.parent.mkdir(parents=True, exist_ok=True); path.write_text('// inert\n')
        self.bin = self.base / 'node-bin'; self.bin.mkdir()
        os.symlink(NODE22, self.bin / 'node')
        (self.bin / 'npm').write_text('#!/bin/sh\nexit 0\n'); (self.bin / 'npm').chmod(0o700)
        helpers = self.base / 'helpers'; helpers.mkdir()
        docker_py = helpers / 'docker.py'; docker_py.write_text(DOCKER_PY)
        (self.bin / 'docker').write_text(f'#!/bin/sh\nexec "{PINNED}" "{docker_py}" "$@"\n'); (self.bin / 'docker').chmod(0o700)
        (self.bin / 'lsof').write_text('#!/bin/sh\nexit 1\n'); (self.bin / 'lsof').chmod(0o700)
        (self.bin / 'curl').write_text('#!/bin/sh\nexit 0\n'); (self.bin / 'curl').chmod(0o700)
        os.symlink(PINNED, self.bin / 'python3')
        self.children = []
        self.reapers = []
        self.supervisor = None
        self.tracked_pids = []

    def tearDown(self):
        # Tracked PIDs survive record tampering, so cleanup never depends on the
        # damaged record set.
        for pid in list(self.tracked_pids) + [int(self.record(n, '.pid')) for n in ('api', 'worker')
                                             if self.record(n, '.pid')]:
            try:
                os.kill(int(pid), signal.SIGKILL)
            except (OSError, ValueError):
                pass
        if self.supervisor is not None and self.supervisor.poll() is None:
            self.supervisor.kill()
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
    def env(self):
        env = {**os.environ,
               'NASQ_CONTROL_HOME': str(self.home),
               'NASQ_REPOSITORY_ROOT': str(self.root),
               'NASQ_NODE_BIN': str(self.bin),
               'NASQ_TEST_COMPOSE': str((HERE / 'compose.yml').resolve()),
               'NASQ_TEST_WORKDIR': str(HERE.resolve()),
               'PATH': f'{self.bin}:{os.environ["PATH"]}'}
        env.pop('NASQ_PROCESS_LOCK_FD', None)
        return env

    def record(self, name, suffix):
        path = self.home / 'processes' / f'{name}{suffix}'
        return path.read_text().strip() if path.is_file() else None

    def alive(self, pid):
        try:
            os.kill(int(pid), 0)
        except OSError:
            return False
        return True

    def spawn(self, argv, **kwargs):
        child = subprocess.Popen(argv, **kwargs)
        self.children.append(child)
        reaper = threading.Thread(target=child.wait, daemon=True)
        reaper.start(); self.reapers.append(reaper)
        return child

    def start_runtime(self, timeout=60):
        log = self.home / 'logs' / 'supervisor.log'
        handle = open(log, 'w'); self.addCleanup(handle.close)
        self.supervisor = self.spawn(['bash', str(self.root / 'deploy/control-plane/run-local.sh'), 'runtime'],
                                     cwd=str(self.root), env=self.env(), stdout=handle, stderr=subprocess.STDOUT)
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if log.is_file() and 'Local control API ready' in log.read_text(errors='replace'):
                for name in ('api', 'worker'):
                    pid = self.record(name, '.pid')
                    if pid:
                        self.tracked_pids.append(int(pid))
                return
            if self.supervisor.poll() is not None:
                self.fail(f'run-local exited {self.supervisor.returncode}: {log.read_text(errors="replace")[-1500:]!r}')
            time.sleep(.05)
        self.fail('run-local never reported readiness')

    def wait_absent(self, pid, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not self.alive(pid):
                return True
            time.sleep(.05)
        return False

    def stop(self, script='local-process.sh', extra=('stop', 'runtime'), timeout=90):
        return subprocess.run(['bash', str(self.root / 'deploy/control-plane' / script), *extra],
                              cwd=str(self.root), env=self.env(), capture_output=True, text=True, timeout=timeout)

    def archives(self, prefix='processes-archive'):
        return sorted(p.name for p in self.home.glob(f'{prefix}*'))

    # --- tests -------------------------------------------------------------
    def test_mixed_live_supervisor_dead_api_live_worker_stops_and_archives(self):
        self.start_runtime()
        api = int(self.record('api', '.pid')); worker = int(self.record('worker', '.pid'))
        os.kill(api, signal.SIGKILL)
        self.assertTrue(self.wait_absent(api), 'killed api was not reaped to ESRCH by the supervisor')
        records = {name: (self.home / 'processes' / name).read_bytes() for name in
                   ('generation', 'api.pid', 'api.start', 'api.generation', 'worker.pid', 'worker.start')}
        result = self.stop('stop-local.sh')
        self.assertEqual(result.returncode, 0, f'exit={result.returncode} err={result.stderr[-1500:]!r}')
        self.assertIn('dead owner records archived', result.stdout)
        self.assertFalse(self.alive(worker), 'the live worker must still be stopped')
        self.assertFalse(self.alive(self.supervisor.pid), 'the live supervisor must be stopped')
        found = self.archives('processes-archive-mixed-')
        self.assertEqual(len(found), 1, found)
        archive = self.home / found[0]
        for name, raw in records.items():
            self.assertEqual((archive / name).read_bytes(), raw, f'{name} metadata changed in the archive')

    def test_mixed_live_supervisor_both_children_dead_stops_without_emergency(self):
        self.start_runtime()
        for name in ('api', 'worker'):
            pid = int(self.record(name, '.pid'))
            os.kill(pid, signal.SIGKILL)
            self.assertTrue(self.wait_absent(pid), f'killed {name} was not reaped to ESRCH')
        result = self.stop()
        self.assertEqual(result.returncode, 0, f'exit={result.returncode} err={result.stderr[-1500:]!r}')
        self.assertFalse(self.alive(self.supervisor.pid))
        self.assertEqual(len(self.archives('processes-archive-mixed-')), 1)

    def test_all_dead_generation_delegates_to_recover_archive(self):
        self.start_runtime()
        pids = [self.supervisor.pid] + [int(self.record(n, '.pid')) for n in ('api', 'worker')]
        for pid in pids:
            os.kill(pid, signal.SIGKILL)
        for pid in pids:
            self.assertTrue(self.wait_absent(pid), f'pid {pid} not ESRCH')
        result = self.stop()
        self.assertEqual(result.returncode, 0, f'exit={result.returncode} err={result.stderr[-1500:]!r}')
        self.assertIn('dead generation archived', result.stdout)
        found = self.archives('processes-archive-')
        self.assertEqual(len(found), 1, found)
        self.assertEqual(sorted(p.name for p in (self.home / found[0]).iterdir()),
                         sorted(['generation', 'runtime.pid', 'runtime.start', 'api.pid', 'api.start',
                                 'api.generation', 'worker.pid', 'worker.start', 'worker.generation']))

    def test_mismatched_live_owner_refuses_and_never_signals(self):
        self.start_runtime()
        api = int(self.record('api', '.pid'))
        (self.home / 'processes' / 'api.start').write_text('Wed 01 Jan 00:00:00 2020\n')
        before = {p.name: p.read_bytes() for p in (self.home / 'processes').iterdir()}
        result = self.stop()
        self.assertEqual(result.returncode, 10, f'exit={result.returncode} err={result.stderr[-1500:]!r}')
        self.assertIn('neither exactly owned nor provably gone', result.stderr + result.stdout)
        self.assertTrue(self.alive(api), 'a mismatched live owner must never be signalled')
        self.assertTrue(self.alive(self.supervisor.pid))
        self.assertEqual({p.name: p.read_bytes() for p in (self.home / 'processes').iterdir()}, before)
        self.assertEqual(self.archives(), [], 'a refusal must not archive')

    def test_reused_foreign_pid_refuses_and_foreign_process_survives(self):
        self.start_runtime()
        foreign = self.spawn([str(PINNED), '-c', 'import time; time.sleep(600)'])
        (self.home / 'processes' / 'api.pid').write_text(str(foreign.pid) + '\n')
        result = self.stop()
        self.assertEqual(result.returncode, 10, f'exit={result.returncode} err={result.stderr[-1500:]!r}')
        self.assertTrue(self.alive(foreign.pid), 'the reused foreign PID must never be signalled')
        self.assertTrue(self.alive(self.supervisor.pid))
        self.assertEqual(self.archives(), [])

    def test_no_partial_signals_before_prevalidation(self):
        self.start_runtime()
        api = int(self.record('api', '.pid'))
        worker = int(self.record('worker', '.pid'))
        (self.home / 'processes' / 'worker.pid').write_text(str(worker) + '\n')
        (self.home / 'processes' / 'worker.start').write_text('Wed 01 Jan 00:00:00 2020\n')
        result = self.stop()
        self.assertEqual(result.returncode, 10, f'exit={result.returncode} err={result.stderr[-1500:]!r}')
        self.assertTrue(self.alive(api), 'no owner may be signalled before complete prevalidation')
        self.assertTrue(self.alive(worker))
        self.assertTrue(self.alive(self.supervisor.pid))

    def test_pid_is_absent_accepts_only_esrch(self):
        sys.path.insert(0, str(HERE))
        from recover_generation import pid_is_absent
        import errno

        def raise_esrch(pid, sig):
            raise OSError(errno.ESRCH, 'no such process')

        def raise_eperm(pid, sig):
            raise OSError(errno.EPERM, 'operation not permitted')

        def raise_ok(pid, sig):
            return None

        self.assertTrue(pid_is_absent(12345, kill=raise_esrch))
        self.assertFalse(pid_is_absent(12345, kill=raise_eperm))
        self.assertFalse(pid_is_absent(12345, kill=raise_ok))


if __name__ == '__main__':
    unittest.main()
